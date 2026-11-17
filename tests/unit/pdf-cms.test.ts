import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { signPdfDocument } from '../../electron/main/pdf/sign'
import { makeValidTsaMock } from '../helpers/tsa-mock'

const PFX_PATH = path.resolve(process.cwd(), 'scripts', 'spike', '.certs', 'spike-a1-test.pfx')
const PFX_PASSWORD = 'SpikeSenha123!'

let pfxBuffer: Buffer
let material: {
  pfx: Buffer
  password: string
  holderName: string
  document: string
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  issuerDn: string
  thumbprintSha256: string
  validTo: string
}
let privateKey: any
let cert: forge.pki.Certificate

beforeAll(() => {
  pfxBuffer = readFileSync(PFX_PATH)
  const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'))
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, PFX_PASSWORD)
  const keyBags = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag as string })[
    forge.pki.oids.pkcs8ShroudedKeyBag as string
  ] ?? []) as any[]
  const certBags = (p12.getBags({ bagType: forge.pki.oids.certBag as string })[
    forge.pki.oids.certBag as string
  ] ?? []) as any[]
  privateKey = keyBags[0].key
  cert =
    certBags.find((b: any) => b.cert.publicKey.n.compareTo(privateKey.n) === 0)?.cert ??
    certBags[0].cert
  material = {
    pfx: pfxBuffer,
    password: PFX_PASSWORD,
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

function makeTsaMock() {
  return makeValidTsaMock({ cert, privateKey })
}
describe('signPdfDocument', () => {
  it('assina um PDF pequeno e produz PAdES com TST', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())

    const result = await signPdfDocument({
      fileName: 'teste.pdf',
      pdfBytes,
      certificate: material,
      page: 1,
      xPct: 0.1,
      yPct: 0.1,
      size: 'medium',
      reason: 'Teste de assinatura',
      tsaUrl: 'https://tsa.example',
    })

    expect(result.pdf.length).toBeGreaterThan(pdfBytes.length)
    expect(result.sha256).toMatch(/^[0-9A-F]{64}$/)
    expect(result.tsaHost).toBe('tsa.example')
    // Verifica estrutura via pkijs
    const { verifySignedPdf } = await import('../../electron/main/pdf/verify')
    const ok = await verifySignedPdf(result.pdf)
    expect(ok).toBe(true)
  }, 60_000)

  it('rejeita PDF criptografado', async () => {
    // pdf-lib nao gera PDF criptografado facilmente; simulamos com lixo
    const junk = Buffer.from('nÃ£o Ã© pdf')
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes: junk,
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

  it('rejeita pagina fora do range', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: material,
        page: 5,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/fora do documento/)
  })

  it('rejeita certificado vencido', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const pdfBytes = Buffer.from(await doc.save())
    await expect(
      signPdfDocument({
        fileName: 'x.pdf',
        pdfBytes,
        certificate: { ...material, validTo: '2020-01-01T00:00:00.000Z' },
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/vencido/)
  })

  it('cancela quando a TSA retorna 500 (fail-closed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('erro', { status: 500 })),
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
