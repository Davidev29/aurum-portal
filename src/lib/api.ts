import { APP_DISPLAY_NAME } from '@shared/constants'
import type { AurumBitPortalApi } from '@shared/contracts'

export function aurumBitPortal(): AurumBitPortalApi {
  if (typeof window === 'undefined' || !window.aurumBitPortal) {
    throw new Error(
      `O ${APP_DISPLAY_NAME} precisa estar sendo executado dentro do aplicativo desktop.`,
    )
  }
  return window.aurumBitPortal
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'Não foi possível concluir a operação.'
}

/** Código de erro do IPC (preload expõe `code`/`name`). */
export function errorCode(error: unknown): string | null {
  if (error instanceof Error) {
    const maybe = error as Error & { code?: string }
    if (typeof maybe.code === 'string' && maybe.code) return maybe.code
    if (error.name && error.name !== 'Error') return error.name
  }
  return null
}

/** true quando o erro indica que a sessão do PDF precisa ser recriada. */
export function isPdfSessionExpired(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'NOT_FOUND' || code === 'CONFLICT'
}
