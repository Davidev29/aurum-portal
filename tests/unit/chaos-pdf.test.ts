import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { signPdfDocument } from '../../electron/main/pdf/sign'
import { resolveStampRect } from '../../electron/main/pdf/stamp'

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

afterEach(() => vi.unstubAllGlobals())

describe('chaos: assinatura de PDF', () => {
  it('rejeita PDF maior que 50 MB (header falso)', async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 100, 0)
    // pdf-lib falha ao parsear; signPdfDocument deve rejeitar (tamanho ou parse)
    await expect(
      signPdfDocument({
        fileName: 'big.pdf',
        pdfBytes: big,
        certificate: material,
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow()
  })

  it('rejeita coords fora de 0..1', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: material,
        page: 1,
        xPct: 1.5,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/Posicao do carimbo invalida/)
  })

  it('rejeita pagina 0 e pagina inexistente', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: material,
        page: 0,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/fora do documento/)
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: material,
        page: 99,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/fora do documento/)
  })

  it('rejeita PDF vazio', async () => {
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes: Buffer.alloc(0),
        certificate: material,
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/vazio/)
  })

  it('URL de TSA invalida cancela a assinatura (fail-closed)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: material,
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'not-a-url',
      }),
    ).rejects.toThrow(/TSA/)
  }, 20_000)

  it('clamp de coordenadas no carimbo', () => {
    const fakePage = { getSize: () => ({ width: 300, height: 400 }) } as any
    const rect = resolveStampRect(fakePage, 0.99, 0.99, 'large')
    expect(rect.x + rect.width).toBeLessThanOrEqual(300)
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(0)
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })

  it('TSA indisponivel cancela a assinatura (fail-closed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down')
      }),
    )
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: material,
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/Carimbo de tempo indisponível/)
  })
})
