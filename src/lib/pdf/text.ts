import type { PDFFont } from 'pdf-lib'

/**
 * Quebra de texto editorial para PDF (WinAnsi, sem dependências).
 * Palavras longas demais são cortadas por caracteres — sempre cabem.
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

export function truncateToWidth(
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

/**
 * pdf-lib usa WinAnsi: caracteres fora dessa tabela (ex.: emoji, alguns
 * símbolos) quebrariam a gravação. Normaliza o texto para o seguro.
 */
export function toWinAnsiSafe(text: string): string {
  return (
    text
      .replace(/[→]/g, '->')
      .replace(/[—]/g, '-')
      .replace(/[“]/g, '"')
      .replace(/[”]/g, '"')
      .replace(/[‘]/g, "'")
      .replace(/[’]/g, "'")
      .replace(/[•]/g, '-')
      // eslint-disable-next-line no-control-regex
      .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '')
  )
}
