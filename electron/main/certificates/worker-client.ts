import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { WorkerParseResult } from '../workers/pfx-worker'
import { logger } from '../logger'

export function parsePfxFilesInWorker(
  files: Array<{ filePath: string; password: string }>,
  onProgress?: (completed: number, total: number) => void,
): Promise<WorkerParseResult[]> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(path.join(__dirname, 'pfx-worker.cjs'), {
        workerData: { files },
      })
    } catch (error) {
      reject(error)
      return
    }
    const timeout = setTimeout(() => {
      void worker.terminate()
      reject(new Error('Tempo esgotado ao ler os PFX em segundo plano'))
    }, 120_000)
    worker.on('message', (message: { type?: string; results?: WorkerParseResult[]; index?: number; total?: number }) => {
      if (message.type === 'progress' && typeof message.index === 'number') {
        onProgress?.(message.index + 1, message.total ?? files.length)
      }
      if (message.type === 'result' && message.results) {
        clearTimeout(timeout)
        void worker.terminate()
        resolve(message.results)
      }
    })
    worker.on('error', (error) => {
      clearTimeout(timeout)
      logger.warn('pfx.worker.failed', { message: error.message })
      reject(error)
    })
    worker.on('exit', (code) => {
      if (code !== 0) {
        clearTimeout(timeout)
        logger.warn('pfx.worker.exit', { code })
      }
    })
  })
}
