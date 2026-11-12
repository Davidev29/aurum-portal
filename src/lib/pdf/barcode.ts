'use client'

/**
 * Código de barras Code128 elegante via `bwip-js` (offline, sem servidor).
 *
 * - Node (testes): `toBuffer` → PNG direto.
 * - Navegador/Electron (renderer): `toCanvas` → canvas → PNG data URL,
 *   já que o build de navegador só expõe canvas.
 * Retorna os bytes PNG prontos para `pdf-lib.embedPng`.
 *
 * Os acessos ao DOM usam `globalThis` (sem tipos de DOM) para que o módulo
 * também compile no `tsconfig.electron.json` — onde os testes o importam
 * sem a lib `dom` (que conflitaria com os tipos Buffer/BufferSource do Node).
 */
export async function generateBarcodePngBytes(text: string): Promise<Uint8Array> {
  const mod = (await import('bwip-js')) as unknown as Record<string, unknown>
  const bwipjs = (mod.default ?? mod) as Record<string, unknown>

  const options = {
    bcid: 'code128',
    text,
    scale: 2,
    height: 12,
    includetext: false,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
    paddingwidth: 10,
    paddingheight: 0,
    monochrome: true,
  }

  const toBuffer = bwipjs.toBuffer as
    ((opts: typeof options) => Promise<Uint8Array | unknown>) | undefined
  if (typeof toBuffer === 'function') {
    try {
      const bytes = await toBuffer.call(bwipjs, options)
      return new Uint8Array(bytes as Uint8Array)
    } catch {
      // segue para o caminho de canvas quando disponível
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toCanvas = bwipjs.toCanvas as ((canvas: any, opts: typeof options) => unknown) | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const winDocument = (globalThis as any).document
  if (typeof toCanvas !== 'function' || !winDocument) {
    throw new Error('Suporte a código de barras indisponível neste ambiente.')
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canvas = winDocument.createElement('canvas') as any
  toCanvas.call(bwipjs, canvas, options)
  const dataUrl = canvas.toDataURL('image/png') as string
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  // atob via globalThis: disponível no renderer e no Node >= 16; cast evita
  // depender da lib `dom` no tsconfig do Electron.
  const atobFn = (globalThis as unknown as { atob?: (value: string) => string }).atob
  if (typeof atobFn !== 'function') {
    throw new Error('Suporte a atob indisponível neste ambiente.')
  }
  const binary = atobFn(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
