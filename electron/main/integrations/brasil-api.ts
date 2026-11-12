import { onlyDigits } from '../../../shared/validation'
import type { CnpjLookupResult } from '../../../shared/types'

export type BrasilApiCompanyData = CnpjLookupResult

const USER_AGENT = 'AurumBit Portal/0.1 (desktop)'
const ENDPOINT = 'https://brasilapi.com.br/api/cnpj/v1'
const MAX_BODY_BYTES = 64 * 1024
const TIMEOUT_MS = 12_000

/** Extrai inscrição estadual/municipal de formatos variados da Brasil API. */
function parseRegistration(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string' || typeof item === 'number') return String(item).trim()
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          const nested = record.inscricao ?? record.numero ?? record.value
          if (typeof nested === 'string' || typeof nested === 'number') return String(nested).trim()
        }
        return ''
      })
      .filter(Boolean)
    return parts.length > 0 ? [...new Set(parts)].join(', ') : null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nested = record.inscricao ?? record.numero ?? record.value
    if (typeof nested === 'string' || typeof nested === 'number') return String(nested).trim()
  }
  return null
}

/**
 * Consulta publica de CNPJ (brasilapi.com.br), usado apenas para preencher
 * a razao social de um cliente a partir de um certificado CNPJ e os dados do
 * escritório (razão social, nome fantasia, inscrições municipal e estadual)
 * na tela de configurações.
 *
 * Privacidade: DESABILITADO por padrao. O chamador so pode acionar esta
 * funcao quando o operador ativou explicitamente o setting
 * `externalCnpjLookup`; sem ele, nenhum CNPJ sai da estacao.
 */
export async function lookupCompanyByCnpj(
  cnpj: string,
  options: { enabled?: boolean } = {},
): Promise<BrasilApiCompanyData | null> {
  if (options.enabled !== true) return null
  const document = onlyDigits(cnpj)
  if (document.length !== 14) return null
  try {
    const response = await fetch(`${ENDPOINT}/${document}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return null
    const data = await readCappedJson(response, MAX_BODY_BYTES)
    if (!data) return null
    const name =
      typeof data.razao_social === 'string' && data.razao_social.trim()
        ? data.razao_social.trim()
        : typeof data.nome_fantasia === 'string' && data.nome_fantasia.trim()
          ? data.nome_fantasia.trim()
          : null
    const tradeName =
      typeof data.nome_fantasia === 'string' && data.nome_fantasia.trim()
        ? data.nome_fantasia.trim()
        : null
    const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : null
    const phone =
      typeof data.ddd_telefone_1 === 'string' && data.ddd_telefone_1.trim()
        ? data.ddd_telefone_1.trim()
        : typeof data.telefone_1 === 'string' && data.telefone_1.trim()
          ? data.telefone_1.trim()
          : null
    const municipalRegistration = parseRegistration(
      data.inscricao_municipal ?? data.inscricaoMunicipal ?? data.municipalRegistration,
    )
    const stateRegistration = parseRegistration(
      data.inscricao_estadual ?? data.inscricaoEstadual ?? data.stateRegistration,
    )
    return { name, tradeName, email, phone, municipalRegistration, stateRegistration }
  } catch {
    return null
  }
}

/**
 * Le o corpo com limite de bytes: aborta se a resposta exceder `maxBytes`
 * (content-length declarado ou corpo real via stream). Evita exaustao de
 * memoria por um servidor malicioso ou comprometido.
 */
async function readCappedJson(
  response: Response,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value?.byteLength ?? 0
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      if (value) chunks.push(value)
    }
  } catch {
    return null
  }
  try {
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
    const parsed: unknown = JSON.parse(bytes.toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
