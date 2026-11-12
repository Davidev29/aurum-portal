/**
 * Geometría del carimbo: cropBox∩mediaBox + /Rotate de punta a punta.
 * Garante que a posição desenhada na prévia (frações da tela exibida)
 * vira o MESMO retângulo no PDF final (user space) — em qualquer rotação.
 */
import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest'
import forge from 'node-forge'
import { PDFDocument, PDFDict, PDFName, degrees } from 'pdf-lib'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  displayRectToUserRect,
  getPageView,
  normalizeRotation,
} from '../../electron/main/pdf/page-geometry'
import { inspectPdf } from '../../electron/main/pdf/pick'
import { resolveCustomStampRect } from '../../electron/main/pdf/stamp'
import { signPdfDocument } from '../../electron/main/pdf/sign'
import { pdfSignSchema } from '../../shared/contracts'

const PFX_PATH = path.resolve(process.cwd(), 'scripts/spike/.certs/spike-a1-test.pfx')
const PFX_PASSWORD = 'SpikeSenha123!'

async function makePdf(spec: {
  rotate?: number
  mediaBox?: [number, number, number, number]
  cropBox?: [number, number, number, number]
  pageWidth?: number
  pageHeight?: number
}) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([spec.pageWidth ?? 400, spec.pageHeight ?? 600])
  if (spec.mediaBox) page.setMediaBox(...spec.mediaBox)
  if (spec.cropBox) page.setCropBox(...spec.cropBox)
  if (spec.rotate) page.setRotation(degrees(spec.rotate))
  return { doc, page, bytes: Buffer.from(await doc.save()) }
}

describe('normalizeRotation', () => {
  it('normaliza angulos como o pdf.js', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(180)).toBe(180)
    expect(normalizeRotation(270)).toBe(270)
    expect(normalizeRotation(-90)).toBe(270)
    expect(normalizeRotation(450)).toBe(90)
    expect(normalizeRotation(45)).toBe(0)
    expect(normalizeRotation(360)).toBe(0)
  })
})

describe('getPageView', () => {
  it('página simples: view = mediaBox, display = mesma', async () => {
    const { page } = await makePdf({})
    const view = getPageView(page)
    expect(view.rotation).toBe(0)
    expect(view.width).toBe(400)
    expect(view.height).toBe(600)
    expect(view.displayWidth).toBe(400)
    expect(view.displayHeight).toBe(600)
  })

  it('página rotacionada 90: display troca eixos', async () => {
    const { page } = await makePdf({ rotate: 90 })
    const view = getPageView(page)
    expect(view.rotation).toBe(90)
    expect(view.width).toBe(400)
    expect(view.height).toBe(600)
    expect(view.displayWidth).toBe(600)
    expect(view.displayHeight).toBe(400)
  })

  it('cropBox menor desloca e reduz a view (origem ≠ 0)', async () => {
    const { page } = await makePdf({ mediaBox: [50, 60, 400, 600], cropBox: [100, 110, 300, 400] })
    const view = getPageView(page)
    expect([view.x0, view.y0, view.x1, view.y1]).toEqual([100, 110, 400, 510])
    expect(view.width).toBe(300)
    expect(view.height).toBe(400)
  })

  it('mediaBox com origem não-zero: view começa na origem da caixa', async () => {
    const { page } = await makePdf({ mediaBox: [50, 60, 400, 600] })
    const view = getPageView(page)
    expect([view.x0, view.y0]).toEqual([50, 60])
    expect(view.displayWidth).toBe(400)
    expect(view.displayHeight).toBe(600)
  })
})

describe('displayRectToUserRect (frações da tela → user space)', () => {
  // Área visível com origem não-zero: [100,110] → [400,510] (300x400pt)
  const viewRaw = (rotation: 0 | 90 | 180 | 270) => ({
    x0: 100,
    y0: 110,
    x1: 400,
    y1: 510,
    width: 300,
    height: 400,
    rotation,
    displayWidth: rotation === 90 || rotation === 270 ? 400 : 300,
    displayHeight: rotation === 90 || rotation === 270 ? 300 : 400,
  })
  const dx = 50
  const dyTop = 40
  const dw = 100
  const dh = 60

  it('/Rotate 0: y sobe invertido', () => {
    const r = displayRectToUserRect(viewRaw(0), dx, dyTop, dw, dh)
    expect(r).toEqual({ x: 150, y: 510 - 40 - 60, width: 100, height: 60 })
  })

  it('/Rotate 90: eixos trocados, y sobe direto', () => {
    const r = displayRectToUserRect(viewRaw(90), dx, dyTop, dw, dh)
    expect(r).toEqual({ x: 100 + 40, y: 110 + 50, width: 60, height: 100 })
  })

  it('/Rotate 180: ambos invertidos a partir do canto oposto', () => {
    const r = displayRectToUserRect(viewRaw(180), dx, dyTop, dw, dh)
    expect(r).toEqual({ x: 400 - 50 - 100, y: 110 + 40, width: 100, height: 60 })
  })

  it('/Rotate 270: eixos trocados, ambos invertidos', () => {
    const r = displayRectToUserRect(viewRaw(270), dx, dyTop, dw, dh)
    expect(r).toEqual({ x: 400 - 40 - 60, y: 510 - 50 - 100, width: 60, height: 100 })
  })

  it('página inteira vira exatamente a view em todas as rotações', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const view = viewRaw(rotation)
      const r = displayRectToUserRect(view, 0, 0, view.displayWidth, view.displayHeight)
      expect(r.x).toBeCloseTo(view.x0, 6)
      expect(r.y).toBeCloseTo(view.y0, 6)
      expect(r.width).toBeCloseTo(view.width, 6)
      expect(r.height).toBeCloseTo(view.height, 6)
    }
  })

  it('arredondamento inverso (user → tela) recupera o ponto em todas as rotações', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const view = viewRaw(rotation)
      const r = displayRectToUserRect(view, dx, dyTop, dw, dh)
      // Inverso por cantos: a bbox do user rect mapeada de volta à tela = [dx, dyTop, dx+dw, dyTop+dh]
      let sx: number, sy: number, sw: number, sh: number
      if (rotation === 0) {
        sx = r.x - view.x0
        sy = view.y1 - (r.y + r.height)
        sw = r.width
        sh = r.height
      } else if (rotation === 90) {
        sx = r.y - view.y0
        sy = r.x - view.x0
        sw = r.height
        sh = r.width
      } else if (rotation === 180) {
        sx = view.x1 - (r.x + r.width)
        sy = r.y - view.y0
        sw = r.width
        sh = r.height
      } else {
        sx = view.y1 - (r.y + r.height)
        sy = view.x1 - (r.x + r.width)
        sw = r.height
        sh = r.width
      }
      expect(sx).toBeCloseTo(dx, 6)
      expect(sy).toBeCloseTo(dyTop, 6)
      expect(sw).toBeCloseTo(dw, 6)
      expect(sh).toBeCloseTo(dh, 6)
    }
  })
})

describe('resolveCustomStampRect', () => {
  it('sem margem forçada: carimbo na borda fica na borda (x=0)', async () => {
    const { page } = await makePdf({ pageWidth: 595, pageHeight: 842 })
    const rect = resolveCustomStampRect(page, 0, 0, 0.5, 0.2)
    expect(rect.x).toBe(0)
    expect(rect.width).toBeCloseTo(297.5, 6)
    expect(rect.height).toBeCloseTo(168.4, 6)
    expect(rect.y).toBeCloseTo(842 - 168.4, 6)
  })

  it('bloco desenhado pequeno e adotado exatamente (Adobe Reader); piso anti-degenerado', async () => {
    const { page } = await makePdf({ pageWidth: 595, pageHeight: 842 })
    // Fração pequena: adotada, limitada só pelo piso absoluto (40x16 pt).
    const small = resolveCustomStampRect(page, 0.5, 0.5, 0.05, 0.03)
    expect(small.width).toBeGreaterThanOrEqual(40)
    expect(small.height).toBeGreaterThanOrEqual(16)
    expect(small.width).toBeLessThan(140) // sem inflar para o mínimo premium antigo
    // Fração real: adotada exatamente, sem ajuste.
    const exact = resolveCustomStampRect(page, 0.1, 0.1, 0.2, 0.09)
    expect(exact.width).toBeCloseTo(0.2 * 595, 3)
    expect(exact.height).toBeCloseTo(0.09 * 842, 3)
  })

  it('página rotacionada: frações medidas na tela viram user space correto', async () => {
    const { page } = await makePdf({ rotate: 90 }) // addPage([400,600]) + Rotate 90
    const rect = resolveCustomStampRect(page, 0.1, 0.2, 0.3, 0.3)
    // Tela: 600x400; dx=60, dyTop=80, dw=180, dh=120 (acima do piso de 16 pt)
    // user space: x = 0+80, y = 0+60, w=dh=120, h=dw=180
    expect(rect).toEqual({ x: 80, y: 60, width: 120, height: 180 })
  })

  it('mediaBox com origem: carimbo nasce dentro da área visível', async () => {
    const { page } = await makePdf({ mediaBox: [50, 60, 400, 600] })
    const rect = resolveCustomStampRect(page, 0, 0, 0.5, 0.2)
    expect(rect.x).toBe(50)
    expect(rect.y).toBeCloseTo(660 - 120, 6) // y1 = 60+600; 20% do topo => h=120
    expect(rect.width).toBeCloseTo(200, 6)
  })
})

describe('inspectPdf (contrato da prévia)', () => {
  it('expõe geometria exibida: crop∩media + /Rotate', async () => {
    const { bytes } = await makePdf({ rotate: 90 })
    const result = await inspectPdf(bytes)
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]).toMatchObject({
      width: 600,
      height: 400,
      rotation: 90,
      viewBox: { x: 0, y: 0, width: 400, height: 600 },
    })
  })

  it('cropBox menor vira a view da prévia', async () => {
    const { bytes } = await makePdf({ mediaBox: [50, 60, 400, 600], cropBox: [100, 110, 300, 400] })
    const result = await inspectPdf(bytes)
    expect(result.pages[0]!.width).toBe(300)
    expect(result.pages[0]!.height).toBe(400)
    expect(result.pages[0]!.viewBox).toEqual({ x: 100, y: 110, width: 300, height: 400 })
  })
})

describe('pdfSignSchema', () => {
  const base = {
    token: 't',
    certificateId: 'c',
    page: 1,
    size: 'medium' as const,
    xPct: 0.1,
    yPct: 0.1,
  }

  it('aceita o payload válido do frontend', () => {
    const r = pdfSignSchema.safeParse({ ...base, widthPct: 0.4, heightPct: 0.1 })
    expect(r.success).toBe(true)
  })

  it('aceita frações pequenas (bloco desenhado pequeno, Adobe-like)', () => {
    const r = pdfSignSchema.safeParse({ ...base, widthPct: 0.02, heightPct: 0.015 })
    expect(r.success).toBe(true)
  })

  it('rejeita frações degeneradas (zero/negativas)', () => {
    expect(pdfSignSchema.safeParse({ ...base, widthPct: 0 }).success).toBe(false)
    expect(pdfSignSchema.safeParse({ ...base, heightPct: -0.1 }).success).toBe(false)
  })

  it('rejeita carimbo que ultrapassa a largura', () => {
    const r = pdfSignSchema.safeParse({ ...base, xPct: 0.8, widthPct: 0.5 })
    expect(r.success).toBe(false)
  })

  it('rejeita carimbo que ultrapassa a altura', () => {
    const r = pdfSignSchema.safeParse({ ...base, yPct: 0.95, heightPct: 0.1 })
    expect(r.success).toBe(false)
  })

  it('aceita carimbo exatamente na borda (x+w = 1)', () => {
    const r = pdfSignSchema.safeParse({ ...base, xPct: 0.75, widthPct: 0.25 })
    expect(r.success).toBe(true)
  })
})

describe('assinatura end-to-end: posição do widget == prévia', () => {
  let pfxBuffer: Buffer
  let material: any

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
    const privateKey = keyBags[0].key
    const cert =
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
    return vi.fn(async () => {
      return new Response(Buffer.from('invalid'), { status: 500 })
    })
  }

  async function sigWidgetRects(
    pdfBytes: Buffer,
  ): Promise<Array<[number, number, number, number]>> {
    const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false })
    const rects: Array<[number, number, number, number]> = []
    for (const page of doc.getPages()) {
      const annots = page.node.Annots()
      if (!annots) continue
      for (const ref of annots.asArray()) {
        const w = doc.context.lookup(ref as any) as PDFDict | undefined
        if (!(w instanceof PDFDict)) continue
        const ft = w.get(PDFName.of('FT'))
        if (ft?.toString?.() !== '/Sig') continue
        const rect = w.get(PDFName.of('Rect'))
        if (!rect) continue
        const nums = (rect as any).asArray().map((n: any) => n.asNumber())
        rects.push([nums[0], nums[1], nums[2], nums[3]])
      }
    }
    return rects
  }

  it('página /Rotate 90: o Rect do widget fica onde o usuário desenhou', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const { bytes } = await makePdf({ pageWidth: 612, pageHeight: 792, rotate: 90 })
    const expectedDoc = await PDFDocument.load(bytes)
    const expected = resolveCustomStampRect(expectedDoc.getPages()[0]!, 0.1, 0.2, 0.3, 0.1)

    const signed = await signPdfDocument({
      fileName: 'rot90.pdf',
      pdfBytes: bytes,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.1,
      yPct: 0.2,
      size: 'medium',
      widthPct: 0.3,
      heightPct: 0.1,
      tsaUrl: 'not-a-url', // offline → sem rede
    })
    const rects = await sigWidgetRects(signed.pdf)
    expect(rects).toHaveLength(1)
    const [x0, y0, x1, y1] = rects[0]!
    expect(x0).toBeCloseTo(expected.x, 4)
    expect(y0).toBeCloseTo(expected.y, 4)
    expect(x1).toBeCloseTo(expected.x + expected.width, 4)
    expect(y1).toBeCloseTo(expected.y + expected.height, 4)
  }, 60000)

  it('página /Rotate 180 com MediaBox deslocada: posição exata', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const { bytes } = await makePdf({ mediaBox: [50, 60, 500, 700], rotate: 180 })
    const expectedDoc = await PDFDocument.load(bytes)
    const expected = resolveCustomStampRect(expectedDoc.getPages()[0]!, 0.25, 0.3, 0.4, 0.12)

    const signed = await signPdfDocument({
      fileName: 'rot180.pdf',
      pdfBytes: bytes,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.25,
      yPct: 0.3,
      size: 'medium',
      widthPct: 0.4,
      heightPct: 0.12,
      tsaUrl: 'not-a-url',
    })
    const rects = await sigWidgetRects(signed.pdf)
    expect(rects).toHaveLength(1)
    const [x0, y0, x1, y1] = rects[0]!
    expect(x0).toBeCloseTo(expected.x, 4)
    expect(y0).toBeCloseTo(expected.y, 4)
    expect(x1).toBeCloseTo(expected.x + expected.width, 4)
    expect(y1).toBeCloseTo(expected.y + expected.height, 4)
  }, 60000)

  it('caminho incremental (2ª assinatura) usa a mesma geometria', async () => {
    vi.stubGlobal('fetch', makeTsaMock())
    const { bytes } = await makePdf({ pageWidth: 612, pageHeight: 792, rotate: 90 })
    const first = await signPdfDocument({
      fileName: 'inc.pdf',
      pdfBytes: bytes,
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.1,
      yPct: 0.2,
      size: 'medium',
      widthPct: 0.3,
      heightPct: 0.1,
      tsaUrl: 'not-a-url',
    })
    const second = await signPdfDocument({
      fileName: 'inc-assinado.pdf',
      pdfBytes: Buffer.from(first.pdf),
      certificate: { ...material, pfx: Buffer.from(material.pfx) },
      page: 1,
      xPct: 0.5,
      yPct: 0.6,
      size: 'medium',
      widthPct: 0.3,
      heightPct: 0.1,
      tsaUrl: 'not-a-url',
    })
    const expectedDoc = await PDFDocument.load(bytes)
    const expectedSecond = resolveCustomStampRect(expectedDoc.getPages()[0]!, 0.5, 0.6, 0.3, 0.1)
    const rects = await sigWidgetRects(second.pdf)
    expect(rects.length).toBe(2)
    const [x0, y0, x1, y1] = rects[1]!
    expect(x0).toBeCloseTo(expectedSecond.x, 4)
    expect(y0).toBeCloseTo(expectedSecond.y, 4)
    expect(x1).toBeCloseTo(expectedSecond.x + expectedSecond.width, 4)
    expect(y1).toBeCloseTo(expectedSecond.y + expectedSecond.height, 4)
  }, 90000)
})
