import {
  BrowserWindow,
  WebContentsView,
  app,
  dialog,
  session as electronSession,
  shell,
  type Session,
  type WebContents,
} from 'electron'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ImportProgressEvent } from '../../../shared/types'
import type { AuthMethod, SessionStatus } from '../../../shared/constants'
import type {
  PortalSession,
  RecipeSummary,
  RecipeTestResult,
  SessionDetails,
  SessionOpenRequest,
  SessionOpenResult,
} from '../../../shared/types'
import type { AppSettings } from '../../../shared/types'
import type { AppDatabase } from '../db/database'
import type { VaultService } from '../vault/service'
import type { CertificateService } from '../certificates/service'
import {
  findDefaultCredential,
  getCredentialRow,
  getCredentialRecord,
  markCredentialUsed,
  revealCredential,
} from '../db/repositories/credentials'
import {
  getCertificateView,
  listCertificatesForClient,
  markCertificateUsed,
} from '../db/repositories/certificates'
import { getClient } from '../db/repositories/clients'
import { getServiceRow } from '../db/repositories/services'
import { getRecipeByService, recordRecipeOutcome } from '../db/repositories/recipes'
import { appendAuditEvent, allAuditEvents } from '../db/repositories/audit'
import { closeSessionRow, createSessionRow, updateSessionRow } from '../db/repositories/sessions'
import { AppError } from '../errors'
import { logger } from '../logger'
import { redactUrl } from '../security/redaction'
import {
  hostnameOf,
  isAllowedHost,
  isGovernmentHost,
  normalizeHostname,
  parseHttpUrl,
} from '../../../shared/network'
import { SESSION_CHROME_FOOTER_HEIGHT, SESSION_CHROME_HEIGHT } from '../../../shared/constants'
import { buildPartition, sessionReuseKey } from './partition'
import type { SessionContext, SessionContextRegistry } from './context-registry'
import { shouldFallbackToAgent } from '../recipes/fallback'
import { checkPostLogin, runRecipe, safeExecute, type RecipeTarget } from '../recipes/runner'
import { interruptedRecordingIdsForEvents } from '../recipes/interrupted'
import { runAgenticLogin, agentValues } from '../recipes/agent'
import {
  buildDrainScript,
  buildRecorderScript,
  buildTeardownScript,
  compileRecording,
  shouldEmitWizardProgress,
  type CompileCredential,
  type RecordedDrain,
  type RecordedEvent,
} from '../recipes/recorder'
import { constantTimeEqualHex } from '../vault/crypto'
import { saveRecipe } from '../db/repositories/recipes'
import { RECORDING_MAX_DURATION_MS, RECORDING_WARNING_DURATION_MS } from '../../../shared/constants'
import type { WizardState, WizardStatus, WizardWarning } from '../../../shared/types'
import { recipeDefinitionSchema, type RecipeDefinition } from '../../../shared/recipe'
import { stepCarriesCredentials } from '../../../shared/custom-service'
import { recipeValues } from '../recipes/core'
import type { TrustedContentsRegistry } from '../ipc/trusted'

/** Tempo máximo (ms) entre a abertura e a autenticação; ao expirar em sessão por
 * certificado a janela continua invisível e o usuário recebe a tela de erro. */
const BOOT_AUTH_TIMEOUT_MS = 60_000

const BLOCKED_DOWNLOAD_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.js',
  '.jse',
  '.scr',
  '.com',
  '.pif',
  '.reg',
  '.dll',
])

const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

interface ManagedSession {
  id: string
  reuseKey: string
  clientId: string
  clientName: string
  clientDocument: string
  serviceId: string
  serviceName: string
  serviceSlug: string
  authMethod: AuthMethod
  certificateId: string | null
  certificateLabel: string | null
  certificateHolderName: string | null
  certificateValidTo: string | null
  certificateThumbprintSha256: string | null
  certificateThumbprintSha1: string | null
  certificateSerialHex: string | null
  certificateIssuerDn: string | null
  certificateSubjectDn: string | null
  credentialId: string | null
  partition: string
  allowedDomains: string[]
  baseUrl: string
  win: BrowserWindow
  view: WebContentsView
  status: PortalSession['status']
  statusMessage: string | null
  lastError: string | null
  recipeRunning: boolean
  recipeAttempted: boolean
  watcher: NodeJS.Timeout | null
  watcherBusy: boolean
  watcherStartedAt: number
  popups: Set<BrowserWindow>
  openedAt: string
  currentUrl: string
  title: string
  loading: boolean
  closed: boolean
  /** true quando a WebContentsView do portal esta oculta para o usuario
   * (sessao por certificado em boot). Visao propria, nao depende de DOM. */
  portalHidden: boolean
  /** true quando a proxima revelacao deve mostrar o portal porque o fluxo
   * exige interacao humana (2FA, desafio anti-bot ou pedido explicito). */
  requiresHumanAction: boolean
  /** Página sem resposta no dreno da gravação (já avisou na /session). */
  drainStuck?: boolean
  /** Timer de seguranca: enquanto !authenticated apos BOOT_AUTH_TIMEOUT_MS,
   * o portal continua escondido e a sessao vira 'manual' com instrucao. */
  bootSafetyTimer: NodeJS.Timeout | null
  /** Gravação Assistida (Fase 1). Só preenchido em sessões de gravação. */
  recording: RecordingState | null
  /** E2E (build de teste): autopilot já injetado nesta sessão. Só existe/é usado
   * atrás do ramo eliminado em produção (ver armRecorder). */
  autopilotDone?: boolean
  /** Sessão descartável sem cliente — não persiste em `sessions`/`partitionUsage`. */
  adhoc?: boolean
}

/** Estado main-side da gravação ativa (por sessão). */
interface RecordingState {
  wizardId: string
  token: string
  serviceId: string
  clientId: string
  credentialId: string | null
  authMethod: AuthMethod
  /** Tela atual (T<n>) — incrementada a cada did-finish-load. */
  screen: number
  events: RecordedEvent[]
  secrets: Array<string | null>
  navigations: Array<{ at: number; toUrl: string }>
  gaps: number
  lastSeq: number
  stepCapReached: boolean
  durationWarning: boolean
  loggedInHint: boolean
  drainTimer: NodeJS.Timeout | null
  drainFailures: number
  probeTimer: NodeJS.Timeout | null
  warningTimer: NodeJS.Timeout | null
  maxDurationTimer: NodeJS.Timeout | null
  lastProgressEmit: number
}

/** Processo de gravação além do ciclo de vida da sessão (compila e salva). */
interface WizardRecord {
  wizardId: string
  status: WizardStatus
  sessionId: string | null
  serviceId: string
  clientId: string
  authMethod: AuthMethod
  fingerprintTargetId: string | null
  autoSubmitDefault: boolean
  warnings: WizardWarning[]
  compiledSteps: number
  compiledRecordedScreens: number
  compiled: ReturnType<typeof compileRecording>['definition'] | null
  startedAt: number
}

export interface SessionManagerDeps {
  db: AppDatabase
  vault: VaultService
  certificates: CertificateService
  registry: SessionContextRegistry
  trusted: TrustedContentsRegistry
  preloadPath: string
  buildAppUrl: (route: string) => string
  getSettings: () => AppSettings
  onSessionsChanged: (sessions: PortalSession[]) => void
  onSessionError: (event: {
    sessionId: string
    type: 'certificate_not_offered' | 'certificate_missing' | 'recipe_failed' | 'load_failed'
    message: string
  }) => void
  onDownloadProgress: (progress: {
    id: string
    filename: string
    state: 'started' | 'progressing' | 'completed' | 'cancelled' | 'interrupted'
    receivedBytes: number
    totalBytes: number
    savePath: string | null
  }) => void
  onImportProgress: (progress: ImportProgressEvent) => void
  /** Gravação Assistida (Fase 1): broadcast leve de progresso (throttled 1/s). */
  onWizardProgress?: (progress: {
    wizardId: string
    stepCount: number
    screen: number
    gaps: number
  }) => void
}

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly partitionUsage = new Map<string, number>()
  private readonly configuredPartitions = new Set<string>()
  private readonly wizards = new Map<string, WizardRecord>()
  private quitting = false

  constructor(private readonly deps: SessionManagerDeps) {}

  async open(request: SessionOpenRequest): Promise<SessionOpenResult> {
    const settings = this.deps.getSettings()
    if (this.sessions.size >= settings.sessionLimit) {
      throw new AppError(
        'SESSION_LIMIT',
        `Limite de ${settings.sessionLimit} sessoes simultaneas atingido`,
      )
    }

    const service = getServiceRow(this.deps.db, request.serviceId)
    if (!service.enabled) {
      throw new AppError('FORBIDDEN', 'Este servico esta desabilitado')
    }
    if (!service.authMethods.includes(request.authMethod)) {
      throw new AppError('VALIDATION', 'Metodo de autenticacao nao aceito pelo servico')
    }
    // Senha: o portal SEMPRE nasce visível.
    const client = getClient(this.deps.db, request.clientId)
    if (!client) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
    if (client.status === 'archived') {
      throw new AppError('FORBIDDEN', 'Cliente arquivado nao pode abrir sessoes')
    }

    let certificateId: string | null = null
    let certificateLabel: string | null = null
    let certificateHolderName: string | null = null
    let certificateValidTo: string | null = null
    let thumbprint256: string | null = null
    let thumbprint1: string | null = null
    let serialHex: string | null = null
    let issuerDn: string | null = null
    let subjectDn: string | null = null

    if (request.authMethod === 'certificate') {
      certificateId = request.certificateId ?? this.pickOnlyCertificate(client.id)
      let certificate = getCertificateView(this.deps.db, certificateId)
      const linked =
        certificate.clientId === client.id ||
        certificate.clients.some((item) => item.id === client.id)
      if (!linked) {
        throw new AppError(
          'FORBIDDEN',
          'O certificado nao esta vinculado a este cliente',
          'Vincule o certificado ao cliente antes de usa-lo.',
        )
      }
      if (certificate.status === 'expired') {
        throw new AppError(
          'CERTIFICATE_EXPIRED',
          'Certificado vencido nao pode autenticar',
          'Este certificado esta vencido. Importe o certificado renovado.',
        )
      }
      if (certificate.status === 'missing_windows') {
        throw new AppError(
          'CERTIFICATE_MISSING',
          'Certificado ausente no Windows',
          'O certificado sumiu do repositorio do Windows. Reinstale o PFX ou importe novamente.',
        )
      }
      if (certificate.status === 'chain_incomplete') {
        throw new AppError(
          'CERTIFICATE_INVALID',
          'Cadeia do certificado incompleta',
          'Instale a cadeia ICP-Brasil antes de autenticar.',
        )
      }
      if (!certificate.installed) {
        certificate = await this.deps.certificates.install(certificateId)
      }
      if (!certificate.installed) {
        throw new AppError(
          'CERTIFICATE_NOT_INSTALLED',
          'Certificado nao instalado no Windows',
          'Instale o certificado no Windows antes de abrir o portal.',
        )
      }
      certificateLabel = certificate.label
      certificateHolderName = certificate.holderName
      certificateValidTo = certificate.validTo
      thumbprint256 = certificate.thumbprintSha256
      thumbprint1 = certificate.thumbprintSha1
      serialHex = certificate.serialHex
      issuerDn = certificate.issuerDn
      subjectDn = certificate.subjectDn
    }

    let credentialId: string | null = null
    if (request.authMethod === 'password') {
      const credential = request.credentialId
        ? getCredentialRow(this.deps.db, request.credentialId)
        : findDefaultCredential(this.deps.db, client.id, service.id)
      if (!credential) {
        throw new AppError(
          'CREDENTIAL_MISSING',
          'Nenhuma credencial cadastrada para este cliente e servico',
          'Cadastre uma credencial para este cliente neste servico.',
        )
      }
      if (credential.clientId !== client.id || credential.serviceId !== service.id) {
        throw new AppError('FORBIDDEN', 'Credencial nao pertence ao cliente/servico selecionado')
      }
      credentialId = credential.id
    }

    const partition = buildPartition({
      clientId: client.id,
      certificateId,
      authMethod: request.authMethod,
    })
    const reuseKey = sessionReuseKey({
      clientId: client.id,
      serviceId: service.id,
      authMethod: request.authMethod,
      certificateId,
      credentialId,
    })
    if (!request.forceNew) {
      const existing = Array.from(this.sessions.values()).find(
        (session) => session.reuseKey === reuseKey && !session.closed,
      )
      if (existing) {
        this.focus(existing.id)
        return { sessionId: existing.id, reused: true }
      }
    }

    const id = randomUUID()
    const openedAt = new Date().toISOString()
    const remoteSession = this.preparePartition(partition)
    const context: SessionContext = {
      sessionId: id,
      clientId: client.id,
      clientName: client.name,
      clientDocument: client.document,
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
      authMethod: request.authMethod,
      certificateId,
      certificateLabel,
      certificateHolderName,
      certificateValidTo,
      certificateThumbprintSha256: thumbprint256,
      certificateThumbprintSha1: thumbprint1,
      certificateSerialHex: serialHex,
      certificateIssuerDn: issuerDn,
      certificateSubjectDn: subjectDn,
      allowedDomains: service.allowedDomains,
      partition,
    }
    this.deps.registry.set(remoteSession, context)
    this.partitionUsage.set(partition, (this.partitionUsage.get(partition) ?? 0) + 1)

    createSessionRow(this.deps.db, {
      id,
      clientId: client.id,
      certificateId,
      serviceId: service.id,
      credentialId,
      authMethod: request.authMethod,
      partition,
      openedAt,
    })

    const win = new BrowserWindow({
      width: 1240,
      height: 840,
      minWidth: 860,
      minHeight: 560,
      show: false,
      title: `${service.name} -> ${client.name}`,
      backgroundColor: '#1b1a17',
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.deps.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    })
    win.setMenu(null)
    this.deps.trusted.add(win.webContents)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(this.deps.buildAppUrl('/'))) event.preventDefault()
    })

    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        plugins: true,
        spellcheck: false,
        devTools: !app.isPackaged,
        backgroundThrottling: false,
      },
    })
    win.contentView.addChildView(view)
    // Sessao por certificado: a view nasce com bounds 0x0 (invisivel E sem
    // hit-testing). Usamos bounds em vez de setVisible(false), pois views
    // ocultas por visibilidade podem continuar "ativas" para input/paint no
    // compositor do Electron. Revelada pelo layout() em markAuthenticated().
    if (request.authMethod === 'certificate') {
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
    view.webContents.setUserAgent(CHROME_UA)
    view.webContents.setWindowOpenHandler(({ url }) =>
      this.handleWindowOpen(url, partition, context),
    )

    const record: ManagedSession = {
      id,
      reuseKey,
      clientId: client.id,
      clientName: client.name,
      clientDocument: client.document,
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
      authMethod: request.authMethod,
      certificateId,
      certificateLabel,
      certificateHolderName,
      certificateValidTo,
      certificateThumbprintSha256: thumbprint256,
      certificateThumbprintSha1: thumbprint1,
      certificateSerialHex: serialHex,
      certificateIssuerDn: issuerDn,
      certificateSubjectDn: subjectDn,
      credentialId,
      partition,
      allowedDomains: service.allowedDomains,
      baseUrl: service.baseUrl,
      win,
      view,
      status: 'opening',
      statusMessage: 'Abrindo portal...',
      lastError: null,
      recipeRunning: false,
      recipeAttempted: false,
      watcher: null,
      watcherBusy: false,
      watcherStartedAt: 0,
      popups: new Set(),
      openedAt,
      currentUrl: service.baseUrl,
      title: service.name,
      loading: true,
      closed: false,
      portalHidden: request.authMethod === 'certificate',
      requiresHumanAction: false,
      bootSafetyTimer: null,
      recording: null,
    }
    this.sessions.set(id, record)
    this.armBootSafetyTimer(record)
    this.configureRemoteContents(view.webContents, record)
    this.layout(record)
    win.on('resize', () => this.layout(record))
    win.on('maximize', () => this.layout(record))
    win.on('unmaximize', () => this.layout(record))
    win.once('ready-to-show', () => {
      if (!record.closed) {
        win.show()
        win.focus()
      }
    })
    win.on('closed', () => this.dispose(record, 'Janela fechada pelo usuario'))

    void win.loadURL(this.deps.buildAppUrl(`/session/?sessionId=${encodeURIComponent(id)}`))
    // Carrega a URL real do portal em uma unica navegacao. (Historico: a
    // versao anterior emitia um loadURL('about:blank') no mesmo tick —
    // corrida de navegacao associada a um crash intermitente do render
    // process neste fluxo; mitigacao F-RD-4 em docs/qa/QA-STRESS-REPORT.md.)
    view.webContents.loadURL(service.baseUrl).catch((error: unknown) => {
      if (record.closed) return
      record.status = 'error'
      record.lastError = error instanceof Error ? error.message : 'Falha ao abrir o portal'
      record.statusMessage = 'Falha ao abrir o portal'
      this.emit()
    })

    view.webContents.on('did-start-loading', () => {
      record.loading = true
      this.emit()
    })
    view.webContents.on('did-finish-load', () => {
      if (record.closed) return
      record.loading = false
      record.currentUrl = view.webContents.getURL()
      // Inicia a receita apenas quando o documento commitado e o portal
      // (o warm-up de about:blank foi removido; o guarda permanece como
      // defesa para cargas em branco futuras).
      const currentUrl = record.view.webContents.getURL()
      const isBlankDocument = !currentUrl || currentUrl === 'about:blank'
      if (record.recording) {
        // Sessão de gravação: arma/re-arma o recorder (cada documento novo
        // vira uma tela T<n>). NUNCA roda startRecipe — o portal é do usuário.
        void this.armRecorder(record)
      } else if (!record.recipeAttempted && !isBlankDocument) {
        record.recipeAttempted = true
        void this.startRecipe(record)
      }
      this.emit()
    })
    view.webContents.on('did-navigate', (_event, url) => {
      record.currentUrl = url
      if (record.recording) {
        record.recording.navigations.push({ at: Date.now(), toUrl: url })
      }
      // Detecção de autenticação por URL definitiva: quando o portal nos força
      // de volta ao HOST definitivo com um path não-inicial e não-login, o
      // fluxo certificado está concluído. Independe do `load` da página, que
      // em portais ASP.NET/PrimeFaces pode demorar dezenas de segundos.
      // Gated por `recipeAttempted` (a navegação inicial do portal ocorre
      // antes do primeiro did-finish-load, garantindo que a marca só aparece
      // depois que o fluxo do SSO/mTLS já começou).
      if (
        record.authMethod === 'certificate' &&
        record.recipeAttempted &&
        record.status === 'awaiting_login' &&
        this.urlIndicatesAuthenticated(url, record)
      ) {
        this.record('session.url_auth_detected', record.id, {
          url: redactUrl(url),
          serviceId: record.serviceId,
          clientId: record.clientId,
        })
        this.markAuthenticated(record, 'Login detectado no portal (redirect autenticado).')
      }
      this.emit()
    })
    view.webContents.on('did-stop-loading', () => {
      record.loading = false
      record.currentUrl = view.webContents.getURL()
      this.emit()
    })
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      record.currentUrl = url
      if (record.recording) {
        record.recording.navigations.push({ at: Date.now(), toUrl: url })
      }
      this.emit()
    })
    view.webContents.on('page-title-updated', (_event, title) => {
      record.title = title
      this.emit()
    })
    view.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || record.closed) return
        // Sessao por certificado: o portal permanece invisivel; o usuario ve a tela de
        // erro na pagina /session (com opcoes de tentar novamente ou abrir o portal).
        record.status = 'manual'
        record.statusMessage = `Falha ao carregar: ${errorDescription}`
        record.lastError = errorDescription
        updateSessionRow(this.deps.db, id, 'manual', errorDescription)
        this.deps.onSessionError({
          sessionId: id,
          type: 'load_failed',
          message: record.statusMessage,
        })
        this.emit()
      },
    )
    view.webContents.on('render-process-gone', (_event, details) => {
      if (record.closed) return
      // O portal permanece invisivel; o estado de erro e exibido na /session.
      record.status = 'error'
      record.statusMessage = `O portal travou (${details.reason}).`
      updateSessionRow(this.deps.db, id, 'error', details.reason)
      this.emit()
    })

    this.record('session.opened', id, {
      clientId: client.id,
      serviceId: service.id,
      authMethod: request.authMethod,
      certificateId,
      partition,
      ...(request.origin ? { origin: request.origin } : {}),
    })
    if (certificateId) markCertificateUsed(this.deps.db, certificateId)
    if (credentialId) markCredentialUsed(this.deps.db, credentialId)
    this.emit()
    return { sessionId: id, reused: false }
  }

  private pickOnlyCertificate(clientId: string): string {
    const eligible = listCertificatesForClient(this.deps.db, clientId).filter(
      (certificate) => certificate.status !== 'expired' && certificate.status !== 'missing_windows',
    )
    if (eligible.length === 0) {
      throw new AppError(
        'CERTIFICATE_MISSING',
        'Nenhum certificado valido vinculado ao cliente',
        'Importe um certificado A1 e vincule ao cliente.',
      )
    }
    if (eligible.length > 1) {
      throw new AppError(
        'VALIDATION',
        'Selecione um certificado',
        'Este cliente possui mais de um certificado. Escolha qual usar.',
      )
    }
    return (eligible[0] as { id: string }).id
  }

  private preparePartition(partition: string): Session {
    const ses = electronSession.fromPartition(partition)
    if (!this.configuredPartitions.has(partition)) {
      this.configuredPartitions.add(partition)
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      ses.setPermissionCheckHandler(() => false)
      // Carrega a extensao Web PKI (se fornecida via variavel de ambiente) para
      // compatibilidade com portais que exigem Web PKI para autenticacao.
      const extensionPath = process.env.AURUMBIT_WEBPKI_EXTENSION
      if (extensionPath) {
        try {
          const stats = statSync(extensionPath)
          if (stats.isDirectory()) {
            void ses
              .loadExtension(extensionPath, { allowFileAccess: false })
              .catch((error: unknown) => {
                logger.warn('webpki.extension_failed', {
                  partition,
                  message: error instanceof Error ? error.message : String(error),
                })
              })
          }
        } catch {
          // Extensao opcional; ignora se o caminho nao existir.
        }
      }
      if (process.env.AURUMBIT_E2E_ALLOW_LOCAL_TLS === '1' && !app.isPackaged) {
        // Exclusivo de testes E2E com servidor mTLS local. Nunca usado em producao
        // empacotada, mesmo que a variavel de ambiente seja definida.
        ses.setCertificateVerifyProc((request, callback) => {
          if (request.hostname === '127.0.0.1' || request.hostname === 'localhost') {
            callback(0)
          } else {
            callback(-3)
          }
        })
      }
      ses.on('will-download', (_event, item) => {
        const filename = item.getFilename()
        const extension = path.extname(filename).toLowerCase()
        if (BLOCKED_DOWNLOAD_EXTENSIONS.has(extension)) {
          item.cancel()
          this.deps.onDownloadProgress({
            id: randomUUID(),
            filename,
            state: 'cancelled',
            receivedBytes: 0,
            totalBytes: item.getTotalBytes(),
            savePath: null,
          })
          return
        }
        const directory = app.getPath('downloads')
        let savePath = path.join(directory, path.basename(filename))
        let suffix = 1
        while (existsSync(savePath)) {
          const parsed = path.parse(path.basename(filename))
          savePath = path.join(directory, `${parsed.name} (${suffix})${parsed.ext}`)
          suffix += 1
        }
        item.setSavePath(savePath)
        const id = randomUUID()
        this.deps.onDownloadProgress({
          id,
          filename,
          state: 'started',
          receivedBytes: 0,
          totalBytes: item.getTotalBytes(),
          savePath,
        })
        item.on('updated', (_event, state) => {
          this.deps.onDownloadProgress({
            id,
            filename,
            state: state === 'interrupted' ? 'interrupted' : 'progressing',
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
            savePath,
          })
        })
        item.once('done', (_event, state) => {
          this.deps.onDownloadProgress({
            id,
            filename,
            state: state === 'completed' ? 'completed' : state,
            receivedBytes: item.getReceivedBytes(),
            totalBytes: item.getTotalBytes(),
            savePath: state === 'completed' ? savePath : null,
          })
        })
      })
    }
    return ses
  }

  private configureRemoteContents(contents: WebContents, record: ManagedSession): void {
    contents.setUserAgent(CHROME_UA)
    contents.on('dom-ready', () => {
      // Remove a marca mais óbvia de automação: navigator.webdriver.
      // Seguindo a forma de qualquer navegador comum.
      void contents
        .executeJavaScript(
          'try{Object.defineProperty(navigator,"webdriver",{get:()=>undefined,configurable:true})}catch(e){}',
        )
        .catch(() => undefined)
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      // Portais do governo redirecionam por varios dominios (SSO, CDN, etc.).
      // Tudo deve permanecer dentro da guia do aplicativo; nunca abrir navegador externo.
      if (!this.isAllowedUrl(url, record.allowedDomains)) {
        // Bloqueia silenciosamente, sem sugerir navegador externo.
        event.preventDefault()
      }
    })
    contents.on('will-redirect', (event, url) => {
      if (!this.isAllowedUrl(url, record.allowedDomains)) {
        event.preventDefault()
        const host = hostnameOf(url) ?? 'dominio desconhecido'
        this.deps.onSessionError({
          sessionId: record.id,
          type: 'load_failed',
          message: `Redirecionamento bloqueado para ${host}`,
        })
      }
    })
    contents.on('did-create-window', (child) => {
      child.setMenu(null)
      record.popups.add(child)
      if (this.shouldHidePopupsNow(record.partition)) {
        child.once('ready-to-show', () => {
          if (record.status === 'authenticated' || record.requiresHumanAction) child.show()
        })
      }
      child.on('closed', () => record.popups.delete(child))
      this.configureRemoteContents(child.webContents, record)
      child.webContents.setWindowOpenHandler(({ url }) =>
        this.handleWindowOpen(url, record.partition, {
          sessionId: record.id,
          clientId: record.clientId,
          clientName: record.clientName,
          clientDocument: record.clientDocument,
          serviceId: record.serviceId,
          serviceName: record.serviceName,
          serviceSlug: record.serviceSlug,
          authMethod: record.authMethod,
          certificateId: record.certificateId,
          certificateLabel: record.certificateLabel,
          certificateHolderName: record.certificateHolderName,
          certificateValidTo: record.certificateValidTo,
          certificateThumbprintSha256: record.certificateThumbprintSha256,
          certificateThumbprintSha1: record.certificateThumbprintSha1,
          certificateSerialHex: record.certificateSerialHex,
          certificateIssuerDn: record.certificateIssuerDn,
          certificateSubjectDn: record.certificateSubjectDn,
          allowedDomains: record.allowedDomains,
          partition: record.partition,
        }),
      )
    })
    contents.on('before-input-event', (event, input) => {
      if (!app.isPackaged) return
      if (input.type !== 'keyDown') return
      const key = input.key.toLowerCase()
      const isDevToolsShortcut =
        key === 'f12' ||
        // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
        (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c'))
      if (isDevToolsShortcut) event.preventDefault()
    })
  }

  private handleWindowOpen(
    url: string,
    partition: string,
    context: SessionContext,
  ): Electron.WindowOpenHandlerResponse {
    // Em sessao por certificado ainda nao autenticada, popups nascem ocultos
    // (revelados junto com o portal na autenticacao/revelacao explicita).
    const hidePopup = this.shouldHidePopupsNow(partition)
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: this.popupWindowOptions(partition, hidePopup),
      }
    }
    if (!this.isAllowedUrl(url, context.allowedDomains)) {
      // Portais do governo abrem recursos em dominios variados. Mantemos a
      // navegacao dentro do aplicativo e nunca sugerimos o navegador externo.
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: this.popupWindowOptions(partition, hidePopup),
    }
  }

  private urlIndicatesAuthenticated(url: string, record: ManagedSession): boolean {
    try {
      const parsed = new URL(url)
      const serviceHost = normalizeHostname(new URL(record.baseUrl).hostname)
      const host = normalizeHostname(parsed.hostname)
      if (!serviceHost || !host) return false
      if (host !== serviceHost) return false
      const pathname = (parsed.pathname || '/').toLowerCase()
      // A raiz / é o landing pré-login de vários portais.
      if (pathname === '' || pathname === '/') return false
      // Caminhos Keycloak (JUCEC) — o fluxo certificado nunca termina aí.
      if (pathname.includes('/auth/realms/')) return false
      if (pathname.includes('autenticacao/login')) return false
      return true
    } catch {
      return false
    }
  }

  private shouldHidePopupsNow(partition: string): boolean {
    const record = Array.from(this.sessions.values()).find(
      (session) => session.partition === partition && !session.closed,
    )
    if (!record) return false
    return (
      record.authMethod === 'certificate' &&
      record.status !== 'authenticated' &&
      !record.requiresHumanAction
    )
  }

  private popupWindowOptions(
    partition: string,
    hideUntilRevealed = false,
  ): Electron.BrowserWindowConstructorOptions {
    return {
      width: 1000,
      height: 760,
      show: !hideUntilRevealed,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        plugins: true,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    }
  }

  private async confirmExternal(url: string, parent?: BrowserWindow): Promise<void> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return
    const settings = this.deps.getSettings()
    if (settings.confirmOpenExternal) {
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'Abrir link externo?',
        message: 'Este link sera aberto no navegador padrao do Windows.',
        detail: `${redactUrl(url)}\n\nO navegador externo nao usara o certificado da sessao do AurumBit Portal.`,
        buttons: ['Abrir no navegador', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      if (result.response !== 0) return
    }
    await shell.openExternal(url)
  }

  private isAllowedUrl(url: string, allowedDomains: string[]): boolean {
    // Navegacao aceita HTTP e HTTPS (o portal faz o upgrade para HTTPS), mas
    // apenas para hosts governamentais ou da allowlist do servico. A
    // autenticacao por certificado exige HTTPS e e tratada em certificates/core.ts.
    const parsed = parseHttpUrl(url)
    if (!parsed) return false
    const host = normalizeHostname(parsed.hostname)
    if (isGovernmentHost(host)) return true
    return isAllowedHost(host, allowedDomains)
  }

  private layout(record: ManagedSession): void {
    if (record.win.isDestroyed()) return
    // Portal oculto (senha interativa ou certificado): bounds zerados até a
    // revelação atômica, para que a tela de boot cubra o processo.
    if (record.portalHidden) {
      record.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
      return
    }
    const size = record.win.getContentSize()
    const width = size[0] ?? 0
    const height = size[1] ?? 0
    record.view.setBounds({
      x: 0,
      y: SESSION_CHROME_HEIGHT,
      width,
      height: Math.max(0, height - SESSION_CHROME_HEIGHT - SESSION_CHROME_FOOTER_HEIGHT),
    })
  }

  private targetForRecorder(record: ManagedSession): RecipeTarget {
    return {
      executeJavaScript: async <T>(code: string) =>
        record.view.webContents.executeJavaScript(code) as Promise<T>,
      loadURL: async (url: string) => {
        await record.view.webContents.loadURL(url)
      },
      getURL: () => record.view.webContents.getURL(),
      isDestroyed: () => record.closed || record.view.webContents.isDestroyed(),
      stop: () => record.view.webContents.stop(),
      // Eventos CONFIÁVEIS do pipeline de input do Chromium — o robô só os
      // usa quando a janela não está oculta (precisa de bounds + foco).
      sendInputEvent: (event) => {
        try {
          const contents = record.view.webContents
          if (contents.isDestroyed()) return
          contents.sendInputEvent(event as unknown as Parameters<typeof contents.sendInputEvent>[0])
        } catch {
          // view já destruída — ignore
        }
      },
    }
  }

  private async startRecipe(record: ManagedSession): Promise<void> {
    if (record.closed || record.recipeRunning) return
    const recipeRow = getRecipeByService(this.deps.db, record.serviceId)

    // Sem receita: o portal abre e a sessão fica em modo assistido com
    // detecção genérica de pós-login (para portais adicionados sem automação).
    // Se a partição persistente já tem cookies, o usuário entra já logado.
    if (!recipeRow || recipeRow.status === 'disabled') {
      record.status = 'awaiting_login'
      record.statusMessage = 'Sessao aberta. Autentique-se manualmente no portal.'
      updateSessionRow(this.deps.db, record.id, 'awaiting_login')
      this.emit()
      const fallback: RecipeDefinition = {
        version: 1,
        service: record.serviceSlug,
        auth: record.authMethod,
        steps: [],
        postLogin: {
          selectors: [
            'text=Sair',
            'a[href*="logout"]',
            'button[aria-label*="Sair" i]',
            '[data-testid="logout"]',
          ],
          timeoutMs: 5_000,
        },
        autoSubmit: false,
        onFailure: 'manual',
      }
      const target = this.targetForRecorder(record)
      try {
        if (await checkPostLogin(fallback, target, 4_000)) {
          this.markAuthenticated(record, 'Login ja detectado (sessao salva).')
          return
        }
      } catch {
        // Página ainda navegando; o watcher tenta novamente.
      }
      this.startWatcher(record, fallback)
      // Sessao por certificado: mantem o portal invisivel; a tela de loading
      // mostra o estado (Aguardando autenticacao) com opcao de abrir o portal.
      return
    }
    const stored: RecipeDefinition = recipeRow.definition
    const definition = this.recipeForSession(stored, record)
    // Senha sem receita interativa relevante (ou todos os passos filtrados):
    // não esconde o portal — o usuário precisa ver a tela.
    if (record.authMethod === 'password' && record.portalHidden && definition.steps.length === 0) {
      this.revealPortal(record)
    }
    record.recipeRunning = true
    record.status = 'awaiting_login'
    record.statusMessage =
      record.authMethod === 'certificate'
        ? 'Conectando ao portal com certificado digital...'
        : record.portalHidden
          ? `Entrando no ${record.serviceName}...`
          : 'Executando autofill assistido...'
    updateSessionRow(this.deps.db, record.id, 'awaiting_login')
    this.emit()

    // Antes de zerar as credenciais, captura-as para redigir mensagens
    // vindas da página que porventura as ecoam. Identidade por padrão;
    // ganha a lista real assim que a credencial é aberta.
    let redactSecrets = (text: string): string => text
    let username = ''
    let password = ''
    let extraValues: Record<string, string> | undefined
    let fieldSpecs: { name: string; kind: 'username' | 'password' | 'text' }[] | undefined
    if (record.authMethod === 'password' && record.credentialId) {
      try {
        const secret = revealCredential(this.deps.db, this.deps.vault, record.credentialId)
        username = secret.username
        password = secret.password
        extraValues = secret.extraValues
        fieldSpecs = secret.fieldSpecs
        markCredentialUsed(this.deps.db, record.credentialId)
        const secretsForRedaction = [username, password, ...Object.values(extraValues ?? {})]
          .filter((value): value is string => typeof value === 'string' && value.trim().length >= 4)
          .map((value) => value.trim())
        redactSecrets = (text: string): string => {
          let out = text
          for (const secret of secretsForRedaction) {
            out = out.split(secret).join('[REDACTED]')
          }
          return out
        }
      } catch {
        record.recipeRunning = false
        record.status = 'manual'
        record.statusMessage = 'Nao foi possivel abrir a credencial. Use o modo manual.'
        this.emit()
        return
      }
    }

    const target = this.targetForRecorder(record)

    // Fast-path: partição persistente pode já estar logada (cookies salvos do
    // acesso anterior com o mesmo cliente+certificado). Detecta antes de
    // executar os passos para não quebrar o fluxo com cliques em elementos
    // de login que já não existem.
    try {
      if (await checkPostLogin(definition, target, 4_000)) {
        record.recipeRunning = false
        this.markAuthenticated(record, 'Login ja detectado (sessao salva).')
        recordRecipeOutcome(this.deps.db, record.serviceId, 'verified')
        return
      }
    } catch {
      // Segue para a receita completa.
    }

    try {
      // Fluxo agêntico (senha): observa a página e age até o login concluir,
      // em vez de seguir uma lista fixa de passos. Se o usuário optou por
      // revisar antes de enviar (autoSubmit=false), apenas preenche e espera
      // que ele clique em Entrar.
      const agentLogin = () =>
        runAgenticLogin({
          values: agentValues({
            username,
            password,
            document: record.clientDocument,
            clientName: record.clientName,
            extraValues,
            fields: fieldSpecs,
          }),
          target,
          autoSubmit: definition.autoSubmit,
          onProgress: (stepIndex, total) => {
            if (record.closed) return
            record.statusMessage = `Acessando ${record.serviceName}... passo ${Math.min(stepIndex + 1, total)}/${total}`
            this.emit()
          },
        }).then((agentResult) => ({
          status: agentResult.status,
          message: agentResult.message,
          failedStep: null,
          captchaDetected: agentResult.captchaDetected,
          twoFactorDetected: agentResult.twoFactorDetected,
          lastUrl: agentResult.lastUrl,
          failureCode: null,
        }))

      const recipeLogin = () =>
        runRecipe({
          recipe: definition,
          values: recipeValues({
            username,
            password,
            document: record.clientDocument,
            clientName: record.clientName,
            extraValues,
          }),
          target,
          allowedDomains: record.allowedDomains,
        })

      // D6/C7: a receita GRAVADA tem PRIORIDADE sobre o agente inteligente.
      // O agente só assume quando a gravada falha no passo 0 com
      // failureCode === 'element-not-found' (portal mudou desde a gravação);
      // qualquer outra falha PAUSA para o humano — nunca "consertar" uma
      // gravação que estava em captcha/2FA, nem double-submit.
      const recorded = definition.origin === 'recorded' && definition.steps.length > 0
      const preferRecipe = recorded || record.authMethod === 'certificate' || !username
      let result = preferRecipe ? await recipeLogin() : await agentLogin()
      if (
        recorded &&
        record.authMethod !== 'certificate' &&
        username &&
        shouldFallbackToAgent(result)
      ) {
        record.statusMessage = 'Automação reaprendendo a página...'
        this.emit()
        result = await agentLogin()
      }
      username = ''
      password = ''
      if (record.closed) return
      record.recipeRunning = false
      record.currentUrl = target.getURL()
      if (result.status === 'authenticated') {
        this.markAuthenticated(record, 'Login detectado automaticamente.')
        recordRecipeOutcome(this.deps.db, record.serviceId, 'verified')
      } else if (result.status === 'awaiting_login') {
        // Nunca rebaixar um estado 'authenticated' alcancado pelo fast-path
        // de URL durante a receita. (Mutacao por watcher externo: o
        // estreitamento de tipo do TS nao enxerga, entao alargamos a comparacao.)
        const currentStatus = record.status as SessionStatus
        if (currentStatus !== 'authenticated') {
          // O portal permanece invisivel; o usuario ve o estado de espera na
          // /session (com opcao de abrir o portal a qualquer momento).
          record.status = 'awaiting_login'
          record.statusMessage =
            record.authMethod === 'certificate'
              ? 'Aguardando autenticacao no portal...'
              : redactSecrets(result.message)
          updateSessionRow(this.deps.db, record.id, 'awaiting_login')
          this.startWatcher(record, definition)
        }
      } else {
        // Mesma guarda de nao rebaixamento.
        const currentStatus = record.status as SessionStatus
        if (currentStatus === 'authenticated') {
          this.emit()
          return
        }
        // Falha que exige interacao humana (2FA, desafio anti-bot): revelar o
        // portal com o selo manual para o usuario concluir. Demais falhas:
        // manter o portal invisivel e mostrar o estado de erro na /session.
        const needsHuman = result.captchaDetected || result.twoFactorDetected
        const resultMessage = redactSecrets(result.message)
        if (needsHuman) {
          record.requiresHumanAction = true
          this.revealPortal(record)
        }
        record.status = 'manual'
        record.statusMessage = needsHuman
          ? result.twoFactorDetected
            ? 'Verificacao em duas etapas. Conclua o codigo na tela aberta.'
            : 'Verificacao anti-bot. Conclua o desafio na tela aberta.'
          : resultMessage
        record.lastError = resultMessage
        updateSessionRow(this.deps.db, record.id, 'manual', resultMessage)
        // Falha da receita (failedStep != null) marca a receita como quebrada
        // para regeneração. Falha do agente inteligente NÃO derruba a receita —
        // mas fica visível na auditoria, que antes registrava só o caso da receita.
        if (result.failedStep !== null) {
          recordRecipeOutcome(this.deps.db, record.serviceId, 'broken')
        }
        this.record('session.recipe_failed', record.id, {
          serviceId: record.serviceId,
          failedStep: result.failedStep,
          message: resultMessage.slice(0, 500),
          agentic: result.failedStep === null,
        })
        this.deps.onSessionError({
          sessionId: record.id,
          type: 'recipe_failed',
          message: resultMessage,
        })
        this.startWatcher(record, definition)
      }
      this.emit()
    } catch (error) {
      // Excecao na receita: manter o portal invisivel; estado de erro na /session.
      record.recipeRunning = false
      record.requiresHumanAction = false
      record.status = 'manual'
      record.statusMessage = 'A automacao falhou. Use o modo manual.'
      const errorMessage = redactSecrets(error instanceof Error ? error.message : 'Erro na receita')
      record.lastError = errorMessage
      updateSessionRow(this.deps.db, record.id, 'manual', errorMessage)
      this.record('session.recipe_failed', record.id, {
        serviceId: record.serviceId,
        message: record.lastError.slice(0, 500),
      })
      this.deps.onSessionError({
        sessionId: record.id,
        type: 'recipe_failed',
        message: record.statusMessage,
      })
      this.emit()
    }
  }

  private recipeForSession(stored: RecipeDefinition, record: ManagedSession): RecipeDefinition {
    // Receita ensinada em dois passes (certificado + senha): cada sessão roda
    // os passos do SEU fluxo. A ausência de passos específicos mantém o
    // comportamento legado (filtragem por método abaixo).
    const scopedSteps =
      record.authMethod === 'certificate'
        ? (stored.certificateSteps ?? stored.steps)
        : (stored.passwordSteps ?? stored.steps)
    const scoped: RecipeDefinition =
      scopedSteps !== stored.steps ? { ...stored, steps: scopedSteps } : stored
    // A receita declara um método (auth). Em sessões de certificado, passos que
    // carregam credenciais nunca rodam — mesmo quando o método bate com o da
    // receita (a receita unificada de um site gov.br inclui smart fill para o
    // modo senha). A detecção de pós-login continua ativa nos dois casos.
    // autoSubmit só faz sentido com formulário de senha: no certificado, a
    // tentativa geraria falha pós-login (página sem campo de senha).
    if (scoped.auth === record.authMethod) {
      if (record.authMethod !== 'certificate') return scoped
      return {
        ...scoped,
        steps: scoped.steps.filter((step) => !stepCarriesCredentials(step)),
        autoSubmit: false,
      }
    }
    const steps =
      record.authMethod === 'certificate'
        ? scoped.steps.filter((step) => !stepCarriesCredentials(step))
        : scoped.steps.filter((step) => {
            const selectors = (step.selectors ?? []).join(' ').toLowerCase()
            if (selectors.includes('certificado')) return false
            // Em modo senha, nao disparar o clique automatico no botao
            // "Seu certificado digital" — o operador escolhe outro metodo de
            // identificacao no gov.br.
            if (step.action === 'evaluate') {
              const script = (step.script ?? '').toLowerCase()
              if (script.includes('login-certificate') || script.includes('certificado digital')) {
                return false
              }
            }
            return true
          })
    return {
      ...scoped,
      steps,
      autoSubmit: record.authMethod === 'certificate' ? false : scoped.autoSubmit,
    }
  }

  private startWatcher(record: ManagedSession, definition: RecipeDefinition): void {
    this.stopWatcher(record)
    record.watcherStartedAt = Date.now()
    record.watcher = setInterval(() => {
      void this.watchPostLogin(record, definition)
    }, 5_000)
  }

  private async watchPostLogin(
    record: ManagedSession,
    definition: RecipeDefinition,
  ): Promise<void> {
    if (record.closed || record.watcherBusy || record.status === 'authenticated') return
    if (Date.now() - record.watcherStartedAt > 10 * 60_000) {
      this.stopWatcher(record)
      return
    }
    record.watcherBusy = true
    try {
      const target = this.targetForRecorder(record)
      if (await checkPostLogin(definition, target)) {
        this.markAuthenticated(record, 'Login detectado no portal.')
      }
    } catch {
      // A pagina pode estar navegando; a proxima verificacao tenta novamente.
    } finally {
      record.watcherBusy = false
    }
  }

  private markAuthenticated(record: ManagedSession, message: string): void {
    if (record.closed || record.status === 'authenticated') return
    record.status = 'authenticated'
    record.statusMessage = message
    record.lastError = null
    record.requiresHumanAction = false
    updateSessionRow(this.deps.db, record.id, 'authenticated')
    this.stopWatcher(record)
    this.clearBootSafetyTimer(record)
    // Revelacao atomica: a janela mostra o e-CAC ja logado em um unico frame.
    this.revealPortal(record)
    // O e-CAC/RFB às vezes permanece com a máscara cinza ("processando...")
    // após o callback mTLS. Um reload com o cookie de sessão entra direto na
    // área logada. Para outros portais (ex.: JUCEC), a página renderiza ok na
    // primeira vez — o reload só desperdiça um roundtrip com o broker.
    if (record.authMethod === 'certificate' && record.serviceSlug === 'ecac') {
      try {
        record.view.webContents.reload()
      } catch {
        // A view pode ter sido destruída no exato instante.
      }
    }
    this.record('session.auth_detected', record.id, {
      serviceId: record.serviceId,
      clientId: record.clientId,
      autoReload: record.authMethod === 'certificate' && record.serviceSlug === 'ecac',
    })
    this.emit()
  }

  private revealPortal(record: ManagedSession): void {
    if (record.closed) return
    try {
      if (record.win.isMinimized()) record.win.restore()
      record.win.show()
      record.win.focus()
      record.portalHidden = false
      // Revela nos bounds reais (y=chrome, altura=conteudo) e da foco a view
      this.layout(record)
      record.view.webContents.focus()
      for (const popup of record.popups) {
        if (!popup.isDestroyed() && !popup.isVisible()) popup.show()
      }
    } catch {
      // Janela pode ter sido fechada entre a deteccao e a revelacao.
    }
  }

  private hidePortal(record: ManagedSession): void {
    if (record.closed) return
    try {
      record.portalHidden = true
      record.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    } catch {
      // Janela pode ter sido fechada.
    }
  }

  /** Revela o portal a pedido do usuario (botao "Abrir o portal mesmo assim"). */
  reveal(id: string): void {
    const record = this.requireSession(id)
    record.requiresHumanAction = true
    this.clearBootSafetyTimer(record)
    this.revealPortal(record)
    this.record('session.reveal_requested', record.id, { serviceId: record.serviceId })
    this.emit()
  }

  private armBootSafetyTimer(record: ManagedSession): void {
    if (record.authMethod !== 'certificate' && !record.portalHidden) return
    this.clearBootSafetyTimer(record)
    record.bootSafetyTimer = setTimeout(() => {
      record.bootSafetyTimer = null
      if (record.closed || record.status === 'authenticated') return
      if (record.requiresHumanAction) return // humano agindo: nao podar o fluxo
      // A receita legitima pode demorar (postLogin wait de 60s + clique). Nesse
      // caso apenas adia o veredicto em vez de marcar erro prematuramente.
      if (record.recipeRunning) {
        this.armBootSafetyTimer(record)
        return
      }
      record.status = 'manual'
      record.statusMessage =
        'O portal esta demorando mais que o esperado para concluir a autenticacao.'
      record.lastError = 'boot_auth_timeout'
      updateSessionRow(this.deps.db, record.id, 'manual', record.lastError)
      this.record('session.boot_timeout', record.id, { serviceId: record.serviceId })
      this.emit()
    }, BOOT_AUTH_TIMEOUT_MS)
  }

  private clearBootSafetyTimer(record: ManagedSession): void {
    if (record.bootSafetyTimer) {
      clearTimeout(record.bootSafetyTimer)
      record.bootSafetyTimer = null
    }
  }

  private stopWatcher(record: ManagedSession): void {
    if (record.watcher) {
      clearInterval(record.watcher)
      record.watcher = null
    }
  }

  focus(id: string): void {
    const record = this.requireSession(id)
    if (record.status === 'authenticated' || record.requiresHumanAction) {
      this.revealPortal(record)
    }
    if (record.win.isMinimized()) record.win.restore()
    record.win.show()
    record.win.focus()
  }

  close(id: string): void {
    const record = this.requireSession(id)
    record.win.close()
  }

  list(): PortalSession[] {
    return Array.from(this.sessions.values())
      .filter((session) => !session.closed)
      .map((session) => this.toView(session))
  }

  details(id: string): SessionDetails | null {
    const record = this.sessions.get(id)
    if (!record || record.closed) return null
    const rec = record.recording
    return {
      ...this.toView(record),
      allowedDomains: record.allowedDomains,
      canProvideCredentials: Boolean(record.credentialId),
      credentialId: record.credentialId,
      zoomFactor: record.view.webContents.getZoomFactor(),
      portalVisible: !record.portalHidden,
      requiresHumanAction: record.requiresHumanAction,
      isRecording: rec !== null,
      recording: rec
        ? {
            wizardId: rec.wizardId,
            stepCount: rec.events.length,
            screenCount: Math.max(rec.screen, 1),
            gaps: rec.gaps,
            loggedInHint: rec.loggedInHint,
            durationWarning: rec.durationWarning,
          }
        : undefined,
    }
  }

  navigate(id: string, url: string): void {
    const record = this.requireSession(id)
    if (!this.isAllowedUrl(url, record.allowedDomains)) {
      throw new AppError(
        'FORBIDDEN',
        'Navegacao bloqueada',
        'Este dominio nao esta na allowlist do servico.',
      )
    }
    void record.view.webContents.loadURL(url)
  }

  reload(id: string): void {
    this.requireSession(id).view.webContents.reload()
  }

  stop(id: string): void {
    this.requireSession(id).view.webContents.stop()
  }

  back(id: string): void {
    const record = this.requireSession(id)
    if (record.view.webContents.canGoBack()) record.view.webContents.goBack()
  }

  forward(id: string): void {
    const record = this.requireSession(id)
    if (record.view.webContents.canGoForward()) record.view.webContents.goForward()
  }

  setZoom(id: string, factor: number): void {
    this.requireSession(id).view.webContents.setZoomFactor(factor)
    this.emit()
  }

  async openExternal(id: string, url?: string): Promise<void> {
    const record = this.requireSession(id)
    const target = url ?? record.view.webContents.getURL()
    await this.confirmExternal(target, record.win)
  }

  getCredentialForManual(
    id: string,
    credentialId: string,
    field: 'username' | 'password',
  ): { value: string; expiresAt: string } {
    const record = this.requireSession(id)
    if (record.credentialId !== credentialId) {
      throw new AppError('FORBIDDEN', 'Credencial nao pertence a esta sessao')
    }
    const recordCredential = getCredentialRecord(this.deps.db, credentialId)
    if (
      recordCredential.row.clientId !== record.clientId ||
      recordCredential.row.serviceId !== record.serviceId
    ) {
      throw new AppError('FORBIDDEN', 'Credencial nao pertence ao cliente/servico da sessao')
    }
    const secret = revealCredential(this.deps.db, this.deps.vault, credentialId)
    this.record('credential.revealed', credentialId, {
      sessionId: id,
      field,
      reason: 'manual-login-panel',
    })
    return {
      value: field === 'username' ? secret.username : secret.password,
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    }
  }

  async retryRecipe(id: string): Promise<RecipeTestResult> {
    const record = this.requireSession(id)
    if (record.recipeRunning) {
      return {
        ok: false,
        status: 'broken',
        message: 'A receita ja esta em execucao.',
        failedStep: null,
        testedAt: new Date().toISOString(),
      }
    }
    if (record.status === 'authenticated' || record.requiresHumanAction) {
      this.revealPortal(record)
    }
    record.recipeAttempted = true
    record.status = 'awaiting_login'
    record.statusMessage = 'Reexecutando receita...'
    if (record.authMethod === 'certificate') {
      record.requiresHumanAction = false
      this.hidePortal(record)
      this.armBootSafetyTimer(record)
    }
    this.stopWatcher(record)
    await this.startRecipe(record)
    const finalStatus = record.status as PortalSession['status']
    const ok = finalStatus === 'authenticated' || finalStatus === 'awaiting_login'
    return {
      ok,
      status: ok ? 'verified' : 'broken',
      message: record.statusMessage ?? '',
      failedStep: null,
      testedAt: new Date().toISOString(),
    }
  }

  isCertificateInUse(certificateId: string): boolean {
    return Array.from(this.sessions.values()).some(
      (session) => !session.closed && session.certificateId === certificateId,
    )
  }

  closeAll(): void {
    this.quitting = true
    for (const session of Array.from(this.sessions.values())) {
      this.stopWatcher(session)
      for (const popup of session.popups) {
        if (!popup.isDestroyed()) popup.close()
      }
      // A confirmação de gravação (quando aplicável) é responsabilidade de
      // quem chama — `before-quit` pergunta se há gravador ativo e, no
      // caminho de lock, a gravação bloqueia o bloqueio. Aqui as janelas
      // são destruídas de verdade: `close()` dispararia o veto do diálogo
      // da janela e a sessão seria dada como descartada mantendo uma
      // janela viva e invisível para o app.
      if (!session.win.isDestroyed()) {
        try {
          session.win.destroy()
        } catch (error) {
          logger.warn('session.destroy_window_failed', {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      this.dispose(session, 'Aplicativo encerrado')
    }
  }

  count(): number {
    return this.sessions.size
  }

  onSelectionIssue(sessionId: string, message: string): void {
    const record = this.sessions.get(sessionId)
    if (!record || record.closed) return
    record.status = 'manual'
    record.statusMessage = message
    record.lastError = message
    updateSessionRow(this.deps.db, sessionId, 'manual', message)
    this.deps.onSessionError({ sessionId, type: 'certificate_not_offered', message })
    this.emit()
  }

  private dispose(record: ManagedSession, reason: string): void {
    if (record.closed) return
    record.closed = true
    this.stopWatcher(record)
    this.clearBootSafetyTimer(record)
    // Gravação ativa encerrada por fora (janela X com confirmação, kill do
    // render, quit): descarta o wizard — nada fica meio-salvo.
    const rec = record.recording
    if (rec) {
      const wizard = this.wizards.get(rec.wizardId)
      if (wizard && wizard.status === 'recording') {
        this.wizards.delete(rec.wizardId)
        this.record(
          'recipe.record_discarded',
          rec.wizardId,
          { serviceId: wizard.serviceId, reason: reason || 'session-closed' },
          'recipe',
        )
      }
    }
    this.clearRecordingTimers(record)
    for (const popup of record.popups) {
      if (!popup.isDestroyed()) popup.close()
    }
    record.popups.clear()
    this.sessions.delete(record.id)
    const usage = (this.partitionUsage.get(record.partition) ?? 1) - 1
    if (usage <= 0) {
      this.partitionUsage.delete(record.partition)
      const ses = electronSession.fromPartition(record.partition)
      this.deps.registry.delete(ses)
    } else {
      this.partitionUsage.set(record.partition, usage)
    }
    if (record.adhoc) return
    try {
      closeSessionRow(this.deps.db, record.id, reason)
      this.record('session.closed', record.id, { reason })
    } catch (error) {
      logger.warn('session.close_audit_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
    // A view precisa ir junto mesmo no encerramento: uma janela destruída
    // pode não destruir a WebContentsView, e uma view viva com porta gov.br
    // autenticada continuar carregada é sessão órfã.
    if (!record.view.webContents.isDestroyed()) {
      try {
        record.view.webContents.close()
      } catch {
        // A view ja pode ter sido destruida junto com a janela.
      }
    }
    this.emit()
  }

  // ---------------------------------------------------------------------------
  // Gravação Assistida (Fase 1)
  // ---------------------------------------------------------------------------

  hasActiveRecorder(): boolean {
    for (const wizard of this.wizards.values()) {
      if (wizard.status === 'recording') return true
    }
    return false
  }

  /** IDs de gravações mortas por crash/kill (sem finished/discarded/recorded/interrupted). */
  interruptedRecordingIds(): string[] {
    try {
      // Só os tipos que importam — não varre a auditoria inteira.
      const events = allAuditEvents(this.deps.db, {
        types: [
          'recipe.record_started',
          'recipe.record_finished',
          'recipe.record_discarded',
          'recipe.recorded',
          'recipe.record_interrupted',
        ],
      })
      return interruptedRecordingIdsForEvents(events)
    } catch {
      return []
    }
  }

  async openRecorder(input: {
    serviceId: string
    clientId?: string | null
    authMethod: AuthMethod
    credentialId?: string | null
    certificateId?: string | null
  }): Promise<{ sessionId: string; wizardId: string }> {
    const settings = this.deps.getSettings()
    if (this.sessions.size >= settings.sessionLimit) {
      throw new AppError(
        'SESSION_LIMIT',
        `Limite de ${settings.sessionLimit} sessoes simultaneas atingido`,
      )
    }
    const service = getServiceRow(this.deps.db, input.serviceId)
    if (!service.enabled) {
      throw new AppError('FORBIDDEN', 'Este servico esta desabilitado')
    }
    if (!service.authMethods.includes(input.authMethod)) {
      throw new AppError('VALIDATION', 'Metodo de autenticacao nao aceito pelo servico')
    }
    const isClientlessPassword = !input.clientId && input.authMethod === 'password'
    if (!input.clientId && input.authMethod === 'certificate') {
      throw new AppError(
        'VALIDATION',
        'Gravação de certificado exige um certificado vinculado a um cliente',
      )
    }
    const client = isClientlessPassword
      ? null
      : (() => {
          const found = getClient(this.deps.db, input.clientId as string)
          if (!found) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
          if (found.status === 'archived') {
            throw new AppError('FORBIDDEN', 'Cliente arquivado nao pode abrir sessoes')
          }
          return found
        })()

    let credentialId: string | null = null
    if (input.authMethod === 'password' && input.credentialId) {
      if (!client) {
        throw new AppError('VALIDATION', 'Vincule um cliente para usar uma credencial')
      }
      const credential = getCredentialRow(this.deps.db, input.credentialId)
      if (!credential || credential.clientId !== client.id || credential.serviceId !== service.id) {
        throw new AppError('FORBIDDEN', 'Credencial nao pertence ao cliente/servico selecionado')
      }
      credentialId = credential.id
    }

    // Certificado: resolução idêntica à abertura normal — exige certificado
    // válido/instalado e vinculado ao cliente (mTLS injeta por thumbprint).
    let certificateId: string | null = null
    let certificateLabel: string | null = null
    let certificateHolderName: string | null = null
    let certificateValidTo: string | null = null
    let thumbprint256: string | null = null
    let thumbprint1: string | null = null
    let serialHex: string | null = null
    let issuerDn: string | null = null
    let subjectDn: string | null = null
    if (input.authMethod === 'certificate') {
      if (!client) {
        throw new AppError('VALIDATION', 'Gravacao de certificado exige cliente/certificado')
      }
      certificateId = input.certificateId ?? this.pickOnlyCertificate(client.id)
      let certificate = getCertificateView(this.deps.db, certificateId)
      const linked =
        certificate.clientId === client.id ||
        certificate.clients.some((item) => item.id === client.id)
      if (!linked) {
        throw new AppError(
          'FORBIDDEN',
          'O certificado nao esta vinculado a este cliente',
          'Vincule o certificado ao cliente antes de usa-lo.',
        )
      }
      if (certificate.status === 'expired') {
        throw new AppError(
          'CERTIFICATE_EXPIRED',
          'Certificado vencido nao pode autenticar',
          'Este certificado esta vencido. Importe o certificado renovado.',
        )
      }
      if (certificate.status === 'missing_windows') {
        throw new AppError(
          'CERTIFICATE_MISSING',
          'Certificado ausente no Windows',
          'O certificado sumiu do repositorio do Windows. Reinstale o PFX ou importe novamente.',
        )
      }
      if (certificate.status === 'chain_incomplete') {
        throw new AppError(
          'CERTIFICATE_INVALID',
          'Cadeia do certificado incompleta',
          'Instale a cadeia ICP-Brasil antes de autenticar.',
        )
      }
      if (!certificate.installed) {
        certificate = await this.deps.certificates.install(certificateId)
      }
      if (!certificate.installed) {
        throw new AppError(
          'CERTIFICATE_NOT_INSTALLED',
          'Certificado nao instalado no Windows',
          'Instale o certificado no Windows antes de abrir o portal.',
        )
      }
      certificateLabel = certificate.label
      certificateHolderName = certificate.holderName
      certificateValidTo = certificate.validTo
      thumbprint256 = certificate.thumbprintSha256
      thumbprint1 = certificate.thumbprintSha1
      serialHex = certificate.serialHex
      issuerDn = certificate.issuerDn
      subjectDn = certificate.subjectDn
    }

    const previousRecipe = getRecipeByService(this.deps.db, service.id)?.definition ?? null
    const autoSubmitDefault = previousRecipe?.autoSubmit ?? input.authMethod === 'password'

    const wizardId = randomUUID()
    const token = randomUUID()
    const id = randomUUID()
    const openedAt = new Date().toISOString()
    // Partição: sem cliente, a gravação usa uma partição descartável própria —
    // o serviço nunca fica vinculado a um cliente.
    const isAdhoc = !client
    const partition = isAdhoc
      ? `recording:${wizardId}`
      : buildPartition({
          clientId: client.id,
          certificateId,
          authMethod: input.authMethod,
        })
    const remoteSession = this.preparePartition(partition)
    const context: SessionContext = {
      sessionId: id,
      clientId: client?.id ?? '',
      clientName: client?.name ?? 'Gravação assistida',
      clientDocument: client?.document ?? '',
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
      authMethod: input.authMethod,
      certificateId,
      certificateLabel,
      certificateHolderName,
      certificateValidTo,
      certificateThumbprintSha256: thumbprint256,
      certificateThumbprintSha1: thumbprint1,
      certificateSerialHex: serialHex,
      certificateIssuerDn: issuerDn,
      certificateSubjectDn: subjectDn,
      allowedDomains: service.allowedDomains,
      partition,
    }
    this.deps.registry.set(remoteSession, context)
    this.partitionUsage.set(partition, (this.partitionUsage.get(partition) ?? 0) + 1)

    // Sessão descartável (sem cliente): não persiste linha em `sessions`.
    if (!isAdhoc) {
      createSessionRow(this.deps.db, {
        id,
        clientId: client.id,
        certificateId,
        serviceId: service.id,
        credentialId,
        authMethod: input.authMethod,
        partition,
        openedAt,
      })
    }

    const win = new BrowserWindow({
      width: 1240,
      height: 840,
      minWidth: 860,
      minHeight: 560,
      show: false,
      title: `Gravação assistida — ${service.name}`,
      backgroundColor: '#1b1a17',
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.deps.preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    })
    win.setMenu(null)
    this.deps.trusted.add(win.webContents)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(this.deps.buildAppUrl('/'))) event.preventDefault()
    })

    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        plugins: true,
        spellcheck: false,
        devTools: !app.isPackaged,
        backgroundThrottling: false,
      },
    })
    win.contentView.addChildView(view)
    view.webContents.setUserAgent(CHROME_UA)
    view.webContents.setWindowOpenHandler(({ url }) =>
      this.handleWindowOpen(url, partition, context),
    )

    const record: ManagedSession = {
      id,
      reuseKey: `recording:${wizardId}`,
      clientId: client?.id ?? '',
      clientName: client?.name ?? 'Gravação assistida',
      clientDocument: client?.document ?? '',
      serviceId: service.id,
      serviceName: service.name,
      serviceSlug: service.slug,
      authMethod: input.authMethod,
      certificateId,
      certificateLabel,
      certificateHolderName,
      certificateValidTo,
      certificateThumbprintSha256: thumbprint256,
      certificateThumbprintSha1: thumbprint1,
      certificateSerialHex: serialHex,
      certificateIssuerDn: issuerDn,
      certificateSubjectDn: subjectDn,
      credentialId,
      partition,
      adhoc: isAdhoc,
      allowedDomains: service.allowedDomains,
      baseUrl: service.baseUrl,
      win,
      view,
      status: 'opening',
      statusMessage: 'Abrindo portal para gravação…',
      lastError: null,
      recipeRunning: false,
      recipeAttempted: false,
      watcher: null,
      watcherBusy: false,
      watcherStartedAt: 0,
      popups: new Set(),
      openedAt,
      currentUrl: service.baseUrl,
      title: `Gravação assistida — ${service.name}`,
      loading: true,
      closed: false,
      portalHidden: false,
      requiresHumanAction: false,
      bootSafetyTimer: null,
      recording: {
        wizardId,
        token,
        serviceId: service.id,
        clientId: client?.id ?? '',
        credentialId,
        authMethod: input.authMethod,
        screen: 0,
        events: [],
        secrets: [],
        navigations: [],
        gaps: 0,
        lastSeq: 0,
        stepCapReached: false,
        durationWarning: false,
        loggedInHint: false,
        drainTimer: null,
        drainFailures: 0,
        probeTimer: null,
        warningTimer: null,
        maxDurationTimer: null,
        lastProgressEmit: 0,
      },
    }
    this.sessions.set(id, record)
    this.configureRemoteContents(view.webContents, record)
    this.layout(record)
    win.on('resize', () => this.layout(record))
    win.once('ready-to-show', () => {
      if (!record.closed) {
        win.show()
        win.focus()
      }
    })
    // C4 — fechar a janela do portal com gravação ativa pede confirmação.
    win.on('close', (event) => {
      if (!record.recording) return
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: 'Gravação em andamento',
        message: 'Gravação em andamento será perdida. Sair mesmo assim?',
        buttons: ['Sair mesmo assim', 'Continuar gravando'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (choice !== 0) event.preventDefault()
    })
    win.on('closed', () => this.dispose(record, 'Janela fechada pelo usuario'))

    void win.loadURL(this.deps.buildAppUrl(`/session/?sessionId=${encodeURIComponent(id)}`))
    view.webContents.loadURL(service.baseUrl).catch((error: unknown) => {
      if (record.closed) return
      record.status = 'error'
      record.lastError = error instanceof Error ? error.message : 'Falha ao abrir o portal'
      record.statusMessage = 'Falha ao abrir o portal'
      this.emit()
    })

    // Sessão de gravação: registra os mesmos handlers de ciclo de vida da view
    // que open() registra para sessões normais (a criação da janela de gravação
    // é um caminho separado). Sem isso o recorder NUNCA arma (nenhum evento é
    // capturado), nenhuma navegação é registrada e o autopilot de e2e não roda.
    // Nunca roda startRecipe — a sessão é do usuário.
    view.webContents.on('did-finish-load', () => {
      if (record.closed) return
      record.loading = false
      record.currentUrl = view.webContents.getURL()
      if (record.recording) {
        void this.armRecorder(record)
      }
      this.emit()
    })
    view.webContents.on('did-stop-loading', () => {
      record.loading = false
      record.currentUrl = view.webContents.getURL()
      this.emit()
    })
    view.webContents.on('did-navigate', (_event, url) => {
      record.currentUrl = url
      if (record.recording) {
        record.recording.navigations.push({ at: Date.now(), toUrl: url })
      }
      this.emit()
    })
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      record.currentUrl = url
      if (record.recording) {
        record.recording.navigations.push({ at: Date.now(), toUrl: url })
      }
      this.emit()
    })

    // did-navigate / did-navigate-in-page / did-finish-load já registram a
    // sessão; o branch de gravação entra neles.
    const rec = record.recording
    if (!rec) throw new AppError('INTERNAL', 'Estado de gravação inválido')
    rec.warningTimer = setTimeout(() => {
      if (record.recording) {
        record.recording.durationWarning = true
        record.statusMessage = 'A gravação será encerrada em 5 min.'
        this.emit()
      }
    }, RECORDING_WARNING_DURATION_MS)
    rec.maxDurationTimer = setTimeout(() => {
      void this.finishRecorder(wizardId, {
        partial: true,
        reason: 'Limite de 15 minutos atingido',
      })
    }, RECORDING_MAX_DURATION_MS)
    rec.probeTimer = setInterval(() => {
      void this.probeRecorder(record)
    }, 2_000)

    this.wizards.set(wizardId, {
      wizardId,
      status: 'recording',
      sessionId: id,
      serviceId: service.id,
      clientId: client?.id ?? '',
      authMethod: input.authMethod,
      fingerprintTargetId: credentialId,
      autoSubmitDefault,
      warnings: [],
      compiledSteps: 0,
      compiledRecordedScreens: 0,
      compiled: null,
      startedAt: Date.now(),
    })
    this.record(
      'recipe.record_started',
      wizardId,
      {
        serviceId: service.id,
        clientId: client?.id ?? '',
        authMethod: input.authMethod,
      },
      'recipe',
    )
    this.emitWizardProgress(id, wizardId, true)
    return { sessionId: id, wizardId }
  }

  private clearRecordingTimers(record: ManagedSession): void {
    const rec = record.recording
    if (!rec) return
    if (rec.drainTimer) clearInterval(rec.drainTimer)
    if (rec.probeTimer) clearInterval(rec.probeTimer)
    if (rec.warningTimer) clearTimeout(rec.warningTimer)
    if (rec.maxDurationTimer) clearTimeout(rec.maxDurationTimer)
    rec.drainTimer = null
    rec.probeTimer = null
    rec.warningTimer = null
    rec.maxDurationTimer = null
    record.recording = null
  }

  private async armRecorder(record: ManagedSession): Promise<void> {
    const rec = record.recording
    if (!rec || record.closed) return
    const url = record.view.webContents.getURL()
    if (!url || url === 'about:blank') return
    rec.screen = Math.max(1, rec.screen + 1)
    const screen = `T${rec.screen}`
    const target = this.targetForRecorder(record)
    try {
      const armed = await safeExecute(
        target,
        buildRecorderScript({ token: rec.token, screen }),
        5_000,
      )
      if (!armed) return
    } catch {
      return
    }
    if (!rec.drainTimer) {
      rec.drainTimer = setInterval(() => {
        void this.drainRecorder(record)
      }, 250)
    }
    // E2E (C6) — INJEÇÃO ÚNICA: em builds de teste, o autopilot simula o "usuário"
    // no portal (preenche/clica) UMA vez por sessão. O ramo inteiro é eliminado
    // pelo define+minify do tsup quando NODE_ENV !== 'test'; em produção nem a
    // importação dinâmica (e portanto o módulo) existe no bundle.
    if (
      process.env.NODE_ENV === 'test' &&
      process.env.AURUMBIT_E2E_RECORD_AUTOPILOT === '1' &&
      !record.autopilotDone
    ) {
      record.autopilotDone = true
      try {
        const mod = await import('../recipes/__test__/autopilot.js')
        await safeExecute(target, mod.buildAutopilotScript(), 5_000)
      } catch {
        // Autopilot é best-effort: a sessão de gravação segue mesmo se falhar.
      }
    }
  }

  private async drainRecorder(record: ManagedSession): Promise<void> {
    if (record.closed) return
    const rec = record.recording
    if (!rec) return
    const wizard = this.wizards.get(rec.wizardId)
    if (!wizard) return
    const target = this.targetForRecorder(record)
    const raw = await safeExecute<RecordedDrain>(target, buildDrainScript(rec.token), 5_000)
    if (!raw || !raw.ok) {
      rec.drainFailures += 1
      if (rec.drainFailures >= 5 && record.statusMessage !== 'drain-stuck') {
        record.statusMessage =
          'Não estou conseguindo falar com a página — conclua ou cancele a gravação.'
        record.drainStuck = true
        this.emit()
      }
      return
    }
    // A página respondeu de novo: limpa o estado preso.
    if (record.drainStuck) {
      record.drainStuck = false
      record.statusMessage = 'Página respondeu — pode continuar.'
      this.emit()
    }
    rec.drainFailures = 0
    let gaps = 0
    for (const event of raw.events) {
      if (rec.lastSeq > 0 && event.seq > rec.lastSeq + 1) gaps += event.seq - rec.lastSeq - 1
      rec.lastSeq = Math.max(rec.lastSeq, event.seq)
    }
    rec.gaps += gaps
    rec.events.push(...raw.events)
    rec.secrets.push(...raw.secrets)

    if (!rec.stepCapReached && rec.events.length >= 60) {
      rec.stepCapReached = true
      wizard.warnings.push({
        code: 'step-cap-reached',
        detail:
          'A gravação excedeu 60 etapas — estas são etapas parciais: remova as que não pertencem ao fluxo antes de testar.',
      })
      void this.finishRecorder(rec.wizardId, { partial: true })
      return
    }
    this.emitWizardProgress(record.id, rec.wizardId, false)
  }

  private async probeRecorder(record: ManagedSession): Promise<void> {
    const rec = record.recording
    if (!rec || record.closed || rec.loggedInHint) return
    const row = getRecipeByService(this.deps.db, record.serviceId)
    const definition = row?.definition
    if (!definition) return
    const target = this.targetForRecorder(record)
    try {
      const matched = await checkPostLogin(definition, target, 1_200)
      if (matched) {
        rec.loggedInHint = true
        record.statusMessage = 'Parece que você entrou ✓ — conclua a gravação no assistente.'
        this.emit()
      }
    } catch {
      // Sonda nunca age: no máximo sinaliza o banner.
    }
  }

  private emitWizardProgress(sessionId: string, wizardId: string, immediate: boolean): void {
    const cb = this.deps.onWizardProgress
    if (!cb) return
    const record = sessionId ? this.sessions.get(sessionId) : null
    const rec = record?.recording ?? null
    const wizard = this.wizards.get(wizardId)
    const now = Date.now()
    if (!immediate && rec && !shouldEmitWizardProgress(rec.lastProgressEmit, now)) return
    if (rec) rec.lastProgressEmit = now
    cb({
      wizardId,
      stepCount: rec?.events.length ?? wizard?.compiledSteps ?? 0,
      screen: rec?.screen ?? wizard?.compiledRecordedScreens ?? 0,
      gaps: rec?.gaps ?? 0,
    })
  }

  getWizardState(wizardId: string): WizardState {
    const wizard = this.wizards.get(wizardId)
    if (!wizard) throw new AppError('NOT_FOUND', 'Gravação não encontrada ou já finalizada')
    const record = wizard.sessionId ? (this.sessions.get(wizard.sessionId) ?? null) : null
    const rec = record?.recording ?? null
    return {
      wizardId,
      status: wizard.status,
      stepCount: wizard.compiled ? wizard.compiledSteps : (rec?.events.length ?? 0),
      screenCount: wizard.compiled
        ? wizard.compiledRecordedScreens
        : rec
          ? Math.max(rec.screen, 1)
          : 0,
      gaps: rec?.gaps ?? 0,
      warnings: [...wizard.warnings],
      loggedInHint: rec?.loggedInHint ?? false,
      durationWarning: rec?.durationWarning ?? false,
      definition: wizard.compiled ?? undefined,
    }
  }

  async finishRecorder(
    wizardId: string,
    opts: { partial?: boolean; reason?: string } = {},
  ): Promise<WizardState> {
    const wizard = this.wizards.get(wizardId)
    if (!wizard) throw new AppError('NOT_FOUND', 'Gravação não encontrada')
    if (wizard.status !== 'recording') return this.getWizardState(wizardId)
    wizard.status = 'finishing'

    const record = wizard.sessionId ? (this.sessions.get(wizard.sessionId) ?? null) : null
    const rec = record?.recording ?? null

    // Última drenagem + teardown dos listeners na página.
    if (record && rec) {
      try {
        const target = this.targetForRecorder(record)
        const raw = await safeExecute<RecordedDrain>(target, buildDrainScript(rec.token), 5_000)
        if (raw?.ok) {
          rec.events.push(...raw.events)
          rec.secrets.push(...raw.secrets)
          let gaps = 0
          for (const event of raw.events) {
            if (rec.lastSeq > 0 && event.seq > rec.lastSeq + 1) gaps += event.seq - rec.lastSeq - 1
            rec.lastSeq = Math.max(rec.lastSeq, event.seq)
          }
          rec.gaps += gaps
        }
      } catch {
        // Página morta — eventos já drenados permanecem.
      }
      try {
        const target = this.targetForRecorder(record)
        await safeExecute(target, buildTeardownScript(rec.token), 3_000)
      } catch {
        // Página já destruída — listeners morreram com ela.
      }
    }

    const previousRecipe = getRecipeByService(this.deps.db, wizard.serviceId)?.definition ?? null
    const client = wizard.clientId ? getClient(this.deps.db, wizard.clientId) : null
    const service = getServiceRow(this.deps.db, wizard.serviceId)
    const credentials: CompileCredential[] = []
    if (wizard.fingerprintTargetId) {
      const row = getCredentialRow(this.deps.db, wizard.fingerprintTargetId)
      if (row) {
        credentials.push({
          id: row.id,
          passwordFingerprint: row.passwordFingerprint,
          username: row.username,
        })
      }
    }

    let compiled
    try {
      compiled = compileRecording(rec?.events ?? [], rec?.secrets ?? [], {
        service: service.slug,
        auth: wizard.authMethod,
        autoSubmit: wizard.autoSubmitDefault,
        clientDocument: client?.document ?? null,
        clientName: client?.name ?? null,
        fingerprintTargetId: wizard.fingerprintTargetId,
        credentials,
        navigations: rec?.navigations ?? [],
        previousRecipe,
        vault: {
          fingerprintPassword: (value: string) => this.deps.vault.fingerprintPassword(value),
          constantTimeEqualHex,
        },
      })
    } catch (error) {
      // Falha de compilação NÃO destrói a gravação: mantém a sessão aberta e
      // devolve status 'error' — o assistente mostra o erro e o usuário pode
      // tentar Concluir de novo ou Descartar. Segredos seguem na memória.
      wizard.status = 'error'
      wizard.warnings.push({
        code: 'seed-lost',
        detail: `Não consegui compilar a gravação (${
          error instanceof Error ? error.message : 'erro desconhecido'
        }). Tente concluir de novo ou descarte e regrave.`,
      })
      logger.warn('wizard.compile_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return this.getWizardState(wizardId)
    }
    wizard.warnings = [...wizard.warnings, ...compiled.warnings]
    wizard.compiled = compiled.definition
    wizard.compiledSteps = compiled.definition.steps.length
    wizard.compiledRecordedScreens = compiled.definition.recordedScreens ?? 0
    wizard.status = 'review'

    // Sever segredos da memória o quanto antes.
    if (rec) {
      rec.events = []
      rec.secrets = []
    }

    if (record) {
      this.dispose(
        record,
        opts.reason ?? (opts.partial ? 'Gravação finalizada (limite)' : 'Gravação concluída'),
      )
    }
    this.record(
      'recipe.record_finished',
      wizardId,
      {
        serviceId: wizard.serviceId,
        stepCount: wizard.compiledSteps,
        screens: wizard.compiledRecordedScreens,
        gaps: rec?.gaps ?? 0,
        warnings: wizard.warnings.map((warning) => warning.code),
      },
      'recipe',
    )
    this.emitWizardProgress(wizard.sessionId ?? '', wizardId, true)
    return this.getWizardState(wizardId)
  }

  saveRecordedRecipe(
    wizardId: string,
    input: { autoSubmit: boolean; removedStepIndexes?: number[] },
  ): RecipeSummary {
    const wizard = this.wizards.get(wizardId)
    if (!wizard) throw new AppError('NOT_FOUND', 'Gravação não encontrada')
    if (!wizard.compiled)
      throw new AppError('VALIDATION', 'A gravação ainda não está pronta para salvar')
    let definition = wizard.compiled
    if (input.removedStepIndexes && input.removedStepIndexes.length > 0) {
      const drop = new Set(input.removedStepIndexes)
      definition = {
        ...definition,
        steps: definition.steps.filter((_, index) => !drop.has(index)),
      }
    }
    if (definition.steps.length > 60) {
      throw new AppError('VALIDATION', 'Remova etapas até no máximo 60 antes de salvar')
    }
    const parsed: RecipeDefinition = recipeDefinitionSchema.parse({
      ...definition,
      autoSubmit: input.autoSubmit,
    })
    const summary = saveRecipe(this.deps.db, wizard.serviceId, parsed)
    wizard.status = 'saved'
    this.record(
      'recipe.recorded',
      wizardId,
      {
        serviceId: wizard.serviceId,
        version: summary.version,
        screens: parsed.recordedScreens ?? 0,
        warnings: wizard.warnings.map((warning) => warning.code),
      },
      'recipe',
    )
    this.wizards.delete(wizardId)
    return summary
  }

  cancelRecorder(wizardId: string): void {
    const wizard = this.wizards.get(wizardId)
    if (!wizard) return
    const record = wizard.sessionId ? (this.sessions.get(wizard.sessionId) ?? null) : null
    if (record) {
      this.dispose(record, 'Gravação descartada')
    }
    this.record(
      'recipe.record_discarded',
      wizardId,
      { serviceId: wizard.serviceId, reason: 'cancel' },
      'recipe',
    )
    this.wizards.delete(wizardId)
    this.emitWizardProgress(wizard.sessionId ?? '', wizardId, true)
  }

  discardRecorded(wizardId: string): void {
    const wizard = this.wizards.get(wizardId)
    if (!wizard) return
    this.record(
      'recipe.record_discarded',
      wizardId,
      { serviceId: wizard.serviceId, reason: 'discard' },
      'recipe',
    )
    this.wizards.delete(wizardId)
  }

  private requireSession(id: string): ManagedSession {
    const record = this.sessions.get(id)
    if (!record || record.closed) throw new AppError('NOT_FOUND', 'Sessao nao encontrada')
    return record
  }

  private toView(record: ManagedSession): PortalSession {
    let url = ''
    try {
      url = redactUrl(record.view.webContents.getURL() || record.currentUrl)
    } catch {
      url = redactUrl(record.currentUrl)
    }
    return {
      id: record.id,
      clientId: record.clientId,
      clientName: record.clientName,
      serviceId: record.serviceId,
      serviceName: record.serviceName,
      serviceSlug: record.serviceSlug,
      certificateId: record.certificateId,
      certificate: record.certificateId
        ? {
            id: record.certificateId,
            label: record.certificateLabel ?? 'Certificado',
            holderName: record.certificateHolderName ?? record.clientName,
            thumbprintSha256: record.certificateThumbprintSha256 ?? '',
            validTo: record.certificateValidTo ?? '',
          }
        : null,
      authMethod: record.authMethod,
      partition: record.partition,
      status: record.status,
      statusMessage: record.statusMessage,
      url,
      title: record.title,
      loading: record.loading,
      canGoBack: record.view.webContents.canGoBack(),
      canGoForward: record.view.webContents.canGoForward(),
      recipeRunning: record.recipeRunning,
      openedAt: record.openedAt,
      closedAt: null,
      lastError: record.lastError,
    }
  }

  private emit(): void {
    this.deps.onSessionsChanged(this.list())
  }

  private record(
    type: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
    entity = 'session',
  ): void {
    try {
      appendAuditEvent(this.deps.db, {
        type,
        entity,
        entityId,
        metadata,
      })
    } catch (error) {
      logger.warn('session.audit_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
