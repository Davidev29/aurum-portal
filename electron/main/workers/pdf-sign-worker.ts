import { parentPort, workerData } from 'node:worker_threads'

import { signPdfDocument } from '../pdf/sign'

/**
 *
 * Recebe PFX + senha + PDF via workerData (structured clone), assina e
 * devolve APENAS bytes do PDF assinado + metadados. Buffers com material
 * sensível são zerados antes do retorno. Nada é escrito em disco.
 */

export interface PdfSignWorkerInput {
  pfx: Buffer
  password: string
  pdfBytes: Buffer
  fileName: string
  certificate: {
    holderName: string
    document: string | null
    documentType: 'CPF' | 'CNPJ' | 'OTHER'
    issuerDn: string
    thumbprintSha256: string
    validTo: string
  }
  page: number
  xPct: number
  yPct: number
  size: 'small' | 'medium' | 'large'
  widthPct?: number
  heightPct?: number
  /** @deprecated localizacao removida do carimbo; ignorado. */
  location?: string | null
  reason?: string
  tsaUrl: string
}

export type PdfSignWorkerResult =
  | {
      type: 'result'
      ok: true
      pdf: Buffer
      sha256: string
      thumbprint: string
      tsaHost: string
      signedAt: string
    }
  | { type: 'result'; ok: false; message: string }

async function run(): Promise<void> {
  const input = (workerData ?? {}) as PdfSignWorkerInput
  // Entradas mínimas — falha rápida e sem vazar conteúdo.
  if (!input.pfx?.length || !input.pdfBytes?.length || !input.password || !input.certificate) {
    parentPort?.postMessage({
      type: 'result',
      ok: false,
      message: 'Dados de assinatura incompletos',
    } satisfies PdfSignWorkerResult)
    return
  }

  try {
    const result = await signPdfDocument({
      fileName: input.fileName,
      pdfBytes: input.pdfBytes,
      certificate: {
        pfx: input.pfx,
        password: input.password,
        holderName: input.certificate.holderName,
        document: input.certificate.document,
        documentType: input.certificate.documentType,
        issuerDn: input.certificate.issuerDn,
        thumbprintSha256: input.certificate.thumbprintSha256,
        validTo: input.certificate.validTo,
      },
      page: input.page,
      xPct: input.xPct,
      yPct: input.yPct,
      size: input.size,
      widthPct: input.widthPct,
      heightPct: input.heightPct,
      tsaUrl: input.tsaUrl,
    })
    parentPort?.postMessage({
      type: 'result',
      ok: true,
      pdf: result.pdf,
      sha256: result.sha256,
      thumbprint: result.thumbprint,
      tsaHost: result.tsaHost,
      signedAt: result.signedAt,
    } satisfies PdfSignWorkerResult)
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 300) : 'Falha desconhecida ao assinar o PDF'
    parentPort?.postMessage({ type: 'result', ok: false, message } satisfies PdfSignWorkerResult)
  } finally {
    // Zeroiza material sensível independentemente do resultado.
    input.pfx?.fill?.(0)
    input.pdfBytes?.fill?.(0)
  }
}

void run()
