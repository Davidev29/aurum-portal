import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ServiceRow } from '../db/schema'
import { isAllowedHost } from '../../../shared/network'
import { AppError } from '../errors'

const MAX_LOGO_BYTES = 1024 * 1024

function assertSafeSvg(svg: string): void {
  const forbidden = [
    /<script[\s>]/i,
    /<foreignObject[\s>]/i,
    /\son[a-z]+\s*=/i,
    /(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|javascript:|data:text\/html)/i,
    /@import/i,
    /url\(\s*["']?\s*(?:https?:|javascript:)/i,
    /<iframe[\s>]/i,
    /<object[\s>]/i,
    /<embed[\s>]/i,
  ]
  if (forbidden.some((pattern) => pattern.test(svg))) {
    throw new AppError(
      'VALIDATION',
      'SVG inseguro',
      'O SVG contem scripts, links externos ou elementos incorporados e nao pode ser usado.',
    )
  }
}

export function toDataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

export function sanitizeLogoBytes(
  bytes: Buffer,
  declaredMime: string | null,
  filename?: string,
): string {
  if (bytes.length === 0) throw new AppError('VALIDATION', 'Arquivo de logo vazio')
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new AppError('VALIDATION', 'Logo muito grande', 'Use uma imagem de ate 1 MB.')
  }
  const extension = filename ? path.extname(filename).toLowerCase() : ''
  const mime = (declaredMime ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const text = bytes.toString('utf8').trim()
  const isSvg =
    mime === 'image/svg+xml' ||
    extension === '.svg' ||
    (text.startsWith('<svg') && text.endsWith('</svg>'))

  if (isSvg) {
    if (bytes.length > 256 * 1024) {
      throw new AppError('VALIDATION', 'SVG muito grande', 'Use um SVG de ate 256 KB.')
    }
    assertSafeSvg(text)
    return toDataUrl('image/svg+xml', Buffer.from(text, 'utf8'))
  }
  if (isPng) return toDataUrl('image/png', bytes)
  if (isJpeg) return toDataUrl('image/jpeg', bytes)
  throw new AppError(
    'VALIDATION',
    'Formato de logo nao suportado',
    'Envie um arquivo PNG, JPEG ou SVG.',
  )
}

export async function readLogoFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath)
  return sanitizeLogoBytes(bytes, null, filePath)
}

async function downloadFavicon(url: URL, service: ServiceRow): Promise<string | null> {
  if (url.protocol !== 'https:') return null
  if (!isAllowedHost(url.hostname, service.allowedDomains)) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'image/png,image/jpeg,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,*/*;q=0.1',
        'user-agent': 'AurumBitPortal/0.1 (+local favicon cache)',
      },
    })
    if (!response.ok) return null
    const finalUrl = new URL(response.url)
    if (!isAllowedHost(finalUrl.hostname, service.allowedDomains)) return null
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length > MAX_LOGO_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    return sanitizeLogoBytes(bytes, response.headers.get('content-type'), finalUrl.pathname)
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchServiceFavicon(service: ServiceRow): Promise<string> {
  const base = new URL(service.baseUrl)
  const candidates = [
    new URL('/favicon.ico', base.origin),
    new URL('/favicon.png', base.origin),
    new URL('/apple-touch-icon.png', base.origin),
  ]
  for (const candidate of candidates) {
    const result = await downloadFavicon(candidate, service)
    if (result) return result
  }
  throw new AppError(
    'NOT_FOUND',
    'Nenhum favicon encontrado',
    'Nao foi possivel obter um favicon deste servico. Envie uma imagem manualmente.',
  )
}
