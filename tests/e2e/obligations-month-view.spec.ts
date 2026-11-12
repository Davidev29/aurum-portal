import { test, expect } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'
import { launchAurumBitPortal, createUserDataDir, removeUserDataDir } from './helpers/app'

const CPF_A = '52998224725'
const CPF_B = '11144477735'

test('obrigações — visão do mês: painel por empresa, calendário e baixa com check', async () => {
  const userData = createUserDataDir()
  const { app, page } = await launchAurumBitPortal({ userData })
  try {
    const seeded = await page.evaluate(
      async ({ cpfA, cpfB }) => {
        const api = (globalThis as any).aurumBitPortal
        const department = await api.obligations.createDepartment({ name: 'Fiscal' })
        const obligation = await api.obligations.createObligation({
          name: 'DCTF',
          sigla: 'DCTF',
          departmentId: department.id,
          recurrence: 'mensal',
          dueRule: 'dia_fixo',
          diaFixo: 15,
          antecedenciaNotificacaoDias: 7,
          active: true,
        })
        const clientA = await api.clients.create({
          type: 'PJ',
          name: 'Empresa Alfa',
          document: cpfA,
          consent: true,
        })
        const clientB = await api.clients.create({
          type: 'PJ',
          name: 'Empresa Beta',
          document: cpfB,
          consent: true,
        })
        const linkA = await api.obligations.setLink({
          clientId: clientA.id,
          obligationId: obligation.id,
          active: true,
        })
        const linkB = await api.obligations.setLink({
          clientId: clientB.id,
          obligationId: obligation.id,
          active: true,
        })
        // Backdate o início dos vínculos para a ocorrência deste mês valer.
        await api.obligations.updateLink({ id: linkA.link.id, dataInicio: '2020-01-01' })
        await api.obligations.updateLink({ id: linkB.link.id, dataInicio: '2020-01-01' })
        return { sigla: obligation.sigla }
      },
      { cpfA: CPF_A, cpfB: CPF_B },
    )
    expect(seeded.sigla).toBe('DCTF')

    const now = new Date()
    const dueLabel = `${String(15).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`

    // Aba padrão do módulo é a visão do mês ("Obrigações").
    await page.getByRole('link', { name: 'Obrigações' }).first().click()
    await expect(page.getByRole('heading', { name: 'Empresas' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Empresa Alfa/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Empresa Beta/ })).toBeVisible()

    // O dia 15 do calendário abre o modal do dia.
    await page.getByRole('button', { name: new RegExp(`em ${dueLabel}`) }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('0 de 2 obrigações baixadas')).toBeVisible()

    // Baixa (check) das duas entregas.
    await dialog.getByRole('button', { name: /Empresa Alfa/ }).click()
    await dialog.getByRole('button', { name: /Empresa Beta/ }).click()
    await expect(dialog.getByText('2 de 2 obrigações baixadas')).toBeVisible()
    await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    // Aguarda a transição da barra de progresso antes da captura.
    await page.waitForTimeout(400)

    const monthShot = path.join(os.tmpdir(), 'aurumbit-obrigacoes-mes.png')
    await page.screenshot({ path: monthShot, fullPage: true })
    console.log(`screenshot-mes: ${monthShot}`)

    await dialog.getByText('Fechar', { exact: true }).click()

    // Painel esquerdo: expandir a empresa mostra a entrega como baixada.
    const alfaToggle = page.getByRole('button', { name: /Empresa Alfa/ })
    await alfaToggle.click()
    await expect(alfaToggle).toHaveAttribute('aria-expanded', 'true')
    // Aguarda a transição do accordion (grid-template-rows + opacity, 200 ms)
    // e confirma que o conteúdo realmente abriu.
    const alfaPanel = page.locator('[id^="month-view-client-"]').first()
    await expect(alfaPanel).toHaveCSS('opacity', '1')
    await expect(alfaPanel.locator('ul').first()).toBeVisible()
    await expect(page.getByText('Entregue').first()).toBeVisible()

    const viewShot = path.join(os.tmpdir(), 'aurumbit-obrigacoes-visao.png')
    await page.screenshot({ path: viewShot })
    console.log(`screenshot-visao: ${viewShot}`)

    // Dia vazio: modal mostra "Tudo tranquilo" e permite adicionar feriado na hora.
    const emptyLabel = `10/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`
    await page
      .getByRole('button', { name: new RegExp(`Nenhuma obrigação em ${emptyLabel}`) })
      .click()
    const emptyDialog = page.getByRole('dialog')
    await expect(emptyDialog.getByText('Tudo tranquilo neste dia')).toBeVisible()
    await emptyDialog.getByRole('button', { name: 'Adicionar feriado' }).click()
    await emptyDialog.getByLabel('Nome do feriado').fill('Aniversário da cidade')
    await emptyDialog.getByRole('radio', { name: 'Ícone Aniversário' }).click()
    await emptyDialog.getByRole('radio', { name: /^Cor #6d28d9$/ }).click()
    await emptyDialog.getByRole('button', { name: 'Adicionar feriado' }).click()
    await expect(emptyDialog.getByText('Aniversário da cidade')).toBeVisible()

    const emptyShot = path.join(os.tmpdir(), 'aurumbit-obrigacoes-feriado.png')
    await page.waitForTimeout(300)
    await page.screenshot({ path: emptyShot })
    console.log(`screenshot-feriado: ${emptyShot}`)

    await emptyDialog.getByText('Fechar', { exact: true }).click()

    // A aba "Catálogo" é o antigo "Obrigações" (cadastro da obrigação).
    await page.getByRole('tab', { name: 'Catálogo' }).click()
    await expect(page.getByRole('button', { name: 'Nova obrigação' })).toBeVisible()

    // Matriz: a coluna dedicada "Ações" não existe mais e as ações ficam sob o cliente.
    await page.getByRole('tab', { name: 'Matriz de vínculos' }).click()
    await expect(page.getByRole('columnheader', { name: 'Ações' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Copiar vínculos de Empresa Alfa/ }),
    ).toBeAttached()

    const matrixShot = path.join(os.tmpdir(), 'aurumbit-obrigacoes-matriz.png')
    await page.locator('table').hover()
    await page.screenshot({ path: matrixShot, fullPage: true })
    console.log(`screenshot-matriz: ${matrixShot}`)
  } finally {
    await app.close()
    removeUserDataDir(userData)
  }
})
