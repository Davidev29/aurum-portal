'use client'

import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type RGB } from 'pdf-lib'
import { generateTrackingCode, hexToRgbTuple, type LetterheadSettings } from '@shared/letterhead'
import type { OfficeProfile } from '@shared/types'
import { formatDocument } from '@shared/validation'
import { generateBarcodePngBytes } from './barcode'
import { drawFallbackBarcode } from './fallback-barcode'
import { toWinAnsiSafe, truncateToWidth, wrapText } from './text'

/**
 * Renderizador editorial A4 reutilizável (timbrado + corpo + rodapé).
 *
 * Proteção contra sobreposição (nenhum PDF gerado pelo sistema sobrepõe texto):
 * - Todo bloco é MEDIDO antes de desenhado: altura calculada a partir das
 *   linhas quebradas (wrapText), nunca fixa.
 * - Um único cursor monotônico desce pela página; cada desenho consome
 *   altura (`ensureSpace`) e quebra de página ocorre ANTES de desenhar.
 * - Bloco do título, cabeçalhos de seção e linhas de tabela nunca cruzam
 *   o rodapé (`CONTENT_BOTTOM`) nem o próximo bloco.
 * - Cabeçalho, título e células têm limite de linhas com truncamento ("…").
 * - Linhas longas de tabela podem ser divididas entre páginas.
 */

export interface ReportTable {
  columns: string[]
  /** Frações relativas (ex.: [2, 1, 1]); omitir = colunas iguais. */
  widths?: number[]
  rows: string[][]
}

export interface ReportSection {
  heading?: string
  paragraphs?: string[]
  table?: ReportTable
}

export interface GenerateReportInput {
  title: string
  subtitle?: string
  /** Linhas de metadados abaixo do título (filtros, período etc.). */
  meta?: string[]
  office: OfficeProfile
  letterhead: LetterheadSettings
  generatedAt?: Date
  trackingCode?: string
  sections: ReportSection[]
}

export interface GenerateReportResult {
  bytes: Uint8Array
  trackingCode: string
  pageCount: number
}

const PAGE_W = 595.28 // A4
const PAGE_H = 841.89
const MARGIN = 51 // 18 mm
const CONTENT_W = PAGE_W - MARGIN * 2
const TOP = PAGE_H - 40 // 14 mm
const HEADER_H = 74
const BAR_Y = TOP - HEADER_H
/** Nada do corpo pode descer até aqui (rodapé fica em y=50). */
const CONTENT_BOTTOM = 58

const TITLE_SIZE = 15
const TITLE_LEADING = 18
const SUBTITLE_SIZE = 8.5
const SUBTITLE_LEADING = 11.5
const META_SIZE = 7
const META_LEADING = 9.5
const BODY_SIZE = 8.5
const BODY_LEADING = 11
const HEADING_SIZE = 10
const HEADING_H = 16
const TABLE_SIZE = 7.5
const TABLE_LEADING = 9.5
const TABLE_HEADER_H = 15

function color(hex: string): RGB {
  const [r, g, b] = hexToRgbTuple(hex)
  return rgb(r, g, b)
}

function formatEmitterDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

function barGap(letterhead: LetterheadSettings): number {
  return letterhead.barStyle === 'double' ? 10 : 8
}

function bodyTopNext(letterhead: LetterheadSettings): number {
  return BAR_Y - barGap(letterhead) - 8
}

/** Limita a N linhas; o excedente vira reticências na última linha. */
function limitLines(
  lines: string[],
  max: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (lines.length <= max) return lines
  if (max <= 0) return []
  const kept = lines.slice(0, max - 1)
  const remainder = lines.slice(max - 1).join(' ')
  kept.push(truncateToWidth(remainder, font, size, maxWidth))
  return kept
}

async function embedOfficeLogo(
  doc: PDFDocument,
  logoBase64: string | null,
): Promise<PDFImage | null> {
  if (!logoBase64) return null
  const match = /^data:image\/([a-z]+);base64,(.+)$/s.exec(logoBase64)
  if (!match) return null
  const mime = match[1] ?? ''
  const bytes = Uint8Array.from(atob(match[2] ?? ''), (char) => char.charCodeAt(0))
  try {
    if (mime === 'png') return await doc.embedPng(bytes)
    if (mime === 'jpeg' || mime === 'jpg') return await doc.embedJpg(bytes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const winDocument = (globalThis as any).document
    if (mime === 'webp' && winDocument) {
      // pdf-lib não embute WebP: converte via canvas do renderer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = globalThis as any
      const blob = new win.Blob([bytes], { type: 'image/webp' })
      const url = URL.createObjectURL(blob)
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const image = await new Promise<any>((resolve, reject) => {
          const img = new win.Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('webP inválido'))
          img.src = url
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canvas = winDocument.createElement('canvas') as any
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        canvas.getContext('2d')?.drawImage(image, 0, 0)
        const pngResponse = await (globalThis as unknown as typeof fetch)(
          canvas.toDataURL('image/png'),
        )
        return await doc.embedPng(new Uint8Array(await pngResponse.arrayBuffer()))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
  } catch {
    return null
  }
  return null
}

interface PreparedFonts {
  regular: PDFFont
  bold: PDFFont
  oblique: PDFFont
}

async function prepareReportFonts(
  doc: PDFDocument,
  titleFont: LetterheadSettings['titleFont'],
): Promise<PreparedFonts> {
  const regular = titleFont === 'times' ? StandardFonts.TimesRoman : StandardFonts.Helvetica
  const bold = titleFont === 'times' ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold
  const oblique =
    titleFont === 'times' ? StandardFonts.TimesRomanItalic : StandardFonts.HelveticaOblique
  const [regularFont, boldFont, obliqueFont] = await Promise.all([
    doc.embedFont(regular),
    doc.embedFont(bold),
    doc.embedFont(oblique),
  ])
  return { regular: regularFont, bold: boldFont, oblique: obliqueFont }
}

function rightAligned(
  page: import('pdf-lib').PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  colorValue: RGB,
  rightX: number,
  baseline: number,
): void {
  const width = font.widthOfTextAtSize(text, size)
  page.drawText(text, { x: rightX - width, y: baseline, size, font, color: colorValue })
}

function drawHeader(
  page: import('pdf-lib').PDFPage,
  office: OfficeProfile,
  letterhead: LetterheadSettings,
  fonts: PreparedFonts,
  logo: PDFImage | null,
  generatedAt: Date,
  /** Presente apenas na primeira página — demais páginas não repetem o barcode. */
  headerBarcode?: { image: PDFImage | null; trackingCode: string } | null,
): void {
  const primary = color(letterhead.primaryColor)
  const accent = color(letterhead.accentColor)
  const ink = color(letterhead.inkColor)
  const muted = color(letterhead.mutedColor)

  // Logomarca à esquerda (tamanho configurável, aspecto preservado).
  const logoBox =
    letterhead.logoSize === 's'
      ? { w: 56, h: 28 }
      : letterhead.logoSize === 'l'
        ? { w: 90, h: 45 }
        : { w: 72, h: 36 }
  if (logo) {
    const scale = Math.min(logoBox.w / logo.width, logoBox.h / logo.height)
    const w = logo.width * scale
    const h = logo.height * scale
    page.drawImage(logo, {
      x: MARGIN,
      y: TOP - h - Math.max(0, (logoBox.h - h) / 2),
      width: w,
      height: h,
    })
  } else {
    page.drawRectangle({
      x: MARGIN,
      y: TOP - logoBox.h,
      width: logoBox.w,
      height: logoBox.h,
      borderWidth: 0.5,
      borderColor: color('#E2E6ED'),
      color: color('#F8F9FB'),
    })
    page.drawText('LOGO', {
      x: MARGIN + logoBox.w / 2 - fonts.bold.widthOfTextAtSize('LOGO', 7) / 2,
      y: TOP - logoBox.h / 2 - 2.5,
      size: 7,
      font: fonts.bold,
      color: muted,
    })
  }

  // Coluna da empresa: linhas medidas; nada cruza a barra divisória.
  const textX = MARGIN + logoBox.w + 10
  const textW = Math.max(80, CONTENT_W - logoBox.w - 10 - 170)
  const minBaseline = BAR_Y + 8
  const lines: Array<{ text: string; size: number; font: PDFFont; color: RGB; leading: number }> =
    []
  const name = letterhead.showTradeName && office.tradeName ? office.tradeName : office.legalName
  if (name) {
    lines.push({
      text: truncateToWidth(toWinAnsiSafe(name), fonts.bold, 11, textW),
      size: 11,
      font: fonts.bold,
      color: ink,
      leading: 16,
    })
  }
  if (letterhead.showTradeName && office.tradeName && office.legalName) {
    lines.push({
      text: truncateToWidth(toWinAnsiSafe(office.legalName), fonts.regular, 7.5, textW),
      size: 7.5,
      font: fonts.regular,
      color: muted,
      leading: 11,
    })
  }
  if (letterhead.showCnpj && office.cnpj) {
    lines.push({
      text: truncateToWidth(
        toWinAnsiSafe(`CNPJ ${formatDocument(office.cnpj)}`),
        fonts.regular,
        7.5,
        textW,
      ),
      size: 7.5,
      font: fonts.regular,
      color: muted,
      leading: 11,
    })
  }
  if (letterhead.showRegistrations) {
    const regs = [
      office.municipalRegistration ? `IM ${office.municipalRegistration}` : '',
      office.stateRegistration ? `IE ${office.stateRegistration}` : '',
      office.registration ? `Registro ${office.registration}` : '',
    ]
      .filter(Boolean)
      .join('  -  ')
    if (regs) {
      lines.push({
        text: truncateToWidth(toWinAnsiSafe(regs), fonts.regular, 7, textW),
        size: 7,
        font: fonts.regular,
        color: muted,
        leading: 10,
      })
    }
  }
  if (letterhead.showAddress) {
    const address = [office.address, [office.city, office.state].filter(Boolean).join('/')]
      .filter(Boolean)
      .join(' - ')
    if (address) {
      lines.push({
        text: truncateToWidth(toWinAnsiSafe(address), fonts.regular, 7, textW),
        size: 7,
        font: fonts.regular,
        color: muted,
        leading: 10,
      })
    }
  }
  if (letterhead.showContact) {
    const contact = [office.phone, office.email, office.website].filter(Boolean).join('  -  ')
    if (contact) {
      lines.push({
        text: truncateToWidth(toWinAnsiSafe(contact), fonts.regular, 7, textW),
        size: 7,
        font: fonts.regular,
        color: muted,
        leading: 10,
      })
    }
  }
  let cursor = TOP - 11
  for (const line of lines) {
    const baseline = cursor - line.size
    if (baseline < minBaseline) break // proteção: nunca cruzar a barra
    page.drawText(line.text, {
      x: textX,
      y: baseline,
      size: line.size,
      font: line.font,
      color: line.color,
    })
    cursor -= line.leading
  }

  // Bloco do emissor (coluna direita), também limitado acima da barra.
  const emitterX = PAGE_W - MARGIN
  let emitterY = TOP - 7
  const emitterLines: Array<{ text: string; size: number; font: PDFFont; color: RGB }> = [
    { text: 'EMISSOR', size: 6, font: fonts.bold, color: primary },
  ]
  if (letterhead.showManager && office.managerName) {
    emitterLines.push({
      text: truncateToWidth(toWinAnsiSafe(office.managerName), fonts.bold, 7.5, 164),
      size: 7.5,
      font: fonts.bold,
      color: ink,
    })
  }
  // CPF do responsável: nunca exibido, nem mascarado.
  emitterLines.push({
    text: toWinAnsiSafe(`Emissão: ${formatEmitterDate(generatedAt)}`),
    size: 7,
    font: fonts.regular,
    color: muted,
  })
  for (const [index, line] of emitterLines.entries()) {
    const baseline = emitterY - line.size
    if (baseline < minBaseline) break
    rightAligned(page, line.font, line.text, line.size, line.color, emitterX, baseline)
    emitterY -= index === 0 ? 12 : 10
  }

  // Barcode Code128: SEMPRE presente na primeira página, no cabeçalho à
  // direita (abaixo do emissor, acima da barra), com o código legível
  // abaixo. Se a geração real (bwip-js) falhar, cai para um barcode
  // figurativo vetorial — nunca fica ausente. Nunca cruza a barra:
  // topo do barcode <= BAR_Y+26, código em BAR_Y+4.
  if (headerBarcode) {
    const barcodeH = 14
    const barcodeY = BAR_Y + 12
    let barcodeW: number
    let barcodeX: number
    if (headerBarcode.image) {
      barcodeW = Math.min(168, (headerBarcode.image.width / headerBarcode.image.height) * barcodeH)
      barcodeX = PAGE_W - MARGIN - barcodeW
      page.drawImage(headerBarcode.image, {
        x: barcodeX,
        y: barcodeY,
        width: barcodeW,
        height: barcodeH,
      })
    } else {
      barcodeW = 110
      barcodeX = PAGE_W - MARGIN - barcodeW
      drawFallbackBarcode(page, headerBarcode.trackingCode, {
        x: barcodeX,
        y: barcodeY,
        width: barcodeW,
        height: barcodeH,
        color: ink,
      })
    }
    const codeText = headerBarcode.trackingCode
    const codeW = fonts.bold.widthOfTextAtSize(codeText, 6)
    page.drawText(codeText, {
      x: barcodeX + barcodeW / 2 - codeW / 2,
      y: BAR_Y + 4,
      size: 6,
      font: fonts.bold,
      color: muted,
    })
  }

  // Barra divisória: faixa primária + filete de acento.
  const barHeight =
    letterhead.barStyle === 'thin' ? 1 : Math.min(4, Math.max(1, letterhead.barWidth))
  page.drawRectangle({
    x: MARGIN,
    y: BAR_Y - barHeight,
    width: CONTENT_W,
    height: barHeight,
    color: primary,
  })
  if (letterhead.barStyle === 'double') {
    page.drawRectangle({
      x: MARGIN,
      y: BAR_Y - barHeight - 4,
      width: CONTENT_W,
      height: 1,
      color: accent,
    })
  } else if (letterhead.barStyle === 'solid') {
    page.drawRectangle({
      x: MARGIN,
      y: BAR_Y - barHeight - 3,
      width: CONTENT_W * 0.24,
      height: 0.8,
      color: accent,
    })
  }
}

interface TitlePlan {
  titleLines: string[]
  subtitleLines: string[]
  metaLines: string[]
  /** Metadados que não couberam no bloco (vão para o corpo, sem sobrepor). */
  overflowMeta: string[]
  height: number
}

function planTitleBlock(input: GenerateReportInput, fonts: PreparedFonts): TitlePlan {
  const innerW = CONTENT_W - 16
  const titleLines = limitLines(
    wrapText(toWinAnsiSafe(input.title), fonts.bold, TITLE_SIZE, innerW),
    2,
    fonts.bold,
    TITLE_SIZE,
    innerW,
  )
  const subtitleLines = input.subtitle
    ? limitLines(
        wrapText(toWinAnsiSafe(input.subtitle), fonts.regular, SUBTITLE_SIZE, innerW),
        2,
        fonts.regular,
        SUBTITLE_SIZE,
        innerW,
      )
    : []
  const allMeta: string[] = []
  for (const line of input.meta ?? []) {
    if (!line.trim()) continue
    allMeta.push(
      ...limitLines(
        wrapText(toWinAnsiSafe(line), fonts.regular, META_SIZE, innerW),
        2,
        fonts.regular,
        META_SIZE,
        innerW,
      ),
    )
  }
  const metaLines = allMeta.slice(0, 6)
  const overflowMeta = allMeta.slice(6)

  let height = 10 // topo
  height += 10 + 6 // eyebrow + respiro
  height += titleLines.length * TITLE_LEADING
  if (subtitleLines.length > 0) height += 4 + subtitleLines.length * SUBTITLE_LEADING
  if (metaLines.length > 0) height += 4 + metaLines.length * META_LEADING
  height += 9 // base

  return { titleLines, subtitleLines, metaLines, overflowMeta, height }
}

function drawTitleBlock(
  page: import('pdf-lib').PDFPage,
  input: GenerateReportInput,
  fonts: PreparedFonts,
  trackingCode: string,
  plan: TitlePlan,
): number {
  const primary = color(input.letterhead.primaryColor)
  const ink = color(input.letterhead.inkColor)
  const muted = color(input.letterhead.mutedColor)
  const surface = color(input.letterhead.surfaceColor)
  const top = BAR_Y - barGap(input.letterhead)

  // Faixa clara com altura EXATA do conteúdo medido.
  page.drawRectangle({
    x: MARGIN,
    y: top - plan.height,
    width: CONTENT_W,
    height: plan.height,
    color: surface,
  })

  let cursor = top - 10
  page.drawText('RELATORIO OFICIAL', {
    x: MARGIN + 8,
    y: cursor - 6.5,
    size: 6.5,
    font: fonts.bold,
    color: primary,
  })
  rightAligned(
    page,
    fonts.regular,
    toWinAnsiSafe(`CODIGO: ${trackingCode}`),
    6.5,
    muted,
    MARGIN + CONTENT_W - 8,
    cursor - 6.5,
  )
  cursor -= 16
  for (const line of plan.titleLines) {
    page.drawText(line, {
      x: MARGIN + 8,
      y: cursor - TITLE_SIZE,
      size: TITLE_SIZE,
      font: fonts.bold,
      color: ink,
    })
    cursor -= TITLE_LEADING
  }
  if (plan.subtitleLines.length > 0) {
    cursor -= 4
    for (const line of plan.subtitleLines) {
      page.drawText(line, {
        x: MARGIN + 8,
        y: cursor - SUBTITLE_SIZE,
        size: SUBTITLE_SIZE,
        font: fonts.regular,
        color: muted,
      })
      cursor -= SUBTITLE_LEADING
    }
  }
  if (plan.metaLines.length > 0) {
    cursor -= 4
    for (const line of plan.metaLines) {
      page.drawText(line, {
        x: MARGIN + 8,
        y: cursor - META_SIZE,
        size: META_SIZE,
        font: fonts.regular,
        color: muted,
      })
      cursor -= META_LEADING
    }
  }
  // cursor deve terminar exatamente no fundo medido; retorna o topo do corpo.
  return top - plan.height - 12
}

export async function generateReportPdf(input: GenerateReportInput): Promise<GenerateReportResult> {
  const trackingCode = input.trackingCode ?? generateTrackingCode(input.generatedAt)
  const generatedAt = input.generatedAt ?? new Date()
  const doc = await PDFDocument.create()
  doc.setTitle(toWinAnsiSafe(input.title))
  doc.setAuthor(
    toWinAnsiSafe(input.office.tradeName || input.office.legalName || 'AurumBit Portal'),
  )
  doc.setSubject(toWinAnsiSafe(`Codigo de rastreio ${trackingCode}`))
  doc.setProducer('AurumBit Portal')
  doc.setCreationDate(generatedAt)

  const fonts = await prepareReportFonts(doc, input.letterhead.titleFont)
  const logo = await embedOfficeLogo(doc, input.office.logoBase64).catch(() => null)
  const barcodeBytes = await generateBarcodePngBytes(trackingCode).catch((error: unknown) => {
    console.warn('[report] barcode real indisponível; usando barcode figurativo.', error)
    return null
  })
  const barcodeImage = barcodeBytes ? await doc.embedPng(barcodeBytes).catch(() => null) : null

  const primary = color(input.letterhead.primaryColor)
  const ink = color(input.letterhead.inkColor)
  const muted = color(input.letterhead.mutedColor)
  const border = color('#E2E6ED')
  const rowAlt = color('#F8F9FB')

  let page = doc.addPage([PAGE_W, PAGE_H])
  // Barcode: apenas na primeira página, no cabeçalho (à direita).
  drawHeader(page, input.office, input.letterhead, fonts, logo, generatedAt, {
    image: barcodeImage,
    trackingCode,
  })
  const titlePlan = planTitleBlock(input, fonts)
  let cursor = drawTitleBlock(page, input, fonts, trackingCode, titlePlan) // topo do corpo

  const newPage = (): void => {
    page = doc.addPage([PAGE_W, PAGE_H])
    drawHeader(page, input.office, input.letterhead, fonts, logo, generatedAt)
    cursor = bodyTopNext(input.letterhead)
  }
  /** Garante espaço livre; quebra de página ANTES de qualquer desenho. */
  const ensureSpace = (needed: number): void => {
    if (cursor - needed >= CONTENT_BOTTOM) return
    newPage()
  }

  const drawBodyLines = (
    lines: string[],
    size: number,
    leading: number,
    font: PDFFont,
    lineColor: RGB,
  ): void => {
    for (const line of lines) {
      ensureSpace(leading)
      page.drawText(line, { x: MARGIN, y: cursor - size, size, font, color: lineColor })
      cursor -= leading
    }
  }

  // Metadados que transbordaram o bloco do título vão para o corpo.
  if (titlePlan.overflowMeta.length > 0) {
    drawBodyLines(titlePlan.overflowMeta, META_SIZE, META_LEADING, fonts.regular, muted)
    cursor -= 4
  }

  const measureNext = (section: ReportSection): number => {
    const firstParagraph = section.paragraphs?.find((item) => item.trim())
    if (firstParagraph) {
      const lines = wrapText(toWinAnsiSafe(firstParagraph), fonts.regular, BODY_SIZE, CONTENT_W)
      return Math.max(11, Math.min(22, lines.length * BODY_LEADING))
    }
    if (section.table && section.table.columns.length > 0) return TABLE_HEADER_H + 13
    return 11
  }

  input.sections.forEach((section, sectionIndex) => {
    if (section.heading) {
      const gapBefore = sectionIndex === 0 && titlePlan.overflowMeta.length === 0 ? 6 : 14
      ensureSpace(gapBefore + HEADING_H + measureNext(section))
      cursor -= gapBefore
      const headingText = truncateToWidth(
        toWinAnsiSafe(section.heading),
        fonts.bold,
        HEADING_SIZE,
        CONTENT_W,
      )
      page.drawText(headingText, {
        x: MARGIN,
        y: cursor - HEADING_SIZE,
        size: HEADING_SIZE,
        font: fonts.bold,
        color: primary,
      })
      cursor -= HEADING_H
      page.drawRectangle({ x: MARGIN, y: cursor, width: 28, height: 1, color: primary })
      cursor -= 6
    }
    for (const paragraph of section.paragraphs ?? []) {
      if (!paragraph.trim()) continue
      drawBodyLines(
        wrapText(toWinAnsiSafe(paragraph), fonts.regular, BODY_SIZE, CONTENT_W),
        BODY_SIZE,
        BODY_LEADING,
        fonts.regular,
        ink,
      )
      cursor -= 4
    }
    const table = section.table
    if (!table || table.columns.length === 0) return

    const colCount = table.columns.length
    const weights =
      table.widths && table.widths.length === colCount
        ? table.widths.map((w) => Math.max(0.2, w))
        : Array.from({ length: colCount }, () => 1)
    const totalWeight = weights.reduce((sum, w) => sum + w, 0)
    const colWidths = weights.map((w) => (CONTENT_W * w) / totalWeight)
    const colX: number[] = []
    let accX = MARGIN
    for (const w of colWidths) {
      colX.push(accX)
      accX += w
    }

    const drawTableHeader = (): void => {
      ensureSpace(TABLE_HEADER_H + 2)
      page.drawRectangle({
        x: MARGIN,
        y: cursor - TABLE_HEADER_H,
        width: CONTENT_W,
        height: TABLE_HEADER_H,
        color: primary,
      })
      table.columns.forEach((column, index) => {
        const text = truncateToWidth(
          toWinAnsiSafe(column),
          fonts.bold,
          7,
          (colWidths[index] ?? 80) - 8,
        )
        page.drawText(text, {
          x: (colX[index] ?? MARGIN) + 4,
          y: cursor - TABLE_HEADER_H + 5,
          size: 7,
          font: fonts.bold,
          color: rgb(1, 1, 1),
        })
      })
      cursor -= TABLE_HEADER_H
    }
    drawTableHeader()

    table.rows.forEach((row, rowIndex) => {
      const cells = table.columns.map((_, index) => toWinAnsiSafe(row[index] ?? ''))
      const wrapped = cells.map((cell, index) =>
        wrapText(cell, fonts.regular, TABLE_SIZE, (colWidths[index] ?? 80) - 8),
      )
      const offsets = wrapped.map(() => 0)
      for (;;) {
        const remaining = Math.max(
          1,
          ...wrapped.map((lines, index) => lines.length - (offsets[index] ?? 0)),
        )
        if (wrapped.every((lines, index) => (offsets[index] ?? 0) >= lines.length)) break
        const available = cursor - CONTENT_BOTTOM
        const maxLinesFit = Math.floor((available - 5) / TABLE_LEADING)
        if (maxLinesFit <= 0) {
          newPage()
          drawTableHeader()
          continue
        }
        const linesThisChunk = Math.min(remaining, maxLinesFit)
        const chunkH = Math.max(13, linesThisChunk * TABLE_LEADING + 5)
        page.drawRectangle({
          x: MARGIN,
          y: cursor - chunkH,
          width: CONTENT_W,
          height: chunkH,
          color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : rowAlt,
          borderWidth: 0.4,
          borderColor: border,
        })
        wrapped.forEach((lines, colIndex) => {
          const start = offsets[colIndex] ?? 0
          lines.slice(start, start + linesThisChunk).forEach((line, lineIndex) => {
            page.drawText(line, {
              x: (colX[colIndex] ?? MARGIN) + 4,
              y: cursor - 9 - lineIndex * TABLE_LEADING,
              size: TABLE_SIZE,
              font: fonts.regular,
              color: ink,
            })
          })
          offsets[colIndex] = start + linesThisChunk
        })
        colX.forEach((x) => {
          if (x === MARGIN) return
          page.drawRectangle({ x, y: cursor - chunkH, width: 0.4, height: chunkH, color: border })
        })
        cursor -= chunkH
        if (wrapped.every((lines, index) => (offsets[index] ?? 0) >= lines.length)) break
        newPage()
        drawTableHeader()
      }
    })
    cursor -= 8
  })

  // Rodapé (deferido até conhecer o total de páginas).
  // O barcode (imagem) fica ONLY na primeira página, no cabeçalho.
  // Aqui vai apenas o código em texto, em todas as páginas, para rastreabilidade.
  const pages = doc.getPages()
  const mutedFooter = muted

  pages.forEach((item, index) => {
    item.drawRectangle({ x: MARGIN, y: 50, width: CONTENT_W, height: 0.6, color: border })
    item.drawText(toWinAnsiSafe(trackingCode), {
      x: PAGE_W - MARGIN - fonts.bold.widthOfTextAtSize(trackingCode, 6),
      y: 18,
      size: 6,
      font: fonts.bold,
      color: mutedFooter,
    })
    item.drawText('Gerado localmente - AurumBit Portal', {
      x: MARGIN,
      y: 18,
      size: 6.5,
      font: fonts.regular,
      color: mutedFooter,
    })
    const pageLabel = `Pagina ${index + 1} de ${pages.length}`
    const labelWidth = fonts.regular.widthOfTextAtSize(pageLabel, 6.5)
    item.drawText(pageLabel, {
      x: PAGE_W / 2 - labelWidth / 2,
      y: 18,
      size: 6.5,
      font: fonts.regular,
      color: mutedFooter,
    })
  })

  const bytes = await doc.save()
  return { bytes: new Uint8Array(bytes), trackingCode, pageCount: pages.length }
}
