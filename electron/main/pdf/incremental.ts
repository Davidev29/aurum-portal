import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from 'pdf-lib'
import {
  SUBFILTER_ETSI_CADES_DETACHED,
  SIG_FLAGS,
  ANNOTATION_FLAGS,
  DEFAULT_BYTE_RANGE_PLACEHOLDER,
} from '@signpdf/utils'
import {
  AURUMBIT_PLATFORM,
  VALIDATE_ITI_URL,
  type SignatureStampSize,
} from '../../../shared/signature'
import { create as createQr } from 'qrcode'
import {
  computeStampLayout,
  formatDocumentForStamp,
  prepareFonts,
  resolveCustomStampRect,
  resolveStampRect,
  watermarkBox,
  WATERMARK_OPACITY,
  type PreparedFonts,
} from './stamp'
import { displayStampSize, getPageView, stampContentsRelativeMatrix } from './page-geometry'
import { prepareItiSeal, prepareStampWatermark } from './stamp-logo'
import { CmsError } from './cms'

export interface IncrementalPlaceholderInput {
  page: number
  xPct: number
  yPct: number
  size: SignatureStampSize
  /** Tamanho desenhado pelo usuario (fracoes da pagina). */
  widthPct?: number
  heightPct?: number
  /** @deprecated motivo removido; ignorado. */
  reason?: string
  signerName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  issuerDn: string
  signedAt: Date
  /** @deprecated localizacao removida do carimbo; ignorado. */
  location?: string | null
  signatureLength?: number
}

/** Conta assinaturas existentes via AcroForm (FT=/Sig), sem alterar bytes. */
export async function countExistingSignatures(pdfBytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false, updateMetadata: false })
    const catalog = doc.catalog
    const acro = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)
    if (!acro) return 0
    const fields = acro.get(PDFName.of('Fields'))
    if (!(fields instanceof PDFArray)) return 0
    let count = 0
    for (let i = 0; i < fields.size(); i += 1) {
      const ref = fields.get(i)
      const widget: unknown = doc.context.lookup(ref as PDFRef)
      if (widget instanceof PDFDict) {
        const ft = widget.get(PDFName.of('FT'))
        const ftName = ft?.toString?.()
        if (ftName === '/Sig') count += 1
      }
    }
    return count
  } catch {
    // Se pdf-lib nao parseia (ex.: criptografado), assume 0 e deixa o
    // fluxo completo falhar com mensagem clara no load.
    return 0
  }
}

function serializeObject(object: PDFObject): Buffer {
  const size = object.sizeInBytes()
  const buffer = new Uint8Array(size)
  object.copyBytesInto(buffer, 0)
  return Buffer.from(buffer)
}

function parseLastStartXref(pdfBytes: Buffer): number {
  const latin = pdfBytes.toString('latin1')
  const marker = 'startxref'
  const idx = latin.lastIndexOf(marker)
  if (idx < 0) throw new CmsError('Nao foi possivel ler o xref do PDF para assinatura incremental')
  const after = latin.slice(idx + marker.length, idx + marker.length + 64)
  const match = /^\s*(\d+)/.exec(after)
  if (!match) throw new CmsError('Nao foi possivel ler o xref do PDF para assinatura incremental')
  const value = Number(match[1])
  if (!Number.isInteger(value) || value < 0 || value >= pdfBytes.length) {
    throw new CmsError('Nao foi possivel ler o xref do PDF para assinatura incremental')
  }
  return value
}

function createPdfString(text: string) {
  const needsHex = text.split('').some((ch) => ch.charCodeAt(0) > 127)
  return needsHex ? PDFHexString.fromText(text) : PDFString.of(text)
}

function pdfEscapeLiteral(text: string): string {
  // WinAnsi/latin1: caracteres fora do latin1 viram '?'.
  const normalized = text
    .split('')
    .map((ch) => (ch.charCodeAt(0) > 255 ? '?' : ch))
    .join('')
  return normalized.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function issuerShortName(dn: string): string {
  const match = /(?:^|,)\s*CN\s*=\s*([^,]+)/i.exec(dn)
  const cn = (match?.[1] ?? dn).trim()
  return cn.length > 46 ? `${cn.slice(0, 45)}…` : cn
}

function rgbString(color: { red: number; green: number; blue: number }): string {
  return `${color.red.toFixed(3)} ${color.green.toFixed(3)} ${color.blue.toFixed(3)}`
}

function buildStampContent(input: {
  width: number
  height: number
  signerName: string
  documentLine: string | null
  signedAt: Date
  issuerLine: string
  fonts: PreparedFonts
  hasImage: boolean
  /** Caixa da marca d'água no frame local (null = sem marca d'água). */
  watermarkBox?: { x: number; y: number; width: number; height: number } | null
}): string {
  const { width, height, fonts, hasImage } = input
  const layout = computeStampLayout({
    width,
    height,
    signerName: input.signerName,
    documentLine: input.documentLine,
    signedAt: input.signedAt,
    issuerLine: input.issuerLine,
    fonts,
    hasLogo: hasImage,
  })
  const w = width.toFixed(2)
  const h = height.toFixed(2)
  let content = ''
  // Fundo branco com borda slate.
  content += `q 1 1 1 rg 0 0 ${w} ${h} re f 0.2 0.27 0.37 RG 0.75 w 0 0 ${w} ${h} re S Q\n`
  // Marca d'água (biometria) centralizada, atrás de todo o conteudo.
  if (input.watermarkBox) {
    const b = input.watermarkBox
    content += `q /GS1 gs ${b.width.toFixed(2)} 0 0 ${b.height.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)} cm /Im2 Do Q\n`
  }
  // Faixa superior azul-marinho com filete dourado e selo ITI.
  if (layout.headerH > 0) {
    content += `q 0.04 0.07 0.14 rg 0 ${(height - layout.headerH).toFixed(2)} ${w} ${layout.headerH.toFixed(2)} re f Q\n`
  }
  content += `q 0.83 0.69 0.31 rg 0 ${(height - layout.headerH - layout.goldH).toFixed(2)} ${w} ${layout.goldH.toFixed(2)} re f Q\n`
  if (hasImage && layout.sealSide > 0) {
    const side = layout.sealSide.toFixed(2)
    content += `q ${side} 0 0 ${side} ${layout.sealX.toFixed(2)} ${layout.sealY.toFixed(2)} cm /Im1 Do Q\n`
  }
  // Bloco do QR auto-contido: moldura própria com quiet zone (~2 módulos),
  // centralizado, abaixo dos dados (nunca cobre o texto do certificado).
  const qrPad = layout.qrPad
  content += `q 1 1 1 rg 1 1 1 RG 0.75 w ${(layout.qrX - qrPad).toFixed(2)} ${(layout.qrY - qrPad).toFixed(2)} ${(layout.qrSize + qrPad * 2).toFixed(2)} ${(layout.qrSize + qrPad * 2).toFixed(2)} re f S Q\n`
  content += 'q 0 0 0 rg\n'
  try {
    const qr = createQr(VALIDATE_ITI_URL, { errorCorrectionLevel: 'M' })
    const modules = qr.modules.size
    const cell = layout.qrSize / modules
    const data = qr.modules.data as unknown as Uint8Array
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!data[row * modules + col]) continue
        const x = layout.qrX + col * cell
        const y = layout.qrY + (modules - 1 - row) * cell
        content += `${x.toFixed(2)} ${y.toFixed(2)} ${(cell + 0.2).toFixed(2)} ${(cell + 0.2).toFixed(2)} re f `
      }
    }
  } catch {
    // Sem QR o carimbo continua valido apenas com texto.
  }
  content += 'Q\n'
  const fontName = (key: 'bold' | 'regular' | 'oblique'): string =>
    key === 'bold' ? 'F2' : key === 'oblique' ? 'F3' : 'F1'
  for (const line of [...layout.headerLines, ...layout.lines]) {
    content += `BT ${rgbString(line.color)} rg /${fontName(line.font)} ${line.size.toFixed(2)} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm (${pdfEscapeLiteral(line.text)}) Tj ET\n`
  }
  // Borda final por cima (faixa/QR nunca vazam para fora do quadro).
  content += `q 0.2 0.27 0.37 RG 0.75 w 0 0 ${w} ${h} re S Q\n`
  return content
}

/**
 * Gera o placeholder via atualizacao incremental (preserva bytes originais
 * e assinaturas anteriores). Retorna bytes do PDF com placeholder pronto
 * para @signpdf/signpdf preencher ByteRange/Contents sem reescrever o
 * original (o que quebraria assinaturas anteriores com pdf-lib).
 */
export async function createIncrementalPlaceholder(
  originalBytesInput: Buffer,
  input: IncrementalPlaceholderInput,
): Promise<Buffer> {
  // Aceita Uint8Array (via worker) alem de Buffer.
  const originalBytes = Buffer.isBuffer(originalBytesInput)
    ? (originalBytesInput as unknown as Buffer)
    : Buffer.from(originalBytesInput as unknown as Uint8Array)
  if (originalBytes.length === 0) {
    throw new CmsError('Arquivo PDF vazio')
  }
  const signatureLength = input.signatureLength ?? 16 * 1024
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(originalBytes, { ignoreEncryption: false, updateMetadata: false })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('encrypt')) {
      throw new CmsError('PDF protegido por senha nao e suportado')
    }
    throw new CmsError('Nao foi possivel ler o PDF (arquivo corrompido ou formato nao suportado)')
  }
  const ctx: any = doc.context
  const trailerInfo: { Root: PDFRef; Info?: PDFRef; ID?: unknown; Encrypt?: unknown } =
    ctx.trailerInfo ?? {}
  const rootRef = trailerInfo.Root as PDFRef
  if (!rootRef)
    throw new CmsError('Nao foi possivel ler o catalogo do PDF para assinatura incremental')
  const infoRef = trailerInfo.Info as PDFRef | undefined
  const idObject = trailerInfo.ID as PDFObject | undefined
  const prevStartXref = parseLastStartXref(originalBytes)

  const pages = doc.getPages()
  if (pages.length === 0) throw new CmsError('PDF sem paginas')
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > pages.length) {
    throw new CmsError(`Pagina ${input.page} fora do documento (1..${pages.length})`)
  }
  const targetPage = pages[input.page - 1]!
  const pageRef = targetPage.ref as PDFRef
  const pageNode = targetPage.node as PDFDict
  const catalog = doc.catalog
  const catalogRef = ctx.getObjectRef(catalog) as PDFRef

  const rect =
    input.widthPct !== undefined && input.heightPct !== undefined
      ? resolveCustomStampRect(targetPage, input.xPct, input.yPct, input.widthPct, input.heightPct)
      : resolveStampRect(targetPage, input.xPct, input.yPct, input.size)
  const signedAt = input.signedAt
  const signerName = input.signerName.slice(0, 80)
  const documentLine = formatDocumentForStamp(input.document, input.documentType)
  const issuerLine = `Emissor: ${issuerShortName(input.issuerDn)}`
  const fonts = await prepareFonts(doc)
  let seal: Awaited<ReturnType<typeof prepareItiSeal>> = null
  try {
    seal = await prepareItiSeal(doc)
  } catch {
    seal = null
  }
  let watermark: Awaited<ReturnType<typeof prepareStampWatermark>> = null
  try {
    watermark = await prepareStampWatermark(doc)
  } catch {
    watermark = null
  }

  // AcroForm (existente ou novo).
  let acro = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict) as PDFDict | undefined
  let acroRef: PDFRef
  let isNewAcro = false
  if (acro) {
    acroRef = ctx.getObjectRef(acro) as PDFRef
  } else {
    acro = ctx.obj({ Fields: [] }) as PDFDict
    acroRef = ctx.register(acro)
    isNewAcro = true
    catalog.set(PDFName.of('AcroForm'), acroRef)
  }

  // Nome unico do campo (Signature1, Signature2, ...).
  const existingNames = new Set<string>()
  const existingFields = acro.get(PDFName.of('Fields'))
  if (existingFields instanceof PDFArray) {
    for (let i = 0; i < existingFields.size(); i += 1) {
      const widget: unknown = ctx.lookup(existingFields.get(i) as PDFRef)
      if (widget instanceof PDFDict) {
        const t = widget.get(PDFName.of('T'))
        if (t && typeof (t as { toString?: unknown }).toString === 'function') {
          const s = String((t as { toString: () => string }).toString())
          // PDFString.toString() inclui parenteses; extrai o conteudo.
          const inner = s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s
          if (inner) existingNames.add(inner)
        }
        // T pode ser PDFString com asBytes disponiveis.
        const bytes = (t as { asBytes?: () => Uint8Array } | undefined)?.asBytes?.()
        if (bytes) {
          try {
            existingNames.add(Buffer.from(bytes).toString('latin1'))
          } catch {
            // ignora
          }
        }
      }
    }
  }
  let fieldIndex = 1
  while (existingNames.has(`Signature${fieldIndex}`)) fieldIndex += 1
  const fieldName = `Signature${fieldIndex}`

  // Sig dict (igual ao placeholder-pdf-lib, mas registrado para incremental).
  const byteRange = PDFArray.withContext(ctx)
  byteRange.push(PDFNumber.of(0))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER))
  const placeholderHex = PDFHexString.of(String.fromCharCode(0).repeat(signatureLength))
  const signatureDict = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: SUBFILTER_ETSI_CADES_DETACHED,
    ByteRange: byteRange,
    Contents: placeholderHex,
    M: PDFString.fromDate(signedAt),
    ContactInfo: createPdfString(signerName.slice(0, 64)),
    Name: createPdfString(signerName.slice(0, 64)),
    Prop_Build: {
      Filter: { Name: 'Adobe.PPKLite' },
      App: { Name: AURUMBIT_PLATFORM },
    },
  }) as PDFDict
  const sigBuffer = new Uint8Array(signatureDict.sizeInBytes())
  signatureDict.copyBytesInto(sigBuffer, 0)
  const sigObj = PDFInvalidObject.of(sigBuffer)
  const sigRef = ctx.register(sigObj) as PDFRef

  // AP stream (carimbo como aparencia do campo — sem tocar o conteudo da pagina).
  // Frame local do desenho = dimensoes EXIBIDAS (“em pe” na tela). O Rect do
  // widget e o BBox do AP usam as dimensoes em user space.
  const view = getPageView(targetPage)
  const rotation = view.rotation
  const { width, height } = displayStampSize(view, rect)
  const hasImage = Boolean(seal)
  const wmBox = watermark ? watermarkBox(width, height, watermark.width, watermark.height) : null
  const contentString = buildStampContent({
    width,
    height,
    signerName,
    documentLine,
    signedAt,
    issuerLine,
    fonts,
    hasImage,
    watermarkBox: wmBox,
  })
  // /Rotate ≠ 0: a pagina gira na exibicao — o conteudo do AP precisa ser
  // "pre-rotacionado" para aparecer em pe, exatamente onde o usuario desenhou.
  const relative = stampContentsRelativeMatrix(rotation, rect)
  const finalContentString = relative
    ? `q ${relative.join(' ')} cm\n${contentString}Q\n`
    : contentString
  const contentBytes = Buffer.from(finalContentString, 'latin1')
  const resources: Record<string, unknown> = {
    Font: {
      F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' },
      F2: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold' },
      F3: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Oblique' },
    },
  }
  const xobjects: Record<string, unknown> = {}
  if (seal) xobjects.Im1 = seal.ref
  if (watermark) xobjects.Im2 = watermark.ref
  if (Object.keys(xobjects).length > 0) resources.XObject = xobjects
  if (watermark) {
    // Opacidade da marca d'água (ExtGState /GS1, ca/CA = 18%).
    resources.ExtGState = {
      GS1: { Type: 'ExtGState', ca: WATERMARK_OPACITY, CA: WATERMARK_OPACITY },
    }
  }
  const apStream = ctx.stream(new Uint8Array(contentBytes), {
    Type: 'XObject',
    Subtype: 'Form',
    // BBox no sistema do AP (user space): o viewer mapeia BBox→Rect 1:1.
    BBox: [0, 0, rect.width, rect.height],
    Resources: resources,
  })
  const apRef = ctx.register(apStream) as PDFRef

  // Widget.
  const widgetDict = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    V: sigRef,
    T: createPdfString(fieldName),
    F: ANNOTATION_FLAGS.PRINT,
    P: pageRef,
    AP: { N: apRef },
  }) as PDFDict
  const widgetRef = ctx.register(widgetDict) as PDFRef

  // Atualiza Annots da pagina (mutacao no dict existente).
  let annotations = pageNode.lookupMaybe(PDFName.of('Annots'), PDFArray) as PDFArray | undefined
  if (typeof annotations === 'undefined') {
    annotations = ctx.obj([]) as PDFArray
  }
  annotations.push(widgetRef)
  pageNode.set(PDFName.of('Annots'), annotations)

  // Atualiza AcroForm: Fields + SigFlags.
  let fields = acro.get(PDFName.of('Fields'))
  if (!(fields instanceof PDFArray)) {
    fields = ctx.obj([]) as PDFArray
    acro.set(PDFName.of('Fields'), fields)
  }
  ;(fields as PDFArray).push(widgetRef)
  const oldFlags = acro.has(PDFName.of('SigFlags'))
    ? (acro.get(PDFName.of('SigFlags')) as PDFNumber).asNumber()
    : 0
  acro.set(
    PDFName.of('SigFlags'),
    ctx.obj(oldFlags | SIG_FLAGS.SIGNATURES_EXIST | SIG_FLAGS.APPEND_ONLY),
  )

  // Objetos a gravar incrementalmente: (ref, objeto serializavel).
  const toWrite: Array<{ ref: PDFRef; object: PDFObject }> = [
    { ref: sigRef, object: sigObj as unknown as PDFObject },
    { ref: apRef, object: apStream as unknown as PDFObject },
    { ref: widgetRef, object: widgetDict as unknown as PDFObject },
    { ref: pageRef, object: pageNode as unknown as PDFObject },
    { ref: acroRef, object: acro as unknown as PDFObject },
  ]
  // Materializa uma imagem embedPng no contexto incremental (incluindo a
  // SMask de transparencia, quando houver) para gravar no append.
  const materializeImage = async (image: { ref: PDFRef } | null) => {
    if (!image) return
    try {
      const embedder = (
        image as unknown as {
          embedder: { embedIntoContext: (context: unknown, ref: PDFRef) => Promise<PDFRef> }
        }
      ).embedder
      await embedder.embedIntoContext(ctx, image.ref)
      const imageObject = ctx.lookup(image.ref) as PDFObject
      toWrite.push({ ref: image.ref, object: imageObject })
      const imageStream = ctx.lookup(image.ref)
      if (imageStream instanceof PDFStream) {
        const smask = imageStream.dict.get(PDFName.of('SMask'))
        if (smask instanceof PDFRef) {
          const smaskObject = ctx.lookup(smask) as PDFObject | undefined
          if (smaskObject) toWrite.push({ ref: smask, object: smaskObject })
        }
      }
    } catch {
      // Sem a imagem no incremental, o carimbo visual continua valido.
    }
  }
  await materializeImage(seal)
  await materializeImage(watermark)
  if (isNewAcro && catalogRef) {
    toWrite.push({ ref: catalogRef, object: catalog as unknown as PDFObject })
  }

  // Serializa e anexa ao original (nunca reescreve o prefixo).
  const chunks: Buffer[] = []
  const offsets = new Map<number, number>()
  let cursor = originalBytes.length
  for (const { ref, object } of toWrite) {
    const gen = ref.generationNumber ?? 0
    const header = Buffer.from(`${ref.objectNumber} ${gen} obj\n`, 'latin1')
    const body = serializeObject(object)
    const footer = Buffer.from('\nendobj\n', 'latin1')
    offsets.set(ref.objectNumber, cursor)
    chunks.push(header, body, footer)
    cursor += header.length + body.length + footer.length
  }
  const xrefOffset = cursor
  const newSize = (ctx.largestObjectNumber as number) + 1

  // Xref classico com uma subsecao por objeto (valido para incremental).
  const xrefChunks: Buffer[] = [Buffer.from('xref\n', 'latin1')]
  // Agrupa por numeros contiguos para subsecoes enxutas.
  const sorted = [...toWrite].sort((a, b) => a.ref.objectNumber - b.ref.objectNumber)
  let i = 0
  while (i < sorted.length) {
    const start = sorted[i]!.ref.objectNumber
    let end = start
    while (i + 1 < sorted.length && sorted[i + 1]!.ref.objectNumber === end + 1) {
      end += 1
      i += 1
    }
    xrefChunks.push(Buffer.from(`${start} ${end - start + 1}\n`, 'latin1'))
    for (let n = start; n <= end; n += 1) {
      const entry = sorted.find((e) => e.ref.objectNumber === n)!
      const offset = offsets.get(n)!
      const gen = String(entry.ref.generationNumber ?? 0).padStart(5, '0')
      xrefChunks.push(Buffer.from(`${String(offset).padStart(10, '0')} ${gen} n \n`, 'latin1'))
    }
    i += 1
  }

  const trailerParts: string[] = ['trailer', '<<']
  trailerParts.push(`/Size ${newSize}`)
  trailerParts.push(`/Root ${rootRef.toString()}`)
  if (infoRef) trailerParts.push(`/Info ${infoRef.toString()}`)
  trailerParts.push(`/Prev ${prevStartXref}`)
  if (idObject) {
    const idBytes = serializeObject(idObject as PDFObject)
    trailerParts.push(`/ID ${idBytes.toString('latin1')}`)
  }
  trailerParts.push('>>')
  const trailer = Buffer.from(
    `${trailerParts.join(' ')}\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'latin1',
  )

  return Buffer.concat([originalBytes, ...chunks, ...xrefChunks, trailer])
}
