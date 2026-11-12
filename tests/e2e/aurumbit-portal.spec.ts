import { test, expect } from '@playwright/test'
import path from 'node:path'
import { startTestPortal, TEST_USER, TEST_PASSWORD } from './helpers/https-server'
import {
  launchAurumBitPortal,
  createUserDataDir,
  removeUserDataDir,
  seedDatabase,
} from './helpers/app'

const CLIENT_A = '52998224725'
const CLIENT_B = '11144477735'
const SERVICE_ID = 'e2e-local'

test.describe('AurumBit Portal - E2E', () => {
  test('inicializa com fronteira de seguranca, navegacao e CRUD pela API', async () => {
    const userData = createUserDataDir()
    const { app, page } = await launchAurumBitPortal({ userData })
    try {
      await expect(page).toHaveTitle(/AurumBit Portal/)

      const windowHandle = await app.browserWindow(page)
      const preferences = await windowHandle.evaluate((win) => win.webContents.getLastWebPreferences())
      expect(preferences.nodeIntegration).toBe(false)
      expect(preferences.contextIsolation).toBe(true)
      expect(preferences.sandbox).toBe(true)
      expect(preferences.webSecurity).toBe(true)

      const csp = await page.evaluate(async () => (await fetch((globalThis as any).location.href)).headers.get('content-security-policy'))
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-ancestors 'none'")

      expect(await page.evaluate(() => typeof (globalThis as any).aurumBitPortal)).toBe('object')
      expect(await page.evaluate(() => typeof (globalThis as any).require)).toBe('undefined')
      expect(await page.evaluate(() => typeof (globalThis as any).process)).toBe('undefined')

      await page.getByRole('link', { name: 'Clientes' }).first().click()
      await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible()

      await page.getByRole('link', { name: 'Configurações' }).first().click()
      await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()

      const client = await page.evaluate(async (document) => {
        return (globalThis as any).aurumBitPortal.clients.create({
          type: 'PJ',
          name: 'Empresa E2E',
          document,
          consent: true,
        })
      }, CLIENT_A)
      expect(client.id).toBeTruthy()

      const credential = await page.evaluate(
        async ({ clientId, serviceId }) => {
          return (globalThis as any).aurumBitPortal.credentials.create({
            clientId,
            serviceId,
            label: 'Acesso E2E',
            username: '52998224725',
            usernameType: 'cpf',
            password: 'SenhaE2E!2026',
            isDefault: true,
          })
        },
        { clientId: client.id, serviceId: 'builtin-govbr' },
      )
      expect(credential.id).toBeTruthy()

      const reveal = await page.evaluate(
        async (credentialId) => (globalThis as any).aurumBitPortal.credentials.reveal(credentialId),
        credential.id,
      )
      expect(reveal.password).toBe('SenhaE2E!2026')

      const audit = await page.evaluate(() => (globalThis as any).aurumBitPortal.audit.list({ limit: 200 }))
      const types = audit.events.map((event: { type: string }) => event.type)
      expect(types).toContain('client.created')
      expect(types).toContain('credential.created')
      expect(types).toContain('credential.revealed')

      await page.getByRole('link', { name: 'Clientes' }).first().click()
      await page.getByRole('button', { name: 'Novo cliente' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('input').nth(0).fill('Cliente UI')
      await dialog.locator('input').nth(1).fill(CLIENT_B)
      await dialog.getByRole('checkbox').check()
      await dialog.getByRole('button', { name: 'Cadastrar cliente' }).click()
      await expect(page.getByText('Cliente UI')).toBeVisible()
    } finally {
      await app.close()
      removeUserDataDir(userData)
    }
  })

  test('abre sessao isolada, executa autofill assistido, exige envio manual e detecta login', async () => {
    const portal = await startTestPortal()
    const userData = createUserDataDir()
    seedDatabase(path.join(userData, 'aurumbit-portal.db'), {
      serviceId: SERVICE_ID,
      baseUrl: portal.baseUrl,
      withRecipe: true,
    })

    const { app, page } = await launchAurumBitPortal({ userData })
    try {
      const client = await page.evaluate(async (document) => {
        return (globalThis as any).aurumBitPortal.clients.create({
          type: 'PJ',
          name: 'Empresa E2E',
          document,
          consent: true,
        })
      }, CLIENT_A)

      const credential = await page.evaluate(
        async ({ clientId, serviceId }) => {
          return (globalThis as any).aurumBitPortal.credentials.create({
            clientId,
            serviceId,
            label: 'Acesso E2E',
            username: '52998224725',
            usernameType: 'cpf',
            password: 'SenhaE2E!2026',
            isDefault: true,
          })
        },
        { clientId: client.id, serviceId: SERVICE_ID },
      )

      const opened = await page.evaluate(
        async ({ serviceId, clientId, credentialId }) => {
          return (globalThis as any).aurumBitPortal.sessions.open({
            serviceId,
            clientId,
            authMethod: 'password',
            credentialId,
          })
        },
        { serviceId: SERVICE_ID, clientId: client.id, credentialId: credential.id },
      )
      expect(opened.reused).toBe(false)
      const sessionId = opened.sessionId

      const sessionWindow = await app.waitForEvent('window', {
        predicate: (window) => window.url().includes(`sessionId=${sessionId}`),
      })
      await sessionWindow.waitForLoadState('domcontentloaded')

      await expect(sessionWindow.getByText(client.name)).toBeVisible()

      const layout = await app.evaluate(
        ({ BrowserWindow }, currentSessionId) => {
          const win = BrowserWindow.getAllWindows().find((item) =>
            item.webContents.getURL().includes(`sessionId=${currentSessionId}`),
          )
          if (!win) return null
          const [width, height] = win.getContentSize()
          const child = (win.contentView.children as any[]).find((item: any) => item?.webContents)
          return { width, height, bounds: child?.getBounds?.() ?? null }
        },
        sessionId,
      )
      expect(layout).not.toBeNull()
      expect(layout!.bounds).toMatchObject({ x: 0, y: 96 })
      expect((layout as any).bounds.height).toBe((layout as any).height - 96 - 26)

      await expect
        .poll(
          async () => {
            const value = await app.evaluate(async ({ webContents }) => {
              const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1'))
              if (!wc) return null
              return wc.executeJavaScript(
                `document.querySelector('#user')?.value ?? ''`,
              )
            })
            return value
          },
          { timeout: 15_000 },
        )
        .toBe(TEST_USER)

      await expect
        .poll(
          async () => {
            const value = await app.evaluate(async ({ webContents }) => {
              const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1'))
              if (!wc) return null
              return wc.executeJavaScript(
                `document.querySelector('#pass')?.value ?? ''`,
              )
            })
            return value
          },
          { timeout: 15_000 },
        )
        .toBe(TEST_PASSWORD)

      const remoteBoundary = await app.evaluate(async ({ webContents }) => {
        const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1'))
        if (!wc) return null
        return wc.executeJavaScript(
          `({ require: typeof require, process: typeof process, aurumBitPortal: typeof window.aurumBitPortal })`,
        )
      })
      expect(remoteBoundary).toMatchObject({
        require: 'undefined',
        process: 'undefined',
        aurumBitPortal: 'undefined',
      })

      await expect
        .poll(
          async () => {
            const details = await sessionWindow.evaluate(
              async (id) => (globalThis as any).aurumBitPortal.sessions.details(id),
              sessionId,
            )
            return details?.status
          },
          { timeout: 15_000 },
        )
        .toBe('awaiting_login')

      expect(portal.requests.some((request) => request.method === 'POST' && request.path === '/login')).toBe(false)

      await sessionWindow.getByRole('button', { name: 'Credencial manual' }).click()
      await expect(sessionWindow.getByLabel('Usuario da credencial')).toHaveValue(TEST_USER)
      await expect(sessionWindow.getByLabel('Senha da credencial')).toHaveValue(TEST_PASSWORD)

      const audit = await page.evaluate(() => (globalThis as any).aurumBitPortal.audit.list({ limit: 200 }))
      expect(audit.events.some((event: { type: string }) => event.type === 'credential.revealed')).toBe(true)

      await app.evaluate(async ({ webContents }) => {
        const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1'))
        if (!wc) return
        await wc.executeJavaScript(`document.querySelector('#entrar')?.click()`)
      })

      await expect
        .poll(
          async () => {
            const value = await app.evaluate(async ({ webContents }) => {
              const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1'))
              if (!wc) return ''
              return wc.getURL()
            })
            return value
          },
          { timeout: 15_000 },
        )
        .toContain('/painel')

      await expect
        .poll(
          async () => {
            const details = await sessionWindow.evaluate(
              async (id) => (globalThis as any).aurumBitPortal.sessions.details(id),
              sessionId,
            )
            return details?.status
          },
          { timeout: 20_000 },
        )
        .toBe('authenticated')

      const auditAfterLogin = await page.evaluate(() => (globalThis as any).aurumBitPortal.audit.list({ limit: 200 }))
      expect(auditAfterLogin.events.some((event: { type: string }) => event.type === 'session.auth_detected')).toBe(true)

      await expect(
        sessionWindow.evaluate(async (id) => (globalThis as any).aurumBitPortal.sessions.navigate(id, 'https://evil.example'), sessionId),
      ).rejects.toThrow(/allowlist do servico/)

      await sessionWindow.locator('button[title="Fechar sessão"]').click()
      await expect.poll(() => app.windows().length, { timeout: 10_000 }).toBe(1)
    } finally {
      await app.close()
      removeUserDataDir(userData)
      await portal.close()
    }
  })

  test('isola particoes entre clientes e reutiliza sessao do mesmo contexto', async () => {
    const portal = await startTestPortal()
    const userData = createUserDataDir()
    seedDatabase(path.join(userData, 'aurumbit-portal.db'), {
      serviceId: SERVICE_ID,
      baseUrl: portal.baseUrl,
      withRecipe: false,
    })

    const { app, page } = await launchAurumBitPortal({ userData })
    try {
      const clientA = await page.evaluate(async (document) => {
        return (globalThis as any).aurumBitPortal.clients.create({
          type: 'PJ',
          name: 'Cliente A',
          document,
          consent: true,
        })
      }, CLIENT_A)

      const clientB = await page.evaluate(async (document) => {
        return (globalThis as any).aurumBitPortal.clients.create({
          type: 'PJ',
          name: 'Cliente B',
          document,
          consent: true,
        })
      }, CLIENT_B)

      const credentialA = await page.evaluate(
        async ({ clientId, serviceId }) => {
          return (globalThis as any).aurumBitPortal.credentials.create({
            clientId,
            serviceId,
            label: 'Acesso A',
            username: '52998224725',
            usernameType: 'cpf',
            password: 'SenhaE2E!2026',
            isDefault: true,
          })
        },
        { clientId: clientA.id, serviceId: SERVICE_ID },
      )

      const credentialB = await page.evaluate(
        async ({ clientId, serviceId }) => {
          return (globalThis as any).aurumBitPortal.credentials.create({
            clientId,
            serviceId,
            label: 'Acesso B',
            username: '52998224725',
            usernameType: 'cpf',
            password: 'SenhaE2E!2026',
            isDefault: true,
          })
        },
        { clientId: clientB.id, serviceId: SERVICE_ID },
      )

      const openedA = await page.evaluate(
        async ({ serviceId, clientId, credentialId }) => {
          return (globalThis as any).aurumBitPortal.sessions.open({
            serviceId,
            clientId,
            authMethod: 'password',
            credentialId,
          })
        },
        { serviceId: SERVICE_ID, clientId: clientA.id, credentialId: credentialA.id },
      )

      const openedB = await page.evaluate(
        async ({ serviceId, clientId, credentialId }) => {
          return (globalThis as any).aurumBitPortal.sessions.open({
            serviceId,
            clientId,
            authMethod: 'password',
            credentialId,
          })
        },
        { serviceId: SERVICE_ID, clientId: clientB.id, credentialId: credentialB.id },
      )

      expect(openedA.reused).toBe(false)
      expect(openedB.reused).toBe(false)
      expect(openedA.sessionId).not.toBe(openedB.sessionId)

      await expect
        .poll(() => app.windows().filter((window) => window.url().includes('sessionId=')).length, {
          timeout: 15_000,
        })
        .toBe(2)

      const detailsA = await page.evaluate(async (id) => (globalThis as any).aurumBitPortal.sessions.details(id), openedA.sessionId)
      const detailsB = await page.evaluate(async (id) => (globalThis as any).aurumBitPortal.sessions.details(id), openedB.sessionId)
      expect(detailsA.partition).not.toBe(detailsB.partition)

      await app.evaluate(
        async ({ webContents, session }, partition) => {
          const targetSession = session.fromPartition(partition)
          const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1') && item.session === targetSession)
          if (!wc) return
          await wc.executeJavaScript(`localStorage.setItem('pv-isolation', 'cliente-a')`)
        },
        detailsA.partition,
      )

      // O WebContentsView de B pode levar alguns instantes para commitar a
      // navegacao; aguarda a webContents existir antes de ler o storage.
      await expect
        .poll(
          async () => {
            const found = await app.evaluate(
              async ({ webContents, session }, partition) => {
                const targetSession = session.fromPartition(partition)
                return webContents
                  .getAllWebContents()
                  .some(
                    (item) =>
                      item.getURL().startsWith('https://127.0.0.1') &&
                      item.session === targetSession,
                  )
              },
              detailsB.partition,
            )
            return found
          },
          { timeout: 20_000 },
        )
        .toBe(true)

      const valueInB = await app.evaluate(
        async ({ webContents, session }, partition) => {
          const targetSession = session.fromPartition(partition)
          const wc = webContents.getAllWebContents().find((item) => item.getURL().startsWith('https://127.0.0.1') && item.session === targetSession)
          if (!wc) return 'SEM_WEB_CONTENTS'
          return wc.executeJavaScript(`localStorage.getItem('pv-isolation')`)
        },
        detailsB.partition,
      )
      expect(valueInB).toBeNull()

      const reopened = await page.evaluate(
        async ({ serviceId, clientId, credentialId }) => {
          return (globalThis as any).aurumBitPortal.sessions.open({
            serviceId,
            clientId,
            authMethod: 'password',
            credentialId,
          })
        },
        { serviceId: SERVICE_ID, clientId: clientA.id, credentialId: credentialA.id },
      )
      expect(reopened.reused).toBe(true)
      expect(reopened.sessionId).toBe(openedA.sessionId)

      for (const window of app.windows().filter((item) => item.url().includes('sessionId='))) {
        await window.locator('button[title="Fechar sessão"]').click().catch(() => undefined)
      }
      await expect.poll(() => app.windows().length, { timeout: 10_000 }).toBe(1)
    } finally {
      await app.close()
      removeUserDataDir(userData)
      await portal.close()
    }
  })
})
