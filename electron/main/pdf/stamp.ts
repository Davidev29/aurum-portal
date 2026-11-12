import {
  PDFPage,
  StandardFonts,
  rgb,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type RGB,
} from 'pdf-lib'
import {
  SIGNATURE_STAMP_MIN,
  SIGNATURE_STAMP_SIZES,
  STAMP_TITLE,
  VALIDATE_ITI_URL,
  type SignatureStampSize,
} from '../../../shared/signature'
import {
  displayRectToUserRect,
  displayStampSize,
  getPageView,
  stampContentsMatrix,
} from './page-geometry'
import { create as createQr } from 'qrcode'
import {
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
} from 'pdf-lib'

/**
 * Desenho do carimbo visual PAdES premium (informativo — a validade juridica
 * esta na assinatura criptografica).
 *
 * Garantias de layout (independente do tamanho desenhado):
 *  - textos fazem quebra de linha por palavras e encolhem ate caber;
 *  - nada e desenhado fora do retangulo do carimbo.
 * O tamanho minimo (SIGNATURE_STAMP_MIN) garante todos os dados legiveis.
 */

export interface StampInput {
  page: PDFPage
  x: number
  y: number
  size: SignatureStampSize
  /** Tamanho desenhado pelo usuario (pt). Quando informado, prevalece sobre size. */
  widthPt?: number
  heightPt?: number
  signerName: string
  documentLine: string | null
  signedAt: Date
  /** @deprecated localizacao removida do carimbo; ignorado. */
  location?: string | null
  /** @deprecated motivo removido do carimbo; ignorado. */
  reason?: string
  issuerLine: string
  fonts: PreparedFonts
  /** Selo ITI ja embutido (cabeçalho do carimbo). */
  seal?: PDFImage | null
}

export interface StampRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PreparedFonts {
  regular: PDFFont
  bold: PDFFont
  oblique: PDFFont
}

type StampFontKey = 'bold' | 'regular' | 'oblique'

export interface FittedLine {
  text: string
  font: StampFontKey
  size: number
  color: RGB
  /** Deslocamento horizontal a partir da borda esquerda do carimbo. */
  x: number
  /** Linha de base vertical a partir da borda inferior do carimbo. */
  y: number
}

export interface StampLayout {
  headerH: number
  qrSize: number
  qrX: number
  qrY: number
  /** Geometria do selo ITI no cabeçalho (side 0 = sem selo). */
  sealX: number
  sealY: number
  sealSide: number
  headerLines: FittedLine[]
  lines: FittedLine[]
}

const COLOR_BORDER = rgb(0.2, 0.27, 0.37)
const COLOR_NAVY = rgb(0.04, 0.07, 0.14)
const COLOR_GOLD = rgb(0.83, 0.69, 0.31)
const COLOR_NAME = rgb(0.06, 0.09, 0.16)
const COLOR_BODY = rgb(0.2, 0.25, 0.33)
const COLOR_MUTED = rgb(0.39, 0.45, 0.55)
const COLOR_WHITE = rgb(1, 1, 1)

const PAD = 7

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Converte coordenadas normalizadas (origem superior-esquerda, 0..1) em
 * retângulo PDF (origem inferior-esquerda). Fora da página → clamp.
 */
/** Escala o carimbo para caber na pagina (margem 4pt), preservando aspecto. */
export function scaledStampSize(
  pageWidth: number,
  pageHeight: number,
  size: SignatureStampSize,
): { width: number; height: number } {
  const { width: w, height: h } = SIGNATURE_STAMP_SIZES[size]
  const availW = Math.max(40, pageWidth - 8)
  const availH = Math.max(28, pageHeight - 8)
  const scale = Math.min(availW / w, availH / h, 1)
  // Nunca encolhe abaixo do minimo quando a pagina comporta o minimo.
  const width = Math.min(availW, Math.max(w * scale, Math.min(SIGNATURE_STAMP_MIN.width, availW)))
  const height = Math.min(availH, Math.max(h * scale, Math.min(SIGNATURE_STAMP_MIN.height, availH)))
  return { width, height }
}

/**
 * Converte o carimbo PRESET (x/yPct = canto SUPERIOR-esquerdo da tela EXIBIDA,
 * fracoes 0..1) em retangulo user space (origem inferior-esquerda).
 * Considera cropBox∩mediaBox e /Rotate — identico ao exibido na previa.
 */
export function resolveStampRect(
  page: PDFPage,
  xPct: number,
  yPct: number,
  size: SignatureStampSize,
): StampRect {
  const view = getPageView(page)
  const { width: scaledW, height: scaledH } = scaledStampSize(view.displayWidth, view.displayHeight, size)
  const displayW = view.displayWidth
  const displayH = view.displayHeight
  const w = Math.min(scaledW, displayW)
  const h = Math.min(scaledH, displayH)
  const x = clamp(xPct * displayW, 0, Math.max(0, displayW - w))
  const top = clamp(yPct * displayH, 0, Math.max(0, displayH - h))
  return displayRectToUserRect(view, x, top, w, h)
}

/**
 * Tamanho desenhado pelo usuario (fracoes da pagina EXIBIDA, origem
 * superior-esquerda). Nunca menor que o minimo que garante todos os dados do
 * carimbo premium. Retorna o retangulo em user space (desloca/rotaciona por
 * /Rotate) — pronto para desenhar e para o widget /Rect.
 */
export function resolveCustomStampRect(
  page: PDFPage,
  xPct: number,
  yPct: number,
  wPct: number,
  hPct: number,
): StampRect {
  const view = getPageView(page)
  const displayW = view.displayWidth
  const displayH = view.displayHeight
  const availW = Math.max(40, displayW)
  const availH = Math.max(28, displayH)
  const minW = Math.min(SIGNATURE_STAMP_MIN.width, availW)
  const minH = Math.min(SIGNATURE_STAMP_MIN.height, availH)
  const dw = clamp(wPct * displayW, minW, availW)
  const dh = clamp(hPct * displayH, minH, availH)
  const dx = clamp(xPct * displayW, 0, Math.max(0, displayW - dw))
  const top = clamp(yPct * displayH, 0, Math.max(0, displayH - dh))
  return displayRectToUserRect(view, dx, top, dw, dh)
}

function fontFor(fonts: PreparedFonts, key: StampFontKey): PDFFont {
  return key === 'bold' ? fonts.bold : key === 'oblique' ? fonts.oblique : fonts.regular
}

/**
 * Quebra o texto por palavras para caber em maxWidth. Palavras longas
 * demais (ex.: CN sem espacos) sao cortadas por caracteres — sempre cabem.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const words = clean.split(' ')
  const lines: string[] = []
  let current = ''
  const fits = (candidate: string): boolean => font.widthOfTextAtSize(candidate, size) <= maxWidth

  const pushHardBroken = (word: string): void => {
    let rest = word
    while (!fits(rest)) {
      let end = rest.length
      while (end > 1 && !fits(rest.slice(0, end))) end -= 1
      lines.push(rest.slice(0, end))
      rest = rest.slice(end)
    }
    current = rest
  }

  for (const word of words) {
    if (!word) continue
    if (!current) {
      if (fits(word)) current = word
      else pushHardBroken(word)
      continue
    }
    const candidate = `${current} ${word}`
    if (fits(candidate)) {
      current = candidate
    } else {
      lines.push(current)
      current = ''
      if (fits(word)) current = word
      else pushHardBroken(word)
    }
  }
  if (current) lines.push(current)
  return lines
}

function truncateToWidth(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text
  let end = text.length
  while (end > 1) {
    end -= 1
    const candidate = `${text.slice(0, end).trimEnd()}…`
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) return candidate
  }
  return '…'
}

function formatSignedAt(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  // Horário de Brasília (UTC-3, sem horário de verão desde 2019).
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  return (
    `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ` +
    `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
  )
}

/** Formata CPF/CNPJ para exibição no carimbo. */
export function formatDocumentForStamp(
  document: string | null | undefined,
  type: 'CPF' | 'CNPJ' | 'OTHER' | undefined,
): string | null {
  const digits = (document ?? '').replace(/\D+/g, '')
  if (type === 'CPF' && digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }
  if (type === 'CNPJ' && digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  }
  return digits.length > 0 ? `Documento: ${digits}` : null
}

/** Embute Helvetica/Helvetica-Bold/Oblique (WinAnsi) uma única vez por documento. */
export async function prepareFonts(doc: PDFDocument): Promise<PreparedFonts> {
  const cache = (doc as unknown as { __pvFonts?: PreparedFonts }).__pvFonts
  if (cache) return cache
  const [regular, bold, oblique] = await Promise.all([
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
    doc.embedFont(StandardFonts.HelveticaOblique),
  ])
  const fonts = { regular, bold, oblique }
  ;(doc as unknown as { __pvFonts?: PreparedFonts }).__pvFonts = fonts
  return fonts
}

export function qrModuleCountAndData(): { size: number; data: Uint8Array } {
  const qr = createQr(VALIDATE_ITI_URL, { errorCorrectionLevel: 'M' })
  return { size: qr.modules.size, data: qr.modules.data as unknown as Uint8Array }
}

interface DataSpec {
  text: string
  font: StampFontKey
  size: number
  minSize: number
  color: RGB
  afterGap: number
}

/**
 * Calcula o layout premium em coordenadas relativas ao carimbo (origem no
 * canto inferior-esquerdo, em pt). Ajusta tamanhos ate caber na altura.
 */
export function computeStampLayout(input: {
  width: number
  height: number
  signerName: string
  documentLine: string | null
  signedAt: Date
  issuerLine: string
  fonts: PreparedFonts
  /** true quando o selo ITI será desenhado no cabeçalho. */
  hasLogo?: boolean
}): StampLayout {
  const { width, height, fonts } = input
  const hasLogo = input.hasLogo === true
  const compact = height < 90
  const headerH = hasLogo ? clamp(height * 0.21, 18, 30) : 0
  const goldH = 1.2
  // Bloco do QR na LATERAL DIREITA (abaixo do cabeçalho): proporcional,
  // auto-contido (moldura própria, dentro do quadro) numa coluna própria.
  // O bloco de texto ocupa a coluna esquerda — nunca fica sob o QR.
  const qrSize = clamp(Math.floor(height * 0.3), 22, 110)
  const qrBottomMargin = 6
  const qrColumnGap = 10
  const qrX = width - qrSize - PAD
  const qrY = qrBottomMargin

  const bodyMaxWidth = Math.max(60, width - PAD * 2 - qrSize - qrColumnGap)

  const specs: DataSpec[] = [
    { text: input.signerName, font: 'bold', size: 10.5, minSize: 6.2, color: COLOR_NAME, afterGap: 3 },
    ...(input.documentLine
      ? [{ text: input.documentLine, font: 'regular' as const, size: 7.5, minSize: 5.4, color: COLOR_BODY, afterGap: 2 }]
      : []),
    { text: input.issuerLine, font: 'regular', size: 7, minSize: 5.4, color: COLOR_MUTED, afterGap: 2 },
    { text: `Data: ${formatSignedAt(input.signedAt)} -03:00`, font: 'regular', size: 7, minSize: 5.4, color: COLOR_BODY, afterGap: 1 },
  ]

  const build = (scale: number): { lines: FittedLine[]; bottom: number } => {
    const lines: FittedLine[] = []
    let cursorTop = height - headerH - goldH - (compact ? 2 : 5)
    for (const spec of specs) {
      const size = Math.max(spec.size * scale, 4.2)
      const wrapped = wrapText(spec.text, fontFor(fonts, spec.font), size, bodyMaxWidth)
      for (const chunk of wrapped.length > 0 ? wrapped : [truncateToWidth(spec.text, fontFor(fonts, spec.font), size, bodyMaxWidth)]) {
        const baseline = cursorTop - size
        lines.push({ text: chunk, font: spec.font, size, color: spec.color, x: PAD, y: baseline })
        cursorTop -= size * 1.15
      }
      cursorTop -= spec.afterGap
    }
    const bottom = lines.length > 0 ? lines[lines.length - 1]!.y : cursorTop
    return { lines, bottom }
  }

  // Texto ocupa toda a coluna esquerda (do topo ao rodapé do quadro) —
  // nunca sob o QR. O mínimo do carimbo garante legibilidade.
  const textFloor = qrY
  const fits = (r: { lines: FittedLine[]; bottom: number }): boolean =>
    r.lines.length === 0 || r.bottom >= textFloor + 2

  let best = build(1)
  if (!fits(best)) {
    for (const scale of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45]) {
      best = build(scale)
      if (fits(best)) break
    }
  }

  // Ultimo recurso (quadro abaixo do minimo): descarta as linhas finais
  // de dados (nunca o nome) para nunca vazar do quadro.
  while (!fits(best) && best.lines.length > 1) {
    best.lines.pop()
    best = { lines: best.lines, bottom: best.lines[best.lines.length - 1]?.y ?? height - headerH - goldH - 5 }
  }

  // Título no cabeçalho (branco sobre azul-marinho) + selo ITI à direita.
  const sealSide = hasLogo ? Math.max(14, headerH - 5) : 0
  const sealX = width - sealSide - PAD
  const sealY = height - headerH + (headerH - sealSide) / 2
  const headerWidth = Math.max(60, width - PAD * 2 - sealSide - 8)
  let headerSize = 7.6
  while (headerSize > 5 && fonts.bold.widthOfTextAtSize(STAMP_TITLE, headerSize) > headerWidth) {
    headerSize -= 0.25
  }
  const headerLines: FittedLine[] = [
    {
      text: truncateToWidth(STAMP_TITLE, fonts.bold, headerSize, headerWidth),
      font: 'bold',
      size: headerSize,
      color: COLOR_WHITE,
      x: PAD,
      y: height - headerH / 2 - headerSize * 0.35,
    },
  ]

  return {
    headerH,
    qrSize,
    qrX,
    qrY,
    sealX,
    sealY,
    sealSide,
    headerLines,
    lines: best.lines,
  }
}

export function drawSignatureStamp(input: StampInput): void {
  const { page, x, y, size, fonts, seal } = input
  // Geometria unica: cropBox∩mediaBox + /Rotate — mesma base da previa.
  const view = getPageView(page)
  const rotation = view.rotation
  const rectUser = { x, y, width: input.widthPt && input.widthPt > 0 ? input.widthPt : 0, height: input.heightPt && input.heightPt > 0 ? input.heightPt : 0 }
  const fallback = scaledStampSize(view.displayWidth, view.displayHeight, size)
  const fallbackUser = displayRectToUserRect(view, 0, 0, fallback.width, fallback.height)
  const userWidth = rectUser.width > 0 ? rectUser.width : fallbackUser.width
  const userHeight = rectUser.height > 0 ? rectUser.height : fallbackUser.height
  const rect = { x, y, width: userWidth, height: userHeight }
  // Frame local do desenho ("em pe" como na tela): para /Rotate 90/270
  // as dimensoes exibidas sao invertidas em relacao ao user space.
  const { width, height } = displayStampSize(view, rect)

  const layout = computeStampLayout({
    width,
    height,
    signerName: input.signerName,
    documentLine: input.documentLine,
    signedAt: input.signedAt,
    issuerLine: input.issuerLine,
    fonts,
    hasLogo: Boolean(seal),
  })

  // /Rotate ≠ 0: desenha em frame local "em pe" e deixa uma matriz cm
  // mapear para o user rect (o viewer rotaciona a pagina por cima).
  const matrix = stampContentsMatrix(rotation, rect)
  const rotated = matrix !== null
  // Origem para desenho dos filhos: user-space absoluta (0°) ou frame local.
  const ox = rotated ? 0 : x
  const oy = rotated ? 0 : y

  if (rotated) {
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix))
  }

  // Painel branco com borda — todo o conteudo cabe dentro deste retangulo.
  page.drawRectangle({
    x: ox,
    y: oy,
    width,
    height,
    borderWidth: 0.75,
    borderColor: COLOR_BORDER,
    color: COLOR_WHITE,
    opacity: 0.98,
    borderOpacity: 1,
  })

  // Faixa superior azul-marinho com filete dourado e selo ITI.
  if (layout.headerH > 0) {
    page.drawRectangle({ x: ox, y: oy + height - layout.headerH, width, height: layout.headerH, color: COLOR_NAVY, opacity: 1 })
  }
  page.drawRectangle({ x: ox, y: oy + height - layout.headerH - 1.2, width, height: 1.2, color: COLOR_GOLD, opacity: 1 })
  if (seal && layout.sealSide > 0) {
    try {
      page.drawImage(seal, {
        x: ox + layout.sealX,
        y: oy + layout.sealY,
        width: layout.sealSide,
        height: layout.sealSide,
      })
    } catch {
      // sem selo, o carimbo continua valido
    }
  }

  // Bloco do QR: moldura própria, centralizado, abaixo do bloco de texto
  // (nunca cobre os dados). Auto-contido: quadro branco + borda + QR vetorial.
  const qrSize = layout.qrSize
  const qrX = ox + layout.qrX
  const qrY = oy + layout.qrY
  page.drawRectangle({ x: qrX - 2, y: qrY - 2, width: qrSize + 4, height: qrSize + 4, borderWidth: 0.75, borderColor: COLOR_BORDER, color: COLOR_WHITE, opacity: 1 })
  try {
    const { size: modules, data } = qrModuleCountAndData()
    const cell = qrSize / modules
    const black = rgb(0, 0, 0)
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        const dark = data[row * modules + col]
        if (!dark) continue
        page.drawRectangle({
          x: qrX + col * cell,
          y: qrY + (modules - 1 - row) * cell,
          width: cell + 0.2,
          height: cell + 0.2,
          color: black,
        })
      }
    }
  } catch {
    // Se o QR falhar, o carimbo continua valido apenas com texto.
  }

  const drawLine = (line: FittedLine): void => {
    const font = fontFor(fonts, line.font)
    page.drawText(line.text, { x: ox + line.x, y: oy + line.y, size: line.size, font, color: line.color })
  }
  for (const line of layout.headerLines) drawLine(line)
  for (const line of layout.lines) drawLine(line)

  // Borda final por cima (faixa/QR nunca vazam para fora do quadro).
  page.drawRectangle({
    x: ox,
    y: oy,
    width,
    height,
    borderWidth: 0.75,
    borderColor: COLOR_BORDER,
  })

  if (rotated) {
    page.pushOperators(popGraphicsState())
  }
}
