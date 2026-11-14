import { expect, test } from '@playwright/test'
import path from 'node:path'
import {
  createUserDataDir,
  launchAurumBitPortal,
  removeUserDataDir,
  seedDatabase,
} from './helpers/app'
import { startTestPortal, TEST_PASSWORD, TEST_USER } from './helpers/https-server'

const APP_NAME = 'Novo acesso'

async function createClient(page: import('@playwright/test').Page, name: string) {
  return page.evaluate(async (clientName) => {
    const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
    return api.clients.create({
      type: 'PF',
      name: clientName,
      document: '52998224725',
      consent: true,
    })
  }, name)
}

async function findServiceIdByName(
  page: import('@playwright/test').Page,
  name: string,
): Promise<string | undefined> {
  return page.evaluate(async (target) => {
    const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
    const list = await api.services.list()
    return list.find((item: { name: string }) => item.name === target)?.id
  }, name)
}

async function findRecordedSessionUrl(
  page: import('@playwright/test').Page,
  serviceId: string,
): Promise<string> {
  const list = await page.evaluate(async () => {
    const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
    return api.sessions.list()
  })
  const session = list.find((item: { serviceId: string }) => item.serviceId === serviceId)
  return session?.url ?? ''
}

test.describe('Gravação Assistida — variantes negativas e autopilot', () => {
  test('página que nunca estabiliza: robô é salvo e wizard:finish não trava', async () => {
    const portal = await startTestPortal()
    const userData = createUserDataDir()
    const brokenUrl = `${portal.baseUrl}wizard-broken`
    seedDatabase(path.join(userData, 'aurumbit-portal.db'), {
      serviceId: 'e2e-wizard-broken',
      baseUrl: brokenUrl,
      withRecipe: false,
    })
    let app: Awaited<ReturnType<typeof launchAurumBitPortal>>['app'] | undefined
    try {
      const launched = await launchAurumBitPortal({ userData })
      app = launched.app
      const { page } = launched

      const client = await createClient(page, 'E2E Quebrado')
      expect(client?.id).toBeTruthy()

      await page.getByRole('button', { name: APP_NAME }).click()
      await page.getByLabel('Nome do site').fill('Quebrado E2E')
      await page.getByLabel('Endereço do site').fill(brokenUrl)
      await page.getByRole('button', { name: 'Salvar e continuar →' }).click()

      await expect(page.getByText('Quer ensinar o login ao AurumBit?')).toBeVisible({
        timeout: 5_000,
      })
      await page.getByRole('radio', { name: /Login e senha/ }).click()
      await page
        .getByRole('combobox', { name: /Qual cliente usa este acesso/ })
        .selectOption(client.id)
      await page.getByRole('button', { name: 'Ensinar agora' }).click()

      await expect
        .poll(() => app?.windows().filter((item) => item.url().includes('sessionId=')).length, {
          timeout: 15_000,
        })
        .toBe(1)
      const portalWindow = app.windows().find((item) => item.url().includes('sessionId='))!

      // Portal que nunca estabiliza (spinner eterno) — a gravação abre mesmo assim.
      const finishButton = portalWindow.getByRole('button', { name: 'Concluir gravação' })
      await expect(finishButton).toBeVisible({ timeout: 15_000 })
      const finishStarted = Date.now()
      await finishButton.click()
      // wizard:finish retorna em tempo razoável: a compilação não pode depender
      // da página estabilizar.
      await expect(page.getByRole('heading', { name: 'Revise o robô' })).toBeVisible({
        timeout: 10_000,
      })
      expect(Date.now() - finishStarted).toBeLessThan(15_000)

      await page.getByRole('button', { name: 'Salvar robô' }).click()
      await expect(page.getByText('Robô salvo para este acesso.')).toBeVisible({
        timeout: 10_000,
      })

      const recipe = await page.evaluate(async () => {
        const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
        const list = await api.services.list()
        const service = list.find((item: { name: string }) => item.name === 'Quebrado E2E')
        return api.recipes.get(service.id)
      })
      expect(recipe?.definition?.origin).toBe('recorded')

      await app.close()
    } finally {
      await portal.close().catch(() => undefined)
      removeUserDataDir(userData)
    }
  })

  test('autopilot (build de teste): login por gravação termina no painel e o robô vira verified', async () => {
    // Só roda quando o build tem o ramo NODE_ENV=test (tsup define). Na suíte
    // padrão (build de produção) o autopilot nem existe no binário — e2e skip.
    test.skip(
      process.env.NODE_ENV !== 'test',
      'autopilot requer build NODE_ENV=test (`NODE_ENV=test npm run build:main`)',
    )
    test.setTimeout(120_000)
    const portal = await startTestPortal()
    const userData = createUserDataDir()
    const loginUrl = `${portal.baseUrl}wizard-login`
    let app: Awaited<ReturnType<typeof launchAurumBitPortal>>['app'] | undefined
    try {
      const launched = await launchAurumBitPortal({
        userData,
        extraEnv: { AURUMBIT_E2E_RECORD_AUTOPILOT: '1' },
      })
      app = launched.app
      const { page } = launched

      const client = await createClient(page, 'E2E Autopilot')
      expect(client?.id).toBeTruthy()

      await page.getByRole('button', { name: APP_NAME }).click()
      await page.getByLabel('Nome do site').fill('Portal Autopilot E2E')
      await page.getByLabel('Endereço do site').fill(loginUrl)
      // Fluxo somente "Login e senha" (o padrão é "Os dois", cuja gravação
      // salva por merge de dois passes e ignora a chave "Entrar sozinho").
      await page.getByRole('radio', { name: 'Login e senha' }).click()
      await page.getByRole('button', { name: 'Salvar e continuar →' }).click()
      await expect(page.getByText('Quer ensinar o login ao AurumBit?')).toBeVisible({
        timeout: 5_000,
      })

      // Credencial do acesso — a gravação precisa dela para o "Testar agora"
      // preencher o formulário de verdade.
      const serviceId = await findServiceIdByName(page, 'Portal Autopilot E2E')
      expect(serviceId).toBeTruthy()
      const credential = await page.evaluate(
        async (input) => {
          const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
          return api.credentials.create(input)
        },
        {
          clientId: client.id,
          serviceId,
          label: 'Acesso Autopilot',
          username: TEST_USER,
          usernameType: 'cpf' as const,
          password: TEST_PASSWORD,
          isDefault: true,
        },
      )
      expect(credential?.id).toBeTruthy()

      // O seletor "Qual fluxo você quer ensinar?" só existe quando o serviço
      // tem mais de um método — fluxo só senha já nasce com senha selecionada.
      const flowRadio = page.getByRole('radio', { name: /Login e senha/ })
      if ((await flowRadio.count()) > 0) {
        await flowRadio.first().click()
      }
      await page
        .getByRole('combobox', { name: /Qual cliente usa este acesso/ })
        .selectOption(client.id)
      // A query de credenciais dispara ao selecionar o cliente; espera a opção
      // existir antes de selecionar (o select espera o option aparecer).
      await page
        .getByRole('combobox', { name: /Qual credencial vincular/ })
        .selectOption({ label: TEST_USER })
      await page.getByRole('button', { name: 'Ensinar agora' }).click()

      await expect
        .poll(() => app?.windows().filter((item) => item.url().includes('sessionId=')).length, {
          timeout: 15_000,
        })
        .toBe(1)
      const portalWindow = app.windows().find((item) => item.url().includes('sessionId='))!

      // O autopilot (injetado no did-finish-load do portal, só em build de
      // teste) preenche #wuser/#wpass e clica #entrar — a sessão termina no
      // /wizard-painel.
      await expect
        .poll(() => findRecordedSessionUrl(page, serviceId!), { timeout: 25_000 })
        .toContain('wizard-painel')

      const finishButton = portalWindow.getByRole('button', { name: 'Concluir gravação' })
      await expect(finishButton).toBeVisible({ timeout: 15_000 })
      await finishButton.click()
      await expect(page.getByRole('heading', { name: 'Revise o robô' })).toBeVisible({
        timeout: 10_000,
      })

      // A senha E2E não aparece em lugar nenhum da UI — só placeholders.
      expect(await page.locator('body').innerText()).not.toContain(TEST_PASSWORD)

      // O clique gravado já dispara o submit do formulário — desliga o
      // "Entrar sozinho", senão o runner tenta auto-enviar de novo no painel
      // (que não tem campo de senha) e a verificação falha por construção.
      await page.getByRole('switch', { name: 'Entrar sozinho' }).click()

      await page.getByRole('button', { name: 'Salvar robô' }).click()
      await expect(page.getByText('Robô salvo para este acesso.')).toBeVisible({
        timeout: 10_000,
      })

      const saved = await page.evaluate(async (id) => {
        const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
        return api.recipes.get(id)
      }, serviceId)
      expect(saved?.definition?.origin).toBe('recorded')
      const fills = (saved?.definition?.steps ?? []).filter(
        (step: { action: string }) => step.action === 'fill',
      )
      expect(fills.length).toBeGreaterThan(0)
      for (const step of fills) {
        // Placeholder resolvível (o CPF digitado vira {{client.document}}
        // quando bate com o documento do cliente — comportamento por design);
        // o valor literal da senha nunca aparece.
        expect(step.value).toMatch(/^\{\{(credential\.|client\.)/)
        expect(step.value).not.toContain(TEST_PASSWORD)
      }

      // "Testar agora": sessão de verificação roda a receita gravada e o
      // pós-login é detectado — o robô passa a verified.
      await page.getByRole('button', { name: 'Testar agora' }).click()
      await expect
        .poll(
          async () => {
            const current = await page.evaluate(async (id) => {
              const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
              return api.recipes.get(id)
            }, serviceId)
            return current?.status ?? ''
          },
          { timeout: 60_000 },
        )
        .toBe('verified')

      await app.close()
    } finally {
      await portal.close().catch(() => undefined)
      removeUserDataDir(userData)
    }
  })
})
