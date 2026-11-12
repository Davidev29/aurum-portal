import { app, BrowserWindow, dialog, protocol, session as electronSession } from 'electron'
import { readFile, rename as fsRename, cp as fsCp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_HOST, APP_NAME, APP_ORIGIN, APP_SCHEME } from '../../shared/constants'
import { IPC } from '../../shared/contracts'
import { createDatabase, type DatabaseContext } from './db/database'
import { seedBuiltins, getSettings, healCustomServiceRecipes } from './db/seed'
import { closeOrphanedSessions, countOpenSessionRows } from './db/repositories/sessions'
import { appendAuditEvent } from './db/repositories/audit'
import { SafeStorageKeyStore } from './vault/key-store'
import { VaultService } from './vault/service'
import { CertificateService } from './certificates/service'
import { SessionContextRegistry } from './sessions/context-registry'
import { SessionManager } from './sessions/manager'
import { installCertificateSelectionHandler } from './sessions/selection'
import { createCertificateTester } from './diagnostics/certificate-test'
import { TrustedContentsRegistry } from './ipc/trusted'
import { registerIpcHandlers } from './ipc/index'
import { startObligationReminderScheduler } from './notifications/obligations-scheduler'
import { logger, initLogger } from './logger'
import { redactUrl } from './security/redaction'

/**
 * Migração única (11/nov/2026): a pasta de dados do antigo nome
 * (%APPDATA%\Portal Vault) é movida para a nova (%APPDATA%\AurumBit Portal),
 * preservando banco, chave do cofre, partições e logs. Roda uma única vez —
 * depois que `newDir` existir, a migração se desativa sozinha.
 */
async function migrateLegacyUserDataDir(): Promise<void> {
  if (process.env.AURUMBIT_USER_DATA) return
  const newDir = app.getPath('userData')
  const legacyDir = path.join(app.getPath('appData'), 'Portal Vault')
  const legacyDb = path.join(legacyDir, 'portal-vault.db')
  const newDb = path.join(newDir, 'aurumbit-portal.db')
  try {
    if (!existsSync(newDir) && existsSync(legacyDir)) {
      await fsRename(legacyDir, newDir)
      logger.info('vault.migrated', { from: legacyDir, to: newDir })
    } else if (!existsSync(newDb) && existsSync(legacyDb)) {
      // Pasta nova já existe (criada por boot anterior) mas está vazia e o
      // banco antigo está no legado: copia sem apagar a origem.
      await fsCp(legacyDb, newDb, { errorOnExist: false })
      for (const suffix of ['-wal', '-shm']) {
        if (existsSync(`${legacyDb}${suffix}`))
          await fsCp(`${legacyDb}${suffix}`, `${newDb}${suffix}`)
      }
      logger.info('vault.migrated', { from: legacyDb, to: newDb, mode: 'copy-into-new-dir' })
    } else {
      return
    }
    // Renomeia arquivos com o nome antigo dentro da nova pasta.
    const renames: Array<[string, string]> = [
      ['portal-vault.db', 'aurumbit-portal.db'],
      ['portal-vault.db-wal', 'aurumbit-portal.db-wal'],
      ['portal-vault.db-shm', 'aurumbit-portal.db-shm'],
    ]
    for (const [from, to] of renames) {
      const src = path.join(newDir, from)
      if (existsSync(src)) await fsRename(src, path.join(newDir, to))
    }
    const legacyLog = path.join(newDir, 'logs', 'portal-vault.log')
    if (existsSync(legacyLog))
      await fsRename(legacyLog, path.join(newDir, 'logs', 'aurumbit-portal.log'))
  } catch (error) {
    // Nunca impede o boot; o vault antigo permanece intacto para recuperação manual.
    logger.error('vault.migrate_failed', {
      legacyDir,
      newDir,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const isDev = Boolean(process.env.AURUMBIT_DEV_URL)
const devUrl = process.env.AURUMBIT_DEV_URL?.replace(/\/+$/, '') ?? ''
if (process.env.AURUMBIT_USER_DATA && !app.isPackaged) {
  app.setPath('userData', path.resolve(process.env.AURUMBIT_USER_DATA))
}
const singleInstance = app.requestSingleInstanceLock()

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

if (!singleInstance) {
  app.quit()
} else {
  app.setName(APP_NAME)
  app.setAppUserModelId('br.com.aurumbit.desktop')
  app.on('second-instance', () => {
    const window = mainWindow
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    }
  })

  let mainWindow: BrowserWindow | null = null
  let database: DatabaseContext | null = null
  let manager: SessionManager | null = null
  let keyStore: SafeStorageKeyStore | null = null
  let quitting = false
  let askingToClose = false
  let stopObligationReminders: (() => void) | null = null
  const trusted = new TrustedContentsRegistry()

  const buildAppUrl = (route: string): string => {
    const normalized = route.startsWith('/') ? route : `/${route}`
    if (isDev) return `${devUrl}${normalized}`
    return `${APP_ORIGIN}${normalized}`
  }

  const isTrustedUiUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      if (isDev) return parsed.origin === new URL(devUrl).origin
      return parsed.origin === APP_ORIGIN
    } catch {
      return false
    }
  }

  const broadcast = (channel: string, payload: unknown): void => {
    for (const contents of trusted.all()) {
      if (!contents.isDestroyed()) contents.send(channel, payload)
    }
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('render-process-gone', (_error, details) => {
      logger.error('renderer.process_gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      })
    })
  })

  app.on('child-process-gone', (_event, details) => {
    logger.warn('child_process.gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (!mainWindow && app.isReady()) void createMainWindow()
  })

  app.on('before-quit', () => {
    quitting = true
    stopObligationReminders?.()
    stopObligationReminders = null
    manager?.closeAll()
    database?.close()
    database = null
    keyStore?.clearCache()
  })

  registerAppProtocol()

  app
    .whenReady()
    .then(async () => {
      initLogger()
      await migrateLegacyUserDataDir()
      const userData = app.getPath('userData')
      const databasePath = path.join(userData, 'aurumbit-portal.db')
      database = createDatabase(databasePath)
      closeOrphanedSessions(database.db)
      seedBuiltins(database.db)
      const healedRecipes = healCustomServiceRecipes(database.db)
      if (healedRecipes > 0) {
        appendAuditEvent(database.db, {
          type: 'recipe.auto_generated',
          entity: 'recipe',
          entityId: null,
          metadata: { scope: 'custom-services-healed', count: healedRecipes },
        })
      }
      appendAuditEvent(database.db, {
        type: 'app.started',
        entity: 'app',
        metadata: {
          version: app.getVersion(),
          electron: process.versions.electron,
          orphanedSessionsClosed: countOpenSessionRows(database.db),
        },
      })

      keyStore = new SafeStorageKeyStore(userData)
      let masterKey: Buffer
      try {
        masterKey = keyStore.loadOrCreate()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Nao foi possivel abrir o cofre local.'
        dialog.showErrorBox(
          'AurumBit Portal - cofre indisponivel',
          `${message}\n\nO aplicativo sera encerrado para proteger os dados.`,
        )
        app.quit()
        return
      }
      const vault = new VaultService(masterKey)
      const registry = new SessionContextRegistry()
      const db = database.db

      let certificateTester: ReturnType<typeof createCertificateTester> | null = null
      const certificates = new CertificateService({
        db,
        vault,
        onChanged: () => broadcast(IPC.events.certificatesChanged, null),
        onImportProgress: (progress) => broadcast(IPC.events.importProgress, progress),
        isCertificateInUse: (id) => manager?.isCertificateInUse(id) ?? false,
        testCertificate: async (id) => {
          if (!certificateTester) {
            return {
              ok: false,
              presentedThumbprintSha256: null,
              expectedThumbprintSha256: '',
              message: 'Diagnostico indisponivel neste momento.',
              testedAt: new Date().toISOString(),
            }
          }
          return certificateTester.test(id)
        },
      })

      manager = new SessionManager({
        db,
        vault,
        certificates,
        registry,
        trusted,
        preloadPath: path.join(__dirname, 'preload.cjs'),
        buildAppUrl,
        getSettings: () => getSettings(db),
        onSessionsChanged: (sessions) => broadcast(IPC.events.sessionsChanged, sessions),
        onSessionError: (event) => broadcast(IPC.events.sessionError, event),
        onDownloadProgress: (progress) => broadcast(IPC.events.downloadProgress, progress),
        onImportProgress: (progress) => broadcast(IPC.events.importProgress, progress),
      })

      certificateTester = createCertificateTester({ db, registry })

      installCertificateSelectionHandler({
        registry,
        audit: (event) => {
          try {
            appendAuditEvent(db, {
              type: event.type,
              entity: event.entity,
              entityId: event.entityId ?? null,
              metadata: event.metadata,
            })
          } catch (error) {
            logger.warn('certificate.selection_audit_failed', {
              message: error instanceof Error ? error.message : String(error),
            })
          }
        },
        onSelectionIssue: (sessionId, message) => manager?.onSelectionIssue(sessionId, message),
      })

      registerIpcHandlers({
        db,
        vault,
        certificates,
        sessions: manager,
        trusted,
        broadcast,
        databasePath,
        isShuttingDown: () => quitting,
      })
      stopObligationReminders = startObligationReminderScheduler({ db, broadcast })

      electronSession.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      )
      electronSession.defaultSession.setPermissionCheckHandler(() => false)

      await createMainWindow()
      installMainWindowLifecycle()

      void certificates
        .refreshPresence()
        .then((records) => {
          if (records) broadcast(IPC.events.certificatesChanged, null)
        })
        .catch((error) => {
          logger.warn('certificates.startup_presence_failed', {
            message: error instanceof Error ? error.message : String(error),
          })
        })
    })
    .catch((error) => {
      logger.error('app.startup_failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
      })
      dialog.showErrorBox(
        'AurumBit Portal',
        'Nao foi possivel iniciar o aplicativo. Consulte os logs para mais detalhes.',
      )
      app.quit()
    })

  async function createMainWindow(): Promise<void> {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
      return
    }
    const window = new BrowserWindow({
      width: 1380,
      height: 900,
      minWidth: 1024,
      minHeight: 680,
      show: false,
      title: APP_NAME,
      backgroundColor: '#eceae5',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        spellcheck: false,
        devTools: isDev,
      },
    })
    mainWindow = window
    window.setMenu(null)
    trusted.add(window.webContents)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedUiUrl(url)) event.preventDefault()
    })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null
    })
    await window.loadURL(buildAppUrl('/'))
  }

  function installMainWindowLifecycle(): void {
    if (!mainWindow || !database) return
    const window = mainWindow
    const db = database.db
    window.on('close', (event) => {
      if (quitting) return
      const behavior = getSettings(db).closeBehavior
      if (behavior === 'ask' && !askingToClose) {
        event.preventDefault()
        askingToClose = true
        void dialog
          .showMessageBox(window, {
            type: 'question',
            title: 'Encerrar o AurumBit Portal?',
            message: 'Todas as sessoes abertas serao encerradas.',
            detail: 'O cofre local e os cadastros permanecem salvos.',
            buttons: ['Encerrar', 'Cancelar'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          })
          .then((result) => {
            askingToClose = false
            if (result.response === 0) {
              quitting = true
              manager?.closeAll()
              app.quit()
            }
          })
        return
      }
      if (behavior === 'quit') {
        quitting = true
        manager?.closeAll()
      }
    })
  }

  function registerAppProtocol(): void {
    app.whenReady().then(() => {
      const root = path.resolve(process.env.AURUMBIT_WEB_ROOT ?? path.join(app.getAppPath(), 'out'))
      protocol.handle(APP_SCHEME, async (request) => {
        try {
          const url = new URL(request.url)
          if (url.hostname !== APP_HOST) return notFoundResponse()
          let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
          if (!relative) relative = 'index.html'
          else if (relative.endsWith('/')) relative += 'index.html'
          else if (!path.extname(relative)) relative = path.join(relative, 'index.html')
          const resolved = path.resolve(root, relative)
          if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
            return new Response('Forbidden', { status: 403 })
          }
          let bytes: Buffer
          try {
            bytes = await readFile(resolved)
          } catch {
            try {
              bytes = await readFile(path.join(root, '404.html'))
            } catch {
              return notFoundResponse()
            }
          }
          return new Response(new Uint8Array(bytes), {
            status: 200,
            headers: {
              'content-type': mimeFor(resolved),
              'cache-control': resolved.endsWith('.html')
                ? 'no-store'
                : 'public, max-age=31536000, immutable',
              'x-content-type-options': 'nosniff',
              'referrer-policy': 'no-referrer',
              'content-security-policy':
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            },
          })
        } catch (error) {
          logger.warn('protocol.app_failed', {
            url: redactUrl(request.url),
            message: error instanceof Error ? error.message : String(error),
          })
          return notFoundResponse()
        }
      })
      logger.info('protocol.app_registered', {
        root,
        source: 'app',
        dev: isDev,
        fileUrl: pathToFileURL(root).toString(),
      })
    })
  }
}

function notFoundResponse(): Response {
  return new Response('Not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
