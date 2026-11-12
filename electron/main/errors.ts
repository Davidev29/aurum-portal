import { ZodError } from 'zod'

export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'CERTIFICATE_INVALID'
  | 'CERTIFICATE_MISSING'
  | 'CERTIFICATE_NOT_INSTALLED'
  | 'CERTIFICATE_EXPIRED'
  | 'CREDENTIAL_MISSING'
  | 'SESSION_LIMIT'
  | 'VAULT_UNAVAILABLE'
  | 'INTERNAL'

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly userMessage = message,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof ZodError) {
    const message = error.issues
      .map((issue) => issue.message)
      .filter(Boolean)
      .join('; ')
    const userMessage = message || 'Dados invalidos. Verifique os campos e tente novamente.'
    return new AppError('VALIDATION', userMessage, userMessage)
  }
  // Erros de domínio do módulo PDF (CmsError/TsaError/SignPdfError ou
  // mensagens equivalentes vindas do worker) devem ser fail-closed com
  // mensagem útil, não INTERNAL genérico.
  const name = error instanceof Error ? error.name : ''
  const rawMessage = error instanceof Error ? error.message : 'Erro inesperado'
  const message = rawMessage.slice(0, 500)
  if (name === 'CmsError' || name === 'TsaError' || name === 'SignPdfError') {
    if (name === 'TsaError' || /tsa|carimbo de tempo|TimeStamp/i.test(message)) {
      return new AppError('UNAVAILABLE', message, message)
    }
    if (/senha do pfx|pfx.*corrompid|nao contem.*chave|nao contem certificado|associar o certificado/i.test(message)) {
      return new AppError('CERTIFICATE_INVALID', message, message)
    }
    if (/vencido/i.test(message)) {
      return new AppError('CERTIFICATE_EXPIRED', message, message)
    }
    return new AppError('VALIDATION', message, message)
  }
  // Worker devolve apenas string; mapear por conteúdo para não perder contexto.
  if (/tsa|carimbo de tempo|TimeStamp|12 s/i.test(message)) {
    return new AppError('UNAVAILABLE', message, message)
  }
  if (/senha do pfx|pfx.*corrompid|chave privada rsa/i.test(message)) {
    return new AppError('CERTIFICATE_INVALID', message, message)
  }
  if (/certificado vencido/i.test(message)) {
    return new AppError('CERTIFICATE_EXPIRED', message, message)
  }
  if (/pdf protegido|pdf.*corrompid|nao foi possivel ler o pdf|pdf sem paginas|pagina.*fora do documento|posicao do carimbo|pdf vazio|50 mb/i.test(message)) {
    return new AppError('VALIDATION', message, message)
  }
  if (/tempo esgotado|encerrou inesperadamente|resposta invalida do assinador/i.test(message)) {
    return new AppError('UNAVAILABLE', message, message)
  }
  return new AppError('INTERNAL', message, 'Nao foi possivel concluir a operacao.')
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new AppError('NOT_FOUND', message)
  }
  return value
}
