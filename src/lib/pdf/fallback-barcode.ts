import { rgb, type PDFPage, type RGB } from 'pdf-lib'

/**
 * Barcode Code128 *figurativo*, desenhado vetorialmente (retângulos) a partir
 * de um hash determinístico do código de rastreio.
 *
 * Usado quando a geração do barcode real (bwip-js) falha — garante que TODO
 * relatório do sistema exibe um código de barras, mesmo que apenas
 * representativo. O padrão é sempre o mesmo para o mesmo código, formando
 * guardas de início/fim reconhecíveis como "código de barras".
 */

/** Largura (em módulos) de cada barra, alternando barra/espaço. */
export function fallbackBarcodeRuns(text: string): number[] {
  // FNV-1a do texto + contador LCG para a sequência de módulos.
  let state = 0x811c9dc5 >>> 0
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  // Guarda de início (Code128 começa com barra larga / estreita).
  const runs: number[] = [2, 1, 2, 1, 1, 2]
  while (runs.length < 52) {
    runs.push((next() % 3) + 1)
  }
  // Guarda de fim.
  runs.push(2, 1, 1, 2, 3, 1)
  return runs
}

/**
 * Desenha o barcode figurativo dentro do retângulo (x, y, width, height).
 * Retorna a largura efetivamente utilizada (sempre igual a `width`).
 */
export function drawFallbackBarcode(
  page: PDFPage,
  text: string,
  options: { x: number; y: number; width: number; height: number; color?: RGB },
): void {
  const { x, y, width, height } = options
  const barColor = options.color ?? rgb(0, 0, 0)
  const runs = fallbackBarcodeRuns(text)
  const totalModules = runs.reduce((sum, run) => sum + run, 0)
  const moduleWidth = width / totalModules
  let cursor = x
  let filled = true // Code128 começa com barra (preto)
  for (const run of runs) {
    const runWidth = run * moduleWidth
    if (filled) {
      page.drawRectangle({ x: cursor, y, width: runWidth, height, color: barColor })
    }
    cursor += runWidth
    filled = !filled
  }
}
