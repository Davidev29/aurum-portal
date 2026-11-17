import { parseHttpUrl } from '../../../shared/network'

const SENSITIVE_QUERY =
  /^(?:authorization_id|state|code|token|access_token|id_token|refresh_token|ticket|session|sessionid|key|secret|password|senha|cpf|cnpj|email|doc|documento)$/i
const SENSITIVE_KEY =
  /(pass|senha|secret|token|pfx|p12|private.?key|authorization|cookie|credential|\bpin\b)/i

export function redactUrl(input: string | URL): string {
  try {
    const parsed = typeof input === 'string' ? parseHttpUrl(input) : new URL(input.toString())
    if (!parsed) {
      // Fallback minimo para URLs que parseHttpUrl rejeitou. Se parsearem
      // cruas (ex.: https com credenciais, que recusamos por seguranca),
      // expoem apenas esquema, marcador de credencial e host — nunca o
      // caminho nem a query (podem carregar segredos).
      try {
        const raw = new URL(String(input))
        // Sem host não há como saber onde começa o conteúdo: desiste limpo.
        if (!raw.host) return '[invalid-url]'
        const auth = raw.username || raw.password ? '[REDACTED]@' : ''
        return `${raw.protocol}//${auth}${raw.host}`
      } catch {
        return '[invalid-url]'
      }
    }
    const url = new URL(parsed.toString())
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    if (url.username) url.username = '[REDACTED]'
    if (url.password) url.password = '[REDACTED]'
    return url.toString()
  } catch {
    return '[invalid-url]'
  }
}

export function redactString(value: string): string {
  if (/^-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----$/s.test(value)) {
    return '[REDACTED-PEM]'
  }
  // PEM embutido no meio de um texto/erro também sai do log.
  const pem = value.replace(
    /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
    '[REDACTED-PEM]',
  )
  if (pem !== value) return pem
  if (value.length > 4096 && /^[A-Za-z0-9+/=\r\n]+$/.test(value)) return '[REDACTED-BLOB]'
  return value
}

export function redactRecord(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 6) return { truncated: true }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = '[REDACTED]'
      continue
    }
    result[key] = redactValue(value, depth + 1)
  }
  return result
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return '[truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message).slice(0, 1000) }
  }
  if (typeof value === 'object') return redactRecord(value as Record<string, unknown>, depth + 1)
  return String(value)
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function safeErrorForAudit(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
        .replace(/(password|senha|pfx|secret|token)=\S+/gi, '$1=[REDACTED]')
        .slice(0, 1000),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 1000) }
}
