/**
 * E2E sob carga — fluxo de trabalho pesado pela UI real (Electron + IPC).
 *
 * Cria 30 clientes PJ e 60 credenciais via ponte `aurumBitPortal.*` dentro da
 * página (mesmo caminho do usuário, com validação Zod no main process),
 * confirma que a UI segue responsiva com o volume e que a auditoria registra
 * todos os eventos sem segredos.
 *
 * Roda contra o build de produção (out/ + dist-electron/). Requer
 * `npm run build` (ou `npm run test:e2e`, que compila antes).
 */
import { test, expect } from '@playwright/test'
import { launchAurumBitPortal, createUserDataDir, removeUserDataDir } from './helpers/app'
import { makeValidCnpj, syntheticPassword } from '../stress/helpers'

const CLIENT_COUNT = 30
const CREDENTIALS_PER_CLIENT = 2
const BUILTIN_SERVICE_IDS = [
  'builtin-govbr',
  'builtin-redesim',
  'builtin-ecac',
  'builtin-jucec',
  'builtin-pendencias-cnpj',
  'builtin-fgts-digital',
  'builtin-esocial',
  'builtin-det-trabalhista',
  'builtin-siga-sefaz-ce',
  'builtin-simples-nacional',
  'builtin-registrato',
  'builtin-dte-sefaz-ce',
]

test.describe('AurumBit Portal - E2E volume (fluxo pesado)', () => {
  test('30 clientes + 60 credenciais via IPC; UI responsiva; auditoria completa', async () => {
    test.setTimeout(180_000)
    const userData = createUserDataDir()
    const { app, page } = await launchAurumBitPortal({ userData })
    const timings: Record<string, number> = {}
    try {
      await expect(page).toHaveTitle(/AurumBit Portal/)

      // --- 30 clientes PJ com documento válido único ---
      const t0 = Date.now()
      const clientIds: string[] = []
      for (let i = 0; i < CLIENT_COUNT; i += 1) {
        const client = await page.evaluate(
          async ({ name, document }) => {
            return (globalThis as any).aurumBitPortal.clients.create({
              type: 'PJ',
              name,
              document,
              consent: true,
              tags: ['stress-e2e'],
            })
          },
          {
            name: `Stress E2E ${String(i + 1).padStart(2, '0')}`,
            document: makeValidCnpj(88000 + i),
          },
        )
        clientIds.push(client.id as string)
      }
      timings.clientsCreateMs = Date.now() - t0
      expect(clientIds).toHaveLength(CLIENT_COUNT)
      console.log('[stress-e2e]', JSON.stringify({ metric: 'e2e.clients_create_30', ...timings }))

      // --- 60 credenciais (2 por cliente, serviços embutidos em rodízio) ---
      const t1 = Date.now()
      const credentialIds: string[] = []
      for (let i = 0; i < CLIENT_COUNT; i += 1) {
        for (let j = 0; j < CREDENTIALS_PER_CLIENT; j += 1) {
          const serviceId =
            BUILTIN_SERVICE_IDS[(i * CREDENTIALS_PER_CLIENT + j) % BUILTIN_SERVICE_IDS.length]
          const credential = await page.evaluate(
            async ({ clientId, serviceId, label, username, password }) => {
              return (globalThis as any).aurumBitPortal.credentials.create({
                clientId,
                serviceId,
                label,
                username,
                usernameType: 'cpf',
                password,
                isDefault: true,
              })
            },
            {
              clientId: clientIds[i],
              serviceId,
              label: `Stress acesso ${j + 1}`,
              username: `52998224725`,
              password: syntheticPassword(91000 + i * 10 + j),
            },
          )
          credentialIds.push(credential.id as string)
        }
      }
      timings.credentialsCreateMs = Date.now() - t1
      expect(credentialIds).toHaveLength(CLIENT_COUNT * CREDENTIALS_PER_CLIENT)
      console.log(
        '[stress-e2e]',
        JSON.stringify({
          metric: 'e2e.credentials_create_60',
          credentialsCreateMs: timings.credentialsCreateMs,
        }),
      )

      // --- 100 revelações de senha pela ponte (login assistido sob carga) ---
      const t2 = Date.now()
      for (let i = 0; i < credentialIds.length; i += 3) {
        const reveal = await page.evaluate(
          async (id) => (globalThis as any).aurumBitPortal.credentials.reveal(id),
          credentialIds[i],
        )
        expect(typeof reveal.password).toBe('string')
      }
      timings.revealMs = Date.now() - t2
      console.log('[stress-e2e]', JSON.stringify({ metric: 'e2e.reveal_20', ...timings }))

      // --- Auditoria agregada: todos os eventos presentes ---
      const t3 = Date.now()
      const audit = await page.evaluate(async () => {
        return (globalThis as any).aurumBitPortal.audit.list({ limit: 500 })
      })
      timings.auditListMs = Date.now() - t3
      const types = (audit as { events: Array<{ type: string }> }).events.map((event) => event.type)
      expect(types.filter((type) => type === 'client.created').length).toBeGreaterThanOrEqual(
        CLIENT_COUNT,
      )
      expect(types.filter((type) => type === 'credential.created').length).toBeGreaterThanOrEqual(
        CLIENT_COUNT * CREDENTIALS_PER_CLIENT,
      )
      expect(JSON.stringify(audit)).not.toContain('Stress!2026-910')
      console.log(
        '[stress-e2e]',
        JSON.stringify({
          metric: 'e2e.audit_list_500',
          auditListMs: timings.auditListMs,
          events: (audit as { events: unknown[] }).events.length,
        }),
      )

      // --- UI segue responsiva com a base volumosa ---
      await page.getByRole('link', { name: 'Clientes' }).first().click()
      await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible()
      await expect(page.getByText('Stress E2E 01', { exact: false }).first()).toBeVisible()

      await page.getByRole('link', { name: 'Auditoria' }).first().click()
      await expect(page.getByRole('heading', { name: /Auditoria/i })).toBeVisible()

      // --- Isolamento de contexto: apenas a janela principal ---
      expect(app.windows()).toHaveLength(1)

      // --- Fronteira de segurança intacta sob volume ---
      expect(await page.evaluate(() => typeof (globalThis as any).require)).toBe('undefined')
      expect(await page.evaluate(() => typeof (globalThis as any).process)).toBe('undefined')
    } finally {
      await app.close()
      removeUserDataDir(userData)
    }
  })
})
