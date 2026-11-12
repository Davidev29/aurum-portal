import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { PDFDocument, PDFImage } from 'pdf-lib'

/**
 * Selo ITI exibido no cabeçalho do carimbo de assinatura.
 *
 * O arquivo (`public/iti-certificacao.png`, cópia do selo ITI de `assets/`)
 * e empacotado junto com a UI (`out/`). A resolucao cobre desenvolvimento,
 * app empacotado (asar) e worker isolado — nunca lanca: sem o selo, o
 * carimbo e gerado apenas com texto + QR.
 */

export const ITI_SEAL_FILE = 'iti-certificacao.png'
/** Marca d'água da biometria (fundo transparente) exibida no carimbo. */
export const STAMP_WATERMARK_FILE = 'biometria-watermark.png'

const MAX_BYTES = 512 * 1024

function appRootCandidates(): string[] {
  const roots: string[] = []
  try {
    // Electron (processo principal); no worker isolado pode nao existir.
    const base =
      typeof __filename !== 'undefined' ? __filename : path.join(process.cwd(), 'stamp-logo.cjs')
    const electron = createRequire(base)('electron') as {
      app?: { getAppPath?: () => string }
    }
    const appPath = electron?.app?.getAppPath?.()
    if (appPath) roots.push(appPath)
  } catch {
    // fora do Electron: ignora
  }
  if (process.resourcesPath) roots.push(process.resourcesPath)
  roots.push(process.cwd())
  try {
    const here = __dirname
    roots.push(path.resolve(here, '..', '..'))
    roots.push(path.resolve(here, '..', '..', '..'))
  } catch {
    // __dirname indisponivel: ignora
  }
  return [...new Set(roots.filter(Boolean))]
}

/** Carrega os bytes de um PNG de asset do app (validados), cacheados por nome. */
const pngCache = new Map<string, Buffer | null>()

function loadPngAsset(fileName: string): Buffer | null {
  if (pngCache.has(fileName)) return pngCache.get(fileName)!
  let found: Buffer | null = null
  try {
    for (const root of appRootCandidates()) {
      for (const candidate of [
        path.join(root, 'out', fileName),
        path.join(root, 'public', fileName),
        path.join(root, fileName),
      ]) {
        try {
          if (!existsSync(candidate)) continue
          const bytes = readFileSync(candidate)
          if (bytes.length === 0 || bytes.length > MAX_BYTES) continue
          // PNG: assinatura de 8 bytes.
          if (
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a
          ) {
            found = bytes
            break
          }
        } catch {
          // tenta o proximo candidato
        }
      }
      if (found) break
    }
  } catch {
    found = null
  }
  pngCache.set(fileName, found)
  return found
}

let cached: Buffer | null | undefined

/** Carrega os bytes do selo ITI (validados como PNG), cacheados. */
export function loadItiSeal(): Buffer | null {
  if (cached !== undefined) return cached
  cached = loadPngAsset(ITI_SEAL_FILE)
  return cached
}

/**
 * Embute a marca d'água da biometria uma única vez por documento. Retorna
 * null quando o arquivo não está disponível — o carimbo continua válido sem
 * a imagem (o texto e o QR permanecem legíveis por cima do branco).
 */
export async function prepareStampWatermark(doc: PDFDocument): Promise<PDFImage | null> {
  const holder = doc as unknown as { __pvWatermark?: PDFImage | null }
  if (holder.__pvWatermark !== undefined) return holder.__pvWatermark
  const bytes = loadPngAsset(STAMP_WATERMARK_FILE)
  if (!bytes) {
    holder.__pvWatermark = null
    return null
  }
  try {
    const image = await doc.embedPng(bytes)
    holder.__pvWatermark = image
    return image
  } catch {
    holder.__pvWatermark = null
    return null
  }
}

/**
 * Embute o selo ITI uma unica vez por documento. Retorna null quando o
 * arquivo nao esta disponivel — o carimbo continua valido sem a imagem.
 */
export async function prepareItiSeal(doc: PDFDocument): Promise<PDFImage | null> {
  const holder = doc as unknown as { __pvSeal?: PDFImage | null }
  if (holder.__pvSeal !== undefined) return holder.__pvSeal
  const bytes = loadItiSeal()
  if (!bytes) {
    holder.__pvSeal = null
    return null
  }
  try {
    const image = await doc.embedPng(bytes)
    holder.__pvSeal = image
    return image
  } catch {
    holder.__pvSeal = null
    return null
  }
}
