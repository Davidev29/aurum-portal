import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { PDFDocument } from 'pdf-lib'
import { AppError } from '../errors'
import {
  SIGN_PDF_MAX_BYTES,
  SIGN_PDF_PREVIEW_TTL_MS,
  type PickedPdfFile,
} from '../../../shared/signature'
import { getPageView } from './page-geometry'

/**
 * Escolha de PDF no diálogo do SO + cache em memória para o fluxo de
 * pré-visualização e assinatura. Sem escrita em disco; o arquivo original
 * nunca é alterado.
 */

export interface CachedPdf {
  path: string
  sha256: string
  sizeBytes: number
  mtimeMs: number
  buffer: Buffer
  pageCount: number
  pages: PickedPdfFile['pages']
  expiresAt: number
}

const cache = new Map<string, CachedPdf>()
const MAX_CACHE_ENTRIES = 3

function wipeEntry(entry: CachedPdf | undefined): void {
  if (!entry) return
  try {
    entry.buffer.fill(0)
  } catch {
    // Buffer pode já ter sido liberado; falha de wipe não bloqueia.
  }
}

function evictExpired(): void {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      wipeEntry(entry)
      cache.delete(key)
    }
  }
}

function evictIfFull(): void {
  evictExpired()
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (!oldest) break
    wipeEntry(cache.get(oldest))
    cache.delete(oldest)
  }
}

export async function inspectPdf(buffer: Buffer): Promise<{ pageCount: number; pages: PickedPdfFile['pages'] }> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    if (message.includes('encrypt')) {
      throw new AppError('VALIDATION', 'PDF protegido por senha nao e suportado')
    }
    throw new AppError('VALIDATION', 'Nao foi possivel ler o PDF (arquivo corrompido ou invalido)')
  }
  const pages = doc.getPages()
  if (pages.length === 0) {
    throw new AppError('VALIDATION', 'PDF sem paginas')
  }
  return {
    pageCount: pages.length,
    // Geometria EXIBIDA (cropBox∩mediaBox + /Rotate), identica ao que o
    // pdf.js renderiza na previa — o frontend e o backend usam a mesma base.
    pages: pages.map((page) => {
      const view = getPageView(page)
      return {
        width: view.displayWidth,
        height: view.displayHeight,
        rotation: view.rotation,
        viewBox: { x: view.x0, y: view.y0, width: view.width, height: view.height },
      }
    }),
  }
}

export async function pickPdfFile(parent?: BrowserWindow): Promise<PickedPdfFile> {
  const options: OpenDialogOptions = {
    title: 'Escolher PDF para assinar',
    properties: ['openFile'],
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
  }
  // Janela pai: diálogo modal, anexado ao app — abre imediatamente e não
  // fica atrás da janela principal (antes ia como diálogo solto do sistema).
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) {
    throw new AppError('VALIDATION', 'Selecao de PDF cancelada')
  }
  const filePath = result.filePaths[0] as string
  const info = await stat(filePath).catch(() => null)
  if (!info || !info.isFile() || info.size === 0) {
    throw new AppError('VALIDATION', 'Arquivo invalido ou vazio')
  }
  if (info.size > SIGN_PDF_MAX_BYTES) {
    throw new AppError('VALIDATION', 'PDF maior que 50 MB nao e suportado')
  }
  const buffer = await readFile(filePath)
  const sha256 = createHash('sha256').update(buffer).digest('hex').toUpperCase()
  const { pageCount, pages } = await inspectPdf(buffer)

  const token = randomUUID()
  evictIfFull()
  const expiresAt = Date.now() + SIGN_PDF_PREVIEW_TTL_MS
  cache.set(token, {
    path: filePath,
    sha256,
    sizeBytes: buffer.length,
    mtimeMs: info.mtimeMs,
    buffer,
    pageCount,
    pages,
    expiresAt,
  })
  return {
    token,
    fileName: path.basename(filePath),
    sizeBytes: buffer.length,
    sha256,
    pageCount,
    pages,
    expiresAt: new Date(expiresAt).toISOString(),
  }
}

/** Retorna a entrada cacheada, revalidando validade e integridade do arquivo. */
export async function getCachedPdf(token: string): Promise<CachedPdf> {
  evictExpired()
  const entry = cache.get(token)
  if (!entry) {
    throw new AppError('NOT_FOUND', 'Sessao do documento expirou — escolha o PDF novamente')
  }
  const info = await stat(entry.path).catch(() => null)
  if (!info || info.mtimeMs !== entry.mtimeMs || info.size !== entry.sizeBytes) {
    wipeEntry(entry)
    cache.delete(token)
    throw new AppError('CONFLICT', 'O arquivo mudou desde a previa — escolha o PDF novamente')
  }
  // Revalidação integral: recalcula SHA-256 do arquivo atual e compara com o
  // registrado no pick (protege contra TOCTOU com mesmo mtime/size).
  const current = await readFile(entry.path).catch(() => null)
  if (!current) {
    wipeEntry(entry)
    cache.delete(token)
    throw new AppError('CONFLICT', 'O arquivo mudou desde a previa — escolha o PDF novamente')
  }
  const currentSha = createHash('sha256').update(current).digest('hex').toUpperCase()
  if (currentSha !== entry.sha256) {
    wipeEntry(entry)
    cache.delete(token)
    throw new AppError('CONFLICT', 'O arquivo mudou desde a previa — escolha o PDF novamente')
  }
  return entry
}

/** Remove a entrada do cache (ex.: após assinatura bem-sucedida ou cancelamento). */
export function releaseCachedPdf(token: string): void {
  const entry = cache.get(token)
  if (!entry) return
  wipeEntry(entry)
  cache.delete(token)
}
