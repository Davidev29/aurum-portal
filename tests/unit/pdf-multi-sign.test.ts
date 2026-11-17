import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest'
import forge from 'node-forge'
import { PDFDocument } from 'pdf-lib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { signPdfDocument } from '../../electron/main/pdf/sign'
import { verifySignedPdf } from '../../electron/main/pdf/verify'
import { makeValidTsaMock } from '../helpers/tsa-mock'

const PFX_PATH = path.resolve(process.cwd(), 'scripts/spike/.certs/spike-a1-test.pfx')
const PFX_PASSWORD = 'SpikeSenha123!'

let pfxBuffer: Buffer
let material: any
let privateKey: any
let cert: any

beforeAll(() => {
  pfxBuffer = readFileSync(PFX_PATH)
  const p12 = forge.pkcs12.pkcs12FromAsn1(
    forge.asn1.fromDer(pfxBuffer.toString('binary')),
    false,
    PFX_PASSWORD,
  )
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
function countByteRanges(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/ByteRange/g) ?? []).length
}

describe('assinatura multipla (incremental)', () => {
  it('segunda assinatura preserva a primeira (append-only)', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const original = Buffer.from(await doc.save())

    const first = await signPdfDocument({
      fileName: 'a.pdf',
      pdfBytes: original,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.1,
      yPct: 0.1,
      size: 'medium',
      reason: 'primeira',
      tsaUrl: 'https://tsa.example',
    })
    expect(first.pdf.length).toBeGreaterThan(0)
    expect(countByteRanges(first.pdf)).toBe(1)
    expect(await verifySignedPdf(first.pdf)).toBe(true)

    const second = await signPdfDocument({
      fileName: 'a-assinado.pdf',
      pdfBytes: Buffer.from(first.pdf),
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.2,
      yPct: 0.2,
      size: 'medium',
      reason: 'segunda',
      tsaUrl: 'https://tsa.example',
    })
    expect(second.pdf.length).toBeGreaterThan(first.pdf.length)
    expect(countByteRanges(second.pdf)).toBe(2)
    // verifySignedPdf agora verifica TODAS as assinaturas.
    expect(await verifySignedPdf(second.pdf)).toBe(true)
  }, 60000)

  it('aceita Uint8Array (como chega apos worker_threads) sem erro pdf vazio', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const doc = await PDFDocument.create()
    doc.addPage([300, 400])
    const original = Buffer.from(await doc.save())
    // Simula o transporte via worker: Buffer vira Uint8Array.
    const viaWorker = new Uint8Array(original)
    expect(Buffer.isBuffer(viaWorker as unknown as Buffer)).toBe(false)
    const signed = await signPdfDocument({
      fileName: 'a.pdf',
      pdfBytes: viaWorker as unknown as Buffer,
      certificate: { ...material, pfx: new Uint8Array(material.pfx) as unknown as Buffer },
      page: 1,
      xPct: 0.1,
      yPct: 0.1,
      size: 'medium',
      reason: 'worker',
      tsaUrl: 'https://tsa.example',
    })
    expect(signed.pdf.length).toBeGreaterThan(0)
    expect(await verifySignedPdf(signed.pdf)).toBe(true)
  }, 60000)

  it('aceita tamanho desenhado pelo usuario (widthPct/heightPct)', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const original = Buffer.from(await doc.save())
    const signed = await signPdfDocument({
      fileName: 'a.pdf',
      pdfBytes: original,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.2,
      yPct: 0.2,
      size: 'medium',
      widthPct: 0.35,
      heightPct: 0.09,
      location: '-23.5505, -46.6333',
      tsaUrl: 'https://tsa.example',
    })
    expect(signed.pdf.length).toBeGreaterThan(0)
    expect(await verifySignedPdf(signed.pdf)).toBe(true)
  }, 60000)

  it('rejeita PDF vazio com mensagem clara (sem mascarar a causa)', async () => {
    await expect(
      signPdfDocument({
        fileName: 'vazio.pdf',
        pdfBytes: Buffer.alloc(0),
        certificate: { ...material },
        page: 1,
        xPct: 0.1,
        yPct: 0.1,
        size: 'small',
        reason: 'r',
        tsaUrl: 'https://tsa.example',
      }),
    ).rejects.toThrow(/vazio/)
  })
})
