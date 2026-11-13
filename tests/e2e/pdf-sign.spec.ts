import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launchAurumBitPortal, createUserDataDir, removeUserDataDir } from './helpers/app'

test('pagina de assinaturas renderiza e lista certificado elegivel', async () => {
  const userData = createUserDataDir()
  const { app, page } = await launchAurumBitPortal({ userData })
  try {
    const pfxPath = path.resolve(process.cwd(), 'scripts/spike/.certs/spike-a1-test.pfx')
    const imported = await page.evaluate(
      async (args) => {
        return (globalThis as any).aurumBitPortal.certificates.import({
          filePath: args.pfxPath,
          password: args.password,
          install: false,
          consent: true,
        })
      },
      { pfxPath, password: 'SpikeSenha123!' },
    )
    const certId = imported?.items?.[0]?.certificateId
    expect(certId).toBeTruthy()

    // Navega para a secao Assinatura digital pelo menu.
    await page.getByRole('link', { name: 'Assinatura digital' }).first().click()
    await expect(page.getByRole('heading', { name: 'Assinaturas digitais' })).toBeVisible()
    await expect(
      page.getByText('Assine PDFs com certificado ICP-Brasil A1 (PAdES-B-T)'),
    ).toBeVisible()

    // Fluxo reordenado: primeiro o documento; o certificado e escolhido na etapa seguinte.
    await expect(page.getByText('Escolha um arquivo PDF (até 50 MB)')).toBeVisible()
  } finally {
    await app.close()
    removeUserDataDir(userData)
  }
})
