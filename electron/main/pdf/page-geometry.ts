/**
 * Geometria única de página — fonte de verdade para a prévia (via IPC),
 * o frontend e o carimbo no PDF. Espelha EXATAMENTE o que o pdf.js usa
 * para renderizar (`view = cropBox ∩ mediaBox` + `/Rotate`), para que a
 * posição que o usuário desenha na tela seja a posição gravada no PDF.
 *
 * Toda a geometria de assinatura (resolveStampRect / resolveCustomStampRect /
 * stamp / incremental) DEVE usar estes helpers — nunca page.getSize(),
 * que ignora /Rotate, CropBox e a origem do MediaBox.
 */

/** Ângulo /Rotate normalizado para 0|90|180|270 (como o pdf.js faz). */
export function normalizeRotation(angle: number | null | undefined): 0 | 90 | 180 | 270 {
  const normalized = (((Math.round(angle ?? 0) % 360) + 360) % 360) as 0 | 90 | 180 | 270
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
}

export interface PageView {
  /** View efetiva em user space (cropBox ∩ mediaBox), canto inferior-esquerdo. */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Largura/altura NÃO rotacionadas da view (Wu, Hu). */
  width: number
  height: number
  /** /Rotate normalizado (0|90|180|270). */
  rotation: 0 | 90 | 180 | 270
  /** Dimensões como exibidas (após rotação), em pt. É o que o pdf.js renderiza. */
  displayWidth: number
  displayHeight: number
}

interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

interface PageLike {
  getMediaBox?: () => RectLike
  getCropBox?: () => RectLike
  getRotation?: () => { angle: number }
  /** Fallback para fakes antigos (testes): MediaBox 0,0 com o tamanho informado. */
  getSize?: () => { width: number; height: number }
}

function normalizeRect(box: RectLike): [number, number, number, number] {
  const { x, y, width, height } = box
  const x2 = x + width
  const y2 = y + height
  return [Math.min(x, x2), Math.min(y, y2), Math.max(x, x2), Math.max(y, y2)]
}

function intersect(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] | null {
  const x0 = Math.max(a[0], b[0])
  const y0 = Math.max(a[1], b[1])
  const x1 = Math.min(a[2], b[2])
  const y1 = Math.min(a[3], b[3])
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return [x0, y0, x1, y1]
}

/**
 * View da página como o pdf.js a enxerga: cropBox ∩ mediaBox (fallback
 * mediaBox), com rotação normalizada. Páginas inválidas/sem caixas caem
 * para getSize() (ou 595x842) para nunca quebrar o fluxo.
 */
export function getPageView(page: PageLike): PageView {
  let media: RectLike | null = null
  let crop: RectLike | null = null
  try {
    media = page.getMediaBox?.() ?? null
    crop = page.getCropBox?.() ?? media
  } catch {
    media = null
  }
  let x0: number
  let y0: number
  let x1: number
  let y1: number
  if (media) {
    const m = normalizeRect(media)
    const c = crop ? normalizeRect(crop) : m
    const view = intersect(c, m) ?? m
    ;[x0, y0, x1, y1] = view
  } else {
    const size = page.getSize?.() ?? { width: 595, height: 842 }
    x0 = 0
    y0 = 0
    x1 = size.width
    y1 = size.height
  }
  let rotation: 0 | 90 | 180 | 270 = 0
  try {
    rotation = normalizeRotation(page.getRotation?.().angle ?? 0)
  } catch {
    rotation = 0
  }
  const width = x1 - x0
  const height = y1 - y0
  const swapped = rotation === 90 || rotation === 270
  return {
    x0,
    y0,
    x1,
    y1,
    width,
    height,
    rotation,
    displayWidth: swapped ? height : width,
    displayHeight: swapped ? width : height,
  }
}

export interface UserStampRect {
  /** Canto inferior-esquerdo em user space (coordenadas absolutas de desenho). */
  x: number
  y: number
  /** Dimensões em user space (trocadas para /Rotate 90/270). */
  width: number
  height: number
}

/**
 * Converte um retângulo exibido (frações/pt na tela rotacionada, origem
 * SUPERIOR-esquerda) para user space (origem INFERIOR-esquerda).
 * dx/dyTop/dw/dh em pt da tela (display space).
 */
export function displayRectToUserRect(
  view: PageView,
  dx: number,
  dyTop: number,
  dw: number,
  dh: number,
): UserStampRect {
  const { x0, y0, x1, y1, rotation } = view
  switch (rotation) {
    case 90:
      return { x: x0 + dyTop, y: y0 + dx, width: dh, height: dw }
    case 180:
      return { x: x1 - dx - dw, y: y0 + dyTop, width: dw, height: dh }
    case 270:
      return { x: x1 - dyTop - dh, y: y1 - dx - dw, width: dh, height: dw }
    case 0:
    default:
      return { x: x0 + dx, y: y1 - dyTop - dh, width: dw, height: dh }
  }
}

/**
 * Matriz cm (a b c d e f) que mapeia o frame local do carimbo (dw x dh,
 * origem inferior-esquerda, conteúdo "em pé" como visto na tela) para
 * EXATAMENTE o user rect informado. Retorna null para /Rotate 0
 * (desenho absoluto, comportamento idêntico ao anterior).
 */
export function stampContentsMatrix(
  rotation: 0 | 90 | 180 | 270,
  rect: UserStampRect,
): [number, number, number, number, number, number] | null {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, rect.x + rect.width, rect.y]
    case 180:
      return [-1, 0, 0, -1, rect.x + rect.width, rect.y + rect.height]
    case 270:
      return [0, -1, 1, 0, rect.x, rect.y + rect.height]
    case 0:
    default:
      return null
  }
}

/**
 * Matriz cm RELATIVA ao Rect do widget — usada no caminho incremental:
 * o AP Form XObject tem BBox [0 0 rect.width rect.height] e o conteúdo
 * local do carimbo deve ser desenhado "em pé" preenchendo exatamente a
 * área do Rect. Mapeamento local→AP-local.
 */
export function stampContentsRelativeMatrix(
  rotation: 0 | 90 | 180 | 270,
  rect: UserStampRect,
): [number, number, number, number, number, number] | null {
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, rect.width, 0]
    case 180:
      return [-1, 0, 0, -1, rect.width, rect.height]
    case 270:
      return [0, -1, 1, 0, 0, rect.height]
    case 0:
    default:
      return null
  }
}

/** Dimensões do carimbo como exibido (frame local do desenho). */
export function displayStampSize(
  view: PageView,
  rect: UserStampRect,
): { width: number; height: number } {
  if (view.rotation === 90 || view.rotation === 270) {
    return { width: rect.height, height: rect.width }
  }
  return { width: rect.width, height: rect.height }
}
