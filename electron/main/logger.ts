import log from 'electron-log/main'
import path from 'node:path'
import { app } from 'electron'
import { redactRecord } from './security/redaction'

let initialized = false

export function initLogger(): void {
  if (initialized) return
  initialized = true
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.AURUMBIT_DEV_URL ? 'debug' : 'info'
  log.transports.file.maxSize = 10 * 1024 * 1024
  log.transports.file.resolvePathFn = () => path.join(app.getPath('logs'), 'aurumbit-portal.log')
  log.errorHandler.startCatching({
    showDialog: false,
    onError: ({ error }) => {
      log.error('uncaught', errorToast(error))
    },
  })
  log.info('logger.initialized', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  })
}

function errorToast(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack?.slice(0, 4000) }
  }
  return String(error)
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    log.info(message, meta ? redactRecord(meta) : '')
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    log.warn(message, meta ? redactRecord(meta) : '')
  },
  error(message: string, meta?: Record<string, unknown>): void {
    log.error(message, meta ? redactRecord(meta) : '')
  },
  debug(message: string, meta?: Record<string, unknown>): void {
    log.debug(message, meta ? redactRecord(meta) : '')
  },
  get path(): string {
    return path.join(app.getPath('logs'), 'aurumbit-portal.log')
  },
}
