/**
 * Suíte de STRESS — cofre AES-256-GCM, PFX, backup Argon2id, lote PAdES e
 * geometria do carimbo. Nenhum dado real é usado; o PFX spike A1 é gerado
 * pelo global-fixture (tests/setup/global-fixture.ts) no início da suíte.
 *
 * Métricas são logadas via logMetric como '[stress] {json}' para o orquestrador.
 * Budgets de tempo são generosas regressões — o alvo real é bem menor.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { performance } from 'node:perf_hooks'
import { randomBytes } from 'node:crypto'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { deriveKey, passwordFingerprint } from '../../electron/main/vault/crypto'
import { VaultService } from '../../electron/main/vault/service'
import { encryptBackup, decryptBackup } from '../../electron/main/vault/backup'
import { signPdfDocument } from '../../electron/main/pdf/sign'
import { resolveStampRect } from '../../electron/main/pdf/stamp'
import type { SignatureStampSize } from '../../shared/signature'
import { logMetric, mulberry32 } from './helpers'

let material: any
beforeAll(async () => {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const forge = (await import('node-forge')).default
  const buf = readFileSync(
    path.resolve(process.cwd(), 'scripts', 'spike', '.certs', 'spike-a1-test.pfx'),
  )
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(buf.toString('binary')),
    false,
    'SpikeSenha123!',
  )
  const keyBags = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag as string })[
    forge.pki.oids.pkcs8ShroudedKeyBag as string
  ] ?? []) as any[]
  const certBags = (p12.getBags({ bagType: forge.pki.oids.certBag as string })[
    forge.pki.oids.certBag as string
  ] ?? []) as any[]
  const pk = keyBags[0].key
  const cert =
    certBags.find((b: any) => b.cert.publicKey.n.compareTo(pk.n) === 0)?.cert ?? certBags[0].cert
  material = {
    pfx: buf,
    password: 'SpikeSenha123!',
    holderName: 'SPIKE TESTE:12345678909',
    document: '12345678909',
    documentType: 'CPF',
    issuerDn: cert.issuer.attributes
      .map((a: any) => `${a.shortName ?? a.name}=${a.value}`)
      .join(', '),
    thumbprintSha256: '052295E95BB4DB1BAFDC0A1FB2CB61A54FFD737FB159E4F02F25973C93FBDB01',
    validTo: '2027-11-04T11:18:17.628Z',
  }
})

describe('stress: cofre AES-256-GCM', () => {
  const masterKey = Buffer.alloc(32, 7)
  const vault = new VaultService(Buffer.alloc(32, 3))

  it('1000 round-trips de seal/open com ids distintos', () => {
    const start = performance.now()
    for (let i = 0; i < 1000; i += 1) {
      const id = `stress-cred-${i}`
      const password = `Stress#senha-${i}-!@`
      const sealed = vault.sealCredentialPassword(id, password)
      expect(vault.openCredentialPassword(id, sealed)).toBe(password)
    }
    const totalMs = performance.now() - start
    logMetric('vault.seal_open_1000', {
      msPerOp: Number((totalMs / 1000).toFixed(3)),
      totalMs: Math.round(totalMs),
    })
    expect(totalMs).toBeLessThan(10000)
  }, 15000)

  it('5000 fingerprints deterministas', () => {
    const start = performance.now()
    const reference = passwordFingerprint('senha-stress-fingerprint', masterKey)
    for (let i = 0; i < 5000; i += 1) {
      expect(passwordFingerprint('senha-stress-fingerprint', masterKey)).toBe(reference)
    }
    const totalMs = performance.now() - start
    logMetric('vault.password_fingerprint_5000', {
      msPerOp: Number((totalMs / 5000).toFixed(4)),
      totalMs: Math.round(totalMs),
    })
    expect(totalMs).toBeLessThan(5000)
  }, 10000)

  it('200 derivações de chave com propósitos distintos são todas diferentes', () => {
    const start = performance.now()
    const derived = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      derived.add(deriveKey(masterKey, `stress-purpose-${i}`).toString('hex'))
    }
    expect(derived.size).toBe(200)
    const totalMs = performance.now() - start
    logMetric('vault.derive_key_200', { totalMs: Math.round(totalMs) })
    expect(totalMs).toBeLessThan(5000)
  }, 10000)
})

describe('stress: PFX no cofre', () => {
  const vault = new VaultService(Buffer.alloc(32, 5))

  it('500 round-trips de PFX de 2048 bytes (seal/open/senha)', () => {
    const start = performance.now()
    for (let i = 0; i < 500; i += 1) {
      const certId = `stress-cert-${i}`
      const pfx = randomBytes(2048)
      const password = `pfx-stress-pass-${i}!`
      const sealed = vault.sealPfx(certId, pfx, password)
      expect(vault.openPfx(certId, sealed.pfxEnc).equals(pfx)).toBe(true)
      expect(vault.openPfxPassword(certId, sealed.passwordEnc)).toBe(password)
      // Amostra a cada 50ª iteração: certId errado deve falhar (AAD por certificado).
      if (i % 50 === 0) {
        expect(() => vault.openPfx(`${certId}-errado`, sealed.pfxEnc)).toThrow()
      }
    }
    const totalMs = performance.now() - start
    logMetric('vault.pfx_seal_open_500', {
      msPerOp: Number((totalMs / 500).toFixed(3)),
      totalMs: Math.round(totalMs),
    })
    expect(totalMs).toBeLessThan(10000)
  }, 15000)

  it('openPfx com certId errado lança em 100 amostras', () => {
    const sealed = vault.sealPfx('stress-cert-base', randomBytes(2048), 'pfx-senha-base!')
    for (let i = 0; i < 100; i += 1) {
      expect(() => vault.openPfx(`stress-cert-errado-${i}`, sealed.pfxEnc)).toThrow()
    }
    logMetric('vault.pfx_wrong_cert_id_100', { samples: 100 })
  }, 10000)
})

describe('stress: backup .pvbackup (Argon2id)', () => {
  const passphrase = 'frase-senha-stress-segura-123'

  it('8 round-trips encrypt/decrypt com payload de 1KB', async () => {
    const totalStart = performance.now()
    for (let i = 0; i < 8; i += 1) {
      const payload = randomBytes(1024)
      const start = performance.now()
      const serialized = await encryptBackup(payload, passphrase)
      const opened = await decryptBackup(serialized, passphrase)
      const ms = Math.round(performance.now() - start)
      expect(opened.equals(payload)).toBe(true)
      logMetric('vault.backup_iter', { index: i, ms })
    }
    const totalMs = Math.round(performance.now() - totalStart)
    logMetric('vault.backup_argon2id_8', { totalMs })
    expect(totalMs).toBeLessThan(60000)
  }, 70000)
})

async function makePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let p = 0; p < pageCount; p += 1) {
    const page = doc.addPage([612, 792])
    page.drawText(`Stress QA pagina ${p + 1}`, { x: 50, y: 720, size: 12, font })
  }
  return Buffer.from(await doc.save())
}

describe('stress: assinatura PAdES em lote', () => {
  const PAGE_COUNTS = [1, 1, 1, 5, 5, 5, 10, 10, 10, 20, 20, 20]

  it('assina 12 PDFs sequencialmente (lote)', async () => {
    const perDocMs: number[] = []
    const totalStart = performance.now()
    for (let i = 0; i < PAGE_COUNTS.length; i += 1) {
      const pdfBytes = await makePdf(PAGE_COUNTS[i]!)
      const start = performance.now()
      const result = await signPdfDocument({
        fileName: `stress-${i}.pdf`,
        pdfBytes,
        certificate: material,
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'Stress QA',
        tsaUrl: 'not-a-url',
      })
      perDocMs.push(Math.round(performance.now() - start))
      expect(result.pdf).toBeTruthy()
      expect(result.pdf.subarray(0, 5).toString('latin1').startsWith('%PDF')).toBe(true)
      expect(result.pdf.length).toBeGreaterThan(0)
      expect(result.tsaHost).toBe('offline')
    }
    const totalMs = Math.round(performance.now() - totalStart)
    logMetric('pdf.sign_batch', { totalMs, perDocMs, maxDocMs: Math.max(...perDocMs) })
    expect(totalMs).toBeLessThan(90000)
  }, 120000)

  it('assina um PDF de 20 páginas duas vezes (caminho incremental)', async () => {
    const pdfBytes = await makePdf(20)
    const first = await signPdfDocument({
      fileName: 'stress-incremental-1.pdf',
      pdfBytes,
      certificate: material,
      page: 1,
      xPct: 0.1,
      yPct: 0.1,
      size: 'small',
      reason: 'Stress QA',
      tsaUrl: 'not-a-url',
    })
    expect(first.pdf.length).toBeGreaterThan(0)
    expect(first.pdf.subarray(0, 5).toString('latin1').startsWith('%PDF')).toBe(true)
    expect(first.tsaHost).toBe('offline')

    const start = performance.now()
    const second = await signPdfDocument({
      fileName: 'stress-incremental-2.pdf',
      pdfBytes: first.pdf,
      certificate: material,
      page: 1,
      xPct: 0.1,
      yPct: 0.1,
      size: 'small',
      reason: 'Stress QA',
      tsaUrl: 'not-a-url',
    })
    const ms = Math.round(performance.now() - start)
    expect(second.pdf.length).toBeGreaterThan(0)
    expect(second.pdf.subarray(0, 5).toString('latin1').startsWith('%PDF')).toBe(true)
    expect(second.tsaHost).toBe('offline')
    logMetric('pdf.sign_incremental', { ms })
  }, 60000)
})

describe('stress: geometria do carimbo', () => {
  const PAGE_SIZES: Array<[number, number]> = [
    [300, 400],
    [612, 792],
    [595, 842],
    [842, 595],
  ]
  const STAMP_SIZES: SignatureStampSize[] = ['small', 'medium', 'large']
  const fakePage = (width: number, height: number) =>
    ({ getSize: () => ({ width, height }) }) as any

  it('10000 resolveStampRect dentro dos limites da página', () => {
    const rand = mulberry32(0x5eed5)
    const start = performance.now()
    for (let i = 0; i < 10_000; i += 1) {
      const [width, height] = PAGE_SIZES[i % PAGE_SIZES.length]!
      const size = STAMP_SIZES[i % STAMP_SIZES.length]!
      const xPct = rand()
      const yPct = rand()
      const rect = resolveStampRect(fakePage(width, height), xPct, yPct, size)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.001)
      expect(rect.y + rect.height).toBeLessThanOrEqual(height + 0.001)
    }
    const totalMs = performance.now() - start
    logMetric('stamp.resolve_rect_10000', {
      msPerOp: Number((totalMs / 10_000).toFixed(4)),
      totalMs: Math.round(totalMs),
    })
    expect(totalMs).toBeLessThan(5000)
  }, 10000)
})
