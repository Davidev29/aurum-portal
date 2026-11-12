import type { Certificate, CertificateRenewalEntry } from './types'

export interface MinimalCertificateForRenewal {
  id: string
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  validFrom: string
  validTo: string
  createdAt: string
}

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '')
}

/**
 * Normaliza uma data para o início do dia (00:00:00.000) em UTC.
 * Isso evita que horas/minutos/segundos distorcam o cálculo de dias corridos
 * entre vencimento e "agora" (ex.: certificado que vence hoje não aparece como
 * "0 dias" ou "vencido" apenas porque o relógio já passou da hora do vencimento).
 */
export function startOfDayUtc(date: Date): Date {
  const d = new Date(date)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

/**
 * Diferença em dias corridos (UTC) entre duas datas ISO.
 * Arredonda para o inteiro mais próximo; retorna 0 se alguma data for inválida.
 */
export function daysBetweenUtc(fromIso: string, toIso: string): number {
  const from = startOfDayUtc(new Date(fromIso)).getTime()
  const to = startOfDayUtc(new Date(toIso)).getTime()
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0
  return Math.round((to - from) / 86_400_000)
}

/**
 * Chave de agrupamento para historico de renovacao.
 * Prioriza CPF/CNPJ (somente digitos). Sem documento valido, usa
 * titular + tipo para nao misturar titulares distintos.
 */
export function renewalDocumentKey(certificate: MinimalCertificateForRenewal): string {
  const digits = onlyDigits(certificate.document)
  if (digits.length === 11 || digits.length === 14) return `doc:${digits}`
  const holder = (certificate.holderName ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (holder) return `holder:${certificate.documentType}:${holder}`
  return `id:${certificate.id}`
}

export function sortRenewalHistory<T extends MinimalCertificateForRenewal>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const from = new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime()
    if (from !== 0) return from
    const to = new Date(a.validTo).getTime() - new Date(b.validTo).getTime()
    if (to !== 0) return to
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })
}

/**
 * Reduz cada cadeia de renovação (mesmo CPF/CNPJ — ou mesmo titular quando não
 * há documento) a um único certificado: o ATUAL, ou seja, o último da cadeia
 * após a ordenação cronológica (maior validFrom/validTo/createdAt).
 *
 * Os certificados históricos já renovados são "arquivados" pela renovação e
 * não devem poluir listagens — eles continuam acessíveis no histórico de
 * renovação do modal de detalhes.
 */
export function collapseToCurrentCertificates<T extends MinimalCertificateForRenewal>(
  items: T[],
): T[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = renewalDocumentKey(item)
    const group = groups.get(key)
    if (group) {
      group.push(item)
    } else {
      groups.set(key, [item])
    }
  }
  const current: T[] = []
  for (const group of groups.values()) {
    const ordered = sortRenewalHistory(group)
    const tip = ordered[ordered.length - 1]
    if (tip) current.push(tip)
  }
  return current
}

/** Filtra e ordena apenas os certificados do mesmo documento/titular. */
export function renewalHistoryFor<T extends MinimalCertificateForRenewal>(
  certificate: MinimalCertificateForRenewal,
  all: T[],
): T[] {
  const key = renewalDocumentKey(certificate)
  return sortRenewalHistory(all.filter((item) => renewalDocumentKey(item) === key))
}

export interface RenewalInfo<
  T extends MinimalCertificateForRenewal = MinimalCertificateForRenewal,
> {
  history: T[]
  index: number
  previous: T | null
  next: T | null
  /** Existe certificado mais novo E ainda valido (validTo no futuro). */
  isRenewed: boolean
  /** Anterior vencido/expirando com renovacao valida. Tambem true quando ja ha sucessor valido. */
  hasNewerValid: boolean
  renewedBy: T | null
  hasHistory: boolean
}

export function computeRenewalInfo<T extends MinimalCertificateForRenewal>(
  certificate: T,
  all: T[],
  now: Date = new Date(),
): RenewalInfo<T> {
  const history = renewalHistoryFor(certificate, all)
  const index = history.findIndex((item) => item.id === certificate.id)
  const position = index >= 0 ? index : -1
  const next = position >= 0 ? (history[position + 1] ?? null) : null
  const previous = position > 0 ? (history[position - 1] ?? null) : null
  const currentValidToMs = new Date(certificate.validTo).getTime()
  // Sucessor valido = mais novo, com validTo posterior e ainda no futuro.
  // Se houver mais de um sucessor valido, o primeiro (imediato) e o renewedBy.
  const newerValid = sortRenewalHistory(
    history.filter((item) => {
      if (item.id === certificate.id) return false
      const itemValidTo = new Date(item.validTo).getTime()
      return itemValidTo > currentValidToMs && itemValidTo > now.getTime()
    }),
  )[0]
  const isRenewed = Boolean(newerValid)
  return {
    history,
    index: position,
    previous,
    next,
    isRenewed,
    hasNewerValid: Boolean(newerValid),
    renewedBy: newerValid ?? null,
    hasHistory: history.length > 1,
  }
}

export const EXPIRY_WARNING_DAYS = 30

export type ExpiryTone = 'danger' | 'warning' | 'success' | 'muted'

export interface ExpiryInfo {
  daysUntilExpiry: number
  expired: boolean
  expiring: boolean
  tone: ExpiryTone
  label: string
  detail: string
}

export function getExpiryInfo(
  certificate: Pick<Certificate, 'validTo' | 'daysUntilExpiry'>,
  now: Date = new Date(),
): ExpiryInfo {
  const validToMs = new Date(certificate.validTo).getTime()
  const days =
    Number.isFinite(validToMs) && !Number.isNaN(validToMs)
      ? daysBetweenUtc(now.toISOString(), certificate.validTo)
      : certificate.daysUntilExpiry
  const expired = days < 0
  const expiring = !expired && days <= EXPIRY_WARNING_DAYS
  const tone: ExpiryTone = expired ? 'danger' : expiring ? 'warning' : 'success'
  const label = expired
    ? `Vencido há ${Math.abs(days)} dia(s)`
    : expiring
      ? `Vence em ${days} dia(s)`
      : `${days} dia(s) restantes`
  const detail = expired ? 'Certificado vencido' : expiring ? 'Renovação recomendada' : 'Em vigor'
  return { daysUntilExpiry: days, expired, expiring, tone, label, detail }
}

/**
 * Vencimento efetivo da CADEIA de renovação: o maior `validTo` entre todos os
 * certificados do mesmo documento/titular (incluindo o próprio e os sucessores,
 * mesmo que ainda não vigentes). É a data final do último certificado da cadeia —
 * exatamente o que a UI deve exibir como "validade" e usar para o alerta de
 * "a vencer" (30 dias antes dessa data).
 */
export function chainEffectiveValidTo<T extends MinimalCertificateForRenewal>(
  certificate: T,
  chain: T[],
): string {
  let maxMs = new Date(certificate.validTo).getTime()
  if (!Number.isFinite(maxMs)) maxMs = 0
  for (const item of chain) {
    const itemMs = new Date(item.validTo).getTime()
    if (Number.isFinite(itemMs) && itemMs > maxMs) maxMs = itemMs
  }
  return new Date(maxMs).toISOString()
}

/**
 * Calcula a expiração considerando o vencimento final da cadeia de renovação.
 *
 * `effectiveValidTo` é a validade efetiva da cadeia (ver `chainEffectiveValidTo`):
 * o `validTo` mais distante entre os certificados do mesmo documento. Assim um
 * certificado antigo já renovado não gera falso positivo de "a vencer", e a data
 * exibida reflete sempre o fim da validade do último certificado da cadeia —
 * mesmo que haja mais de um sucessor.
 */
export function getEffectiveExpiryInfo(
  certificate: Pick<Certificate, 'validTo' | 'daysUntilExpiry'>,
  effectiveValidTo: string | null | undefined,
  now: Date = new Date(),
): ExpiryInfo {
  const certificateValidToMs = new Date(certificate.validTo).getTime()
  const effectiveValidToMs = effectiveValidTo ? new Date(effectiveValidTo).getTime() : NaN
  const resolvedValidTo =
    Number.isFinite(effectiveValidToMs) && effectiveValidToMs > certificateValidToMs
      ? (effectiveValidTo as string)
      : certificate.validTo
  return getExpiryInfo({ ...certificate, validTo: resolvedValidTo }, now)
}

/**
 * Data que a UI deve exibir como "validade" de um certificado: o vencimento
 * efetivo da cadeia (fim da validade do último certificado válido conhecido),
 * nunca a data crua de um certificado antigo já renovado.
 */
export function certificateEffectiveValidToOf(certificate: {
  validTo: string
  effectiveValidTo?: string | null
}): string {
  const effective = certificate.effectiveValidTo
  if (effective && Number.isFinite(new Date(effective).getTime())) return effective
  return certificate.validTo
}

export function toRenewalEntry(
  certificate: Certificate,
  isCurrentId: string,
): CertificateRenewalEntry {
  return {
    id: certificate.id,
    label: certificate.label,
    holderName: certificate.holderName,
    document: certificate.document,
    documentType: certificate.documentType,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
    source: certificate.source,
    installed: certificate.installed,
    status: certificate.status,
    createdAt: certificate.createdAt,
    isCurrent: certificate.id === isCurrentId,
  }
}
