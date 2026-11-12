import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { logger } from '../logger'
import type { PdfSignWorkerInput, PdfSignWorkerResult } from '../workers/pdf-sign-worker'

export interface SignWorkerOutput {
  pdf: Buffer
  sha256: string
  thumbprint: string
  tsaHost: string
  signedAt: string
}

const WORKER_TIMEOUT_MS = 120_000

/**
 * Executa a assinatura PAdES-B-T em worker isolado.
 * O chamador permanece com as referências ao PFX; aqui apenas despachamos.
 */
export function signPdfInWorker(payload: PdfSignWorkerInput): Promise<SignWorkerOutput> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(path.join(__dirname, 'pdf-sign-worker.cjs'), { workerData: payload })
    } catch (error) {
      reject(error)
      return
    }
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Tempo esgotado ao assinar o PDF em segundo plano'))
    }, WORKER_TIMEOUT_MS)

    worker.once('message', (message: PdfSignWorkerResult) => {
      clearTimeout(timeout)
      void worker.terminate()
      if (message?.type !== 'result') {
        reject(new Error('Resposta invalida do assinador PDF'))
        return
      }
      if (!message.ok) {
        reject(new Error(message.message))
        return
      }
      resolve({
        pdf: message.pdf,
        sha256: message.sha256,
        thumbprint: message.thumbprint,
        tsaHost: message.tsaHost,
        signedAt: message.signedAt,
      })
    })
    worker.once('error', (error) => {
      clearTimeout(timeout)
      logger.warn('pdf.sign_worker_failed', { message: error.message })
      reject(error)
    })
    worker.once('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout)
        logger.warn('pdf.sign_worker_exit', { code })
        reject(new Error('O assinador PDF encerrou inesperadamente'))
      }
    })
  })
}
