/**
 * Verificação visual + funcional do modal de credencial com o fluxo
 * legenda + valor (o robô localiza cada campo pela legenda na tela).
 * Uso: npx tsx scripts/verify-credential-dialog.mts
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
import {
  launchAurumBitPortal,
  createUserDataDir,
  removeUserDataDir,
} from '../tests/e2e/helpers/app'

const OUT = path.resolve(HERE, '../.preview/shots')

interface CredentialFieldView {
  name: string
  kind: string
}
interface CredentialView {
  id: string
  label: string
  fields: CredentialFieldView[] | null
}
interface Bridge {
  clients: {
    create(input: {
      type: 'PJ'
      name: string
      document: string
      consent: boolean
    }): Promise<{ id: string }>
  }
  credentials: {
    list(filter?: Record<string, never>): Promise<CredentialView[]>
  }
}
async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })
  const userData = createUserDataDir()
  const { app, page } = await launchAurumBitPortal({ userData })
  try {
    await page.waitForLoadState('domcontentloaded')

    // Cliente de teste direto pelo bridge (o formulário de cliente não é o alvo).
    const client = await page.evaluate(async () =>
      (globalThis as unknown as { aurumBitPortal: Bridge }).aurumBitPortal.clients.create({
        type: 'PJ',
        name: 'Empresa Verify LTDA',
        document: '52998224725',
        consent: true,
      }),
    )
    console.log('client:', client.id)

    // Abre o detalhe do cliente pela UI.
    await page.getByRole('link', { name: 'Clientes' }).first().click()
    await page
      .getByRole('link', { name: /Empresa Verify LTDA/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Nova credencial' }).first().click()
    await page.getByRole('dialog').waitFor()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel(/Serviço/).selectOption({ label: 'gov.br' })
    await dialog.getByLabel(/Rotulo/).fill('Acesso Verify')
    // Legendas padrão dos campos convencionais (editáveis).
    const userLegend = dialog.getByLabel('Legenda do campo Usuário no portal')
    const passLegend = dialog.getByLabel('Legenda do campo Senha no portal')
    console.log('legenda padrao usuario:', await userLegend.inputValue())
    console.log('legenda padrao senha:', await passLegend.inputValue())
    await userLegend.fill('CPF')
    await passLegend.fill('Senha')
    await dialog.getByLabel('Valor do campo Usuário').fill('52998224725')
    await dialog.locator('input[autocomplete="new-password"]').fill('SenhaForte!2026')

    const extraHeading = dialog.getByText('Campos adicionais', { exact: true })
    await extraHeading.waitFor()
    console.log('painel de campos adicionais visivel:', await extraHeading.isVisible())

    // Adiciona duas linhas: legenda + valor.
    await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click()
    await dialog.getByRole('button', { name: 'Adicionar', exact: true }).click()
    const nameInputs = dialog.getByLabel(/Legenda do campo no portal/)
    const valueInputs = dialog.getByLabel('Valor do campo extra')
    await nameInputs.nth(0).fill('Código da empresa')
    await valueInputs.nth(0).fill('EMP-123')
    await nameInputs.nth(1).fill('PIN')
    await valueInputs.nth(1).fill('9999')

    // Legenda duplicada (case-insensitive) deve bloquear o salvar com aviso.
    await nameInputs.nth(1).fill('senha')
    const dupWarningCreate = dialog.getByRole('alert').filter({ hasText: 'Legenda repetida' })
    await dupWarningCreate.waitFor()
    const saveBlocked = await dialog
      .getByRole('button', { name: 'Adicionar ao cofre' })
      .isDisabled()
    console.log('duplicada detectada, salvar bloqueado:', saveBlocked)
    await nameInputs.nth(1).fill('PIN')
    await dupWarningCreate.waitFor({ state: 'detached' })
    await page.screenshot({ path: path.join(OUT, 'credential-extra-fields-filled.png') })

    // Salva de verdade.
    await dialog.getByRole('button', { name: 'Adicionar ao cofre' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })

    const listed = await page.evaluate(async () =>
      (globalThis as unknown as { aurumBitPortal: Bridge }).aurumBitPortal.credentials.list({}),
    )
    const saved = listed.find((c) => c.label === 'Acesso Verify')
    console.log('fields salvos:', JSON.stringify(saved?.fields))
    const savedNames = (saved?.fields ?? []).map((f) => `${f.kind}:${f.name}`)
    if (
      JSON.stringify(savedNames) !==
      JSON.stringify(['username:CPF', 'password:Senha', 'text:Código da empresa', 'text:PIN'])
    ) {
      throw new Error('campos salvos incorretos: ' + JSON.stringify(saved?.fields))
    }

    // Reabre em modo edição: linhas preenchidas pela legenda, valores vazios.
    await page.getByRole('tab', { name: /Credenciais/ }).click()
    await page.getByRole('button', { name: 'Editar credencial' }).first().click()
    await page.getByRole('dialog').waitFor()
    const editDialog = page.getByRole('dialog')
    const nameValues = await editDialog
      .getByLabel(/Legenda do campo no portal/)
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    const valueValues = await editDialog
      .getByLabel('Valor do campo extra')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    console.log(
      'edicao — legendas:',
      JSON.stringify(nameValues),
      'valores:',
      JSON.stringify(valueValues),
    )
    if (JSON.stringify(nameValues) !== JSON.stringify(['Código da empresa', 'PIN'])) {
      throw new Error('linhas nao foram preenchidas pela legenda: ' + JSON.stringify(nameValues))
    }
    if (valueValues.some((v) => v !== '')) {
      throw new Error('valores devem iniciar vazios na edicao: ' + JSON.stringify(valueValues))
    }
    const userLegendValue = await editDialog
      .getByLabel('Legenda do campo Usuário no portal')
      .inputValue()
    const passLegendValue = await editDialog
      .getByLabel('Legenda do campo Senha no portal')
      .inputValue()
    console.log('edicao — legendas base:', userLegendValue, '/', passLegendValue)
    if (userLegendValue !== 'CPF' || passLegendValue !== 'Senha') {
      throw new Error('legendas base nao persistidas: ' + userLegendValue + ' / ' + passLegendValue)
    }

    // Aviso de legenda duplicada aparece (e some ao corrigir).
    await editDialog
      .getByLabel(/Legenda do campo no portal/)
      .nth(1)
      .fill('cpf')
    const dupWarning = editDialog.getByRole('alert').filter({ hasText: 'Legenda repetida' })
    await dupWarning.waitFor()
    console.log('aviso de duplicada visivel:', await dupWarning.isVisible())
    await editDialog
      .getByLabel(/Legenda do campo no portal/)
      .nth(1)
      .fill('PIN')
    await dupWarning.waitFor({ state: 'detached' })
    await page.screenshot({ path: path.join(OUT, 'credential-extra-fields-edit.png') })

    // Salva a edição sem digitar valores: as legendas devem persistir.
    await editDialog.getByRole('button', { name: 'Salvar alteracoes' }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const listedAfter = await page.evaluate(async () =>
      (globalThis as unknown as { aurumBitPortal: Bridge }).aurumBitPortal.credentials.list({}),
    )
    const savedAfter = listedAfter.find((c) => c.label === 'Acesso Verify')
    const namesAfter = (savedAfter?.fields ?? []).map((f) => `${f.kind}:${f.name}`)
    console.log('fields apos edicao vazia:', JSON.stringify(namesAfter))
    if (
      JSON.stringify(namesAfter) !==
      JSON.stringify(['username:CPF', 'password:Senha', 'text:Código da empresa', 'text:PIN'])
    ) {
      throw new Error('fields perdidos apos edicao vazia: ' + JSON.stringify(namesAfter))
    }
    // Olhinho: revela TODOS os campos salvos.
    await page.getByRole('button', { name: 'Revelar senha' }).first().click()
    const revealDialog = page.getByRole('dialog')
    await revealDialog.waitFor()
    await revealDialog.getByText('••••••••••••').first().waitFor()
    await revealDialog.getByRole('button', { name: 'Revelar tudo' }).click()
    for (const expected of ['SenhaForte!2026', 'EMP-123', '9999', '52998224725']) {
      await revealDialog.getByText(expected).first().waitFor()
    }
    console.log('olhinho mostra todos os campos revelados')
    // Copiar um campo pelo olhinho: quem resolve o valor é o main process.
    await revealDialog.getByRole('button', { name: 'Copiar Código da empresa' }).click()
    await page
      .getByText(/copiado/)
      .first()
      .waitFor()
    await page.screenshot({ path: path.join(OUT, 'credential-reveal-all.png') })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    console.log('OK: criar, editar e revelar (todos os campos) pela UI')
  } finally {
    await app.close()
    removeUserDataDir(userData)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
