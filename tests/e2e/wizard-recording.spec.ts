import { expect, test } from '@playwright/test'
import { createUserDataDir, launchAurumBitPortal, removeUserDataDir } from './helpers/app'
import { startTestPortal } from './helpers/https-server'

const APP_NAME = 'Novo acesso'

test.describe('Gravação Assistida — criar → ensinar → salvar', () => {
  test('fluxo completo salva receita com origin: recorded', async () => {
    const portal = await startTestPortal()
    const userData = createUserDataDir()
    let app: Awaited<ReturnType<typeof launchAurumBitPortal>>['app'] | undefined
    try {
      const launched = await launchAurumBitPortal({ userData })
      app = launched.app
      const { page } = launched

      // Cliente de teste via API do renderer
      const client = await page.evaluate(async () => {
        const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
        return api.clients.create({
          type: 'PF',
          name: 'E2E Gravação',
          document: '52998224725',
          consent: true,
        })
      })
      expect(client?.id).toBeTruthy()

      // Etapa 1 — dados básicos
      await page.getByRole('button', { name: APP_NAME }).click()
      await page.getByLabel('Nome do site').fill('Portal Gravação E2E')
      await page.getByLabel('Endereço do site').fill(portal.baseUrl)
      await page.getByRole('button', { name: 'Salvar e continuar →' }).click()

      // Etapa 2 — Ensinar o robô
      await expect(page.getByText('Quer ensinar o login ao AurumBit?')).toBeVisible({
        timeout: 5_000,
      })
      await page.getByRole('radio', { name: /Login e senha/ }).click()
      await page
        .getByRole('combobox', { name: /Qual cliente usa este acesso/ })
        .selectOption(client.id)
      await page.getByRole('button', { name: 'Ensinar agora' }).click()

      // Janela do portal (chrome /session) — espera aparecer
      await expect
        .poll(() => app?.windows().filter((item) => item.url().includes('sessionId=')).length, {
          timeout: 15_000,
        })
        .toBe(1)
      const portalWindow = app.windows().find((item) => item.url().includes('sessionId='))!

      // A barra de gravação vive no chrome do portal — visível e clicável
      const finishButton = portalWindow.getByRole('button', { name: 'Concluir gravação' })
      await expect(finishButton).toBeVisible({ timeout: 15_000 })
      await finishButton.click()

      // Etapa 3 — Revisão no modal (janela principal)
      await expect(page.getByRole('heading', { name: 'Revise o robô' })).toBeVisible({
        timeout: 10_000,
      })
      await page.getByRole('button', { name: 'Salvar robô' }).click()

      // Salvo
      await expect(page.getByText('Robô salvo para este acesso.')).toBeVisible({
        timeout: 10_000,
      })
      await page.getByRole('button', { name: 'Testar depois' }).click()

      // Receita persistida com origin recorded
      const recipe = await page.evaluate(async () => {
        const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
        const list = await api.services.list()
        const service = list.find((item: { name: string }) => item.name === 'Portal Gravação E2E')
        return api.recipes.get(service.id)
      })
      expect(recipe?.definition?.origin).toBe('recorded')

      // Boot roundtrip: fecha o app e reabre uma nova instância com o mesmo
      // userData — o heal do boot NÃO pode reescrever a receita gravada.
      await app.close()
      const relaunched = await launchAurumBitPortal({ userData })
      try {
        const bootRecipe = await relaunched.page.evaluate(async () => {
          const api = (globalThis as unknown as { aurumBitPortal: any }).aurumBitPortal
          const list = await api.services.list()
          const service = list.find((item: { name: string }) => item.name === 'Portal Gravação E2E')
          return api.recipes.get(service.id)
        })
        expect(bootRecipe?.definition?.origin).toBe('recorded')
      } finally {
        await relaunched.app.close()
      }
    } finally {
      await portal.close().catch(() => undefined)
      removeUserDataDir(userData)
    }
  })
})
