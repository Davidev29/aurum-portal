import { test, expect } from '@playwright/test'
import path from 'node:path'
import { launchAurumBitPortal, createUserDataDir, removeUserDataDir } from './helpers/app'

test('diagnostico de injecao de certificado', async () => {
  const userData = createUserDataDir()
  const { app, page } = await launchAurumBitPortal({ userData })
  try {
    const pfxPath = path.resolve(process.cwd(), 'scripts/spike/.certs/spike-a1-test.pfx')
    const imported = await page.evaluate(async (args) => {
      return (globalThis as any).aurumBitPortal.certificates.import({
        filePath: args.pfxPath,
        password: args.password,
        install: true,
        consent: true,
      })
    }, { pfxPath, password: 'SpikeSenha123!' })
    console.log('IMPORTED:', JSON.stringify(imported))
    const certId = imported?.items?.[0]?.certificateId
    expect(certId).toBeTruthy()
    const result = await page.evaluate(async (id) => {
      return (globalThis as any).aurumBitPortal.certificates.test(id)
    }, certId)
    console.log('TEST RESULT:', JSON.stringify(result))
    expect(result.ok).toBe(true)
  } finally {
    await app.close()
    removeUserDataDir(userData)
  }
})
