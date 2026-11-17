import { createHash } from 'node:crypto'
import {
  isAllowedHost,
  isGovernmentCertificateHost,
  normalizeHostname,
  parseHttpUrl,
} from '../../../shared/network'
import type { CertificateStatus } from '../../../shared/constants'
import { EXPIRY_WARNING_DAYS, startOfDayUtc } from '../../../shared/certificate-renewal'

export interface CertificateSelectionItem {
  id?: string
  data?: string | Buffer
  fingerprint?: string
  serialNumber?: string
  issuerName?: string
  subjectName?: string
}

export interface CertificateSelectionContext {
  sessionId: string
  clientId: string
  clientName: string
  certificateThumbprint: string
  certificateThumbprintSha1?: string
  certificateSerialHex?: string
  certificateSubjectName?: string
  certificateIssuerName?: string
  allowedDomains: string[]
  url: string
}

export interface CertificateSelectionDecision {
  kind: 'selected' | 'not-offered' | 'no-context' | 'host-not-allowed'
  certificate: CertificateSelectionItem | null
  offeredCount: number
  reason: string
}

export function extractFingerprintHex(value: string): string {
  if (!value) return ''
  const trimmed = value.trim()

  // Electron exposes fingerprints as "sha256/<base64>=" or "sha1/<base64>=".
  const slashIndex = trimmed.indexOf('/')
  if (slashIndex >= 0) {
    const encoded = trimmed.slice(slashIndex + 1).replace(/=+$/, '')
    try {
      const buffer = Buffer.from(encoded, 'base64')
      if (buffer.length === 32 || buffer.length === 20) {
        return buffer.toString('hex').toUpperCase()
      }
    } catch {
      // Fall through to the generic extractors below.
    }
  }

  // Handle colon/space/dash separated hex (e.g. "AB:CD:EF" or "AB CD EF").
  const compact = trimmed.replace(/[^a-fA-F0-9]/g, '')
  if (compact.length >= 32) {
    return compact.toUpperCase()
  }

  // Fallback: take the longest contiguous hex run.
  const runs = trimmed.match(/[a-fA-F0-9]{8,}/g) ?? []
  const best = runs.reduce(
    (current, candidate) => (candidate.length > current.length ? candidate : current),
    '',
  )
  return (best || compact).toUpperCase()
}

export function normalizeThumbprint(value: string): string {
  return extractFingerprintHex(value)
}

export function normalizeThumbprintSha256(value: string): string {
  return normalizeThumbprint(value).toLowerCase()
}

export function pemToDer(data: string): Buffer {
  const base64 = data
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')
  return Buffer.from(base64, 'base64')
}

export function certificateDataToDer(data: string | Buffer): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (data.includes('-----BEGIN CERTIFICATE-----')) return pemToDer(data)
  const trimmed = data.trim()
  // Electron entrega `data` como base64 do DER (na maioria dos casos). Porém,
  // alguns builds/entregas podem trazer string binária (latin1), onde bytes
  // >= 0x80 aparecem como caracteres e o alfabeto base64 não é válido.
  // Detectamos esse caso pelo formato: base64 puro é curto e sem caracteres
  // fora do alfabeto; binário contém bytes altos ou caracteres como ':'/'\n'.
  const looksLikeBase64 = /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && !/[\u0080-\uffff]/.test(trimmed)
  if (looksLikeBase64) {
    return Buffer.from(trimmed, 'base64')
  }
  // String binária / latin1: cada caractere é um byte.
  return Buffer.from(data, 'binary')
}

export function normalizeSerialHex(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/[^a-fA-F0-9]/g, '')
    .replace(/^0+(?=[0-9A-Fa-f]{2})/, '')
    .toUpperCase()
}

export function normalizeDnForMatch(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .split(',')
    .map((part) => {
      const cleaned = part.trim().toLowerCase().replace(/\s+/g, ' ')
      if (!cleaned) return ''
      const eqIndex = cleaned.indexOf('=')
      if (eqIndex < 0) return cleaned
      const key = cleaned.slice(0, eqIndex).trim()
      const val = cleaned.slice(eqIndex + 1).trim()
      return `${key}=${val}`
    })
    .filter(Boolean)
    .sort()
    .join(',')
}

export function dnEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const normalizedA = normalizeDnForMatch(a)
  const normalizedB = normalizeDnForMatch(b)
  return Boolean(normalizedA) && normalizedA === normalizedB
}

export function computeThumbprints(der: Buffer): { sha1: string; sha256: string } {
  return {
    sha1: createHash('sha1').update(der).digest('hex').toUpperCase(),
    sha256: createHash('sha256').update(der).digest('hex').toUpperCase(),
  }
}

export interface CertificateSelectionExpectation {
  sha256?: string
  sha1?: string
  serialHex?: string
  issuerName?: string
  subjectName?: string
}

function scoreCertificate(
  cert: CertificateSelectionItem,
  expected: CertificateSelectionExpectation,
): number {
  const expected256 = expected.sha256 ? normalizeThumbprint(expected.sha256).toLowerCase() : ''
  const expected1 = expected.sha1 ? normalizeThumbprint(expected.sha1).toLowerCase() : ''
  let best = 0

  if (cert.fingerprint) {
    const fingerprint = normalizeThumbprint(cert.fingerprint).toLowerCase()
    if (expected256 && fingerprint === expected256) best = Math.max(best, 100)
    if (expected1 && fingerprint === expected1) best = Math.max(best, 95)
  }

  if (cert.data) {
    try {
      const der = certificateDataToDer(cert.data)
      if (der.length > 10) {
        const hashes = computeThumbprints(der)
        if (expected256 && hashes.sha256.toLowerCase() === expected256) best = Math.max(best, 90)
        if (expected1 && hashes.sha1.toLowerCase() === expected1) best = Math.max(best, 85)
      }
    } catch {
      // Certificado malformado oferecido pela plataforma: ignora e tenta o próximo.
    }
  }

  const expectedSerial = normalizeSerialHex(expected.serialHex)
  if (expectedSerial && cert.serialNumber) {
    const offeredSerial = normalizeSerialHex(cert.serialNumber)
    if (offeredSerial && offeredSerial === expectedSerial) {
      const issuerMatch =
        !expected.issuerName || !cert.issuerName || dnEquals(cert.issuerName, expected.issuerName)
      best = Math.max(best, issuerMatch ? 70 : 40)
    }
  }

  if (!best && expected.subjectName && expected.issuerName && cert.subjectName && cert.issuerName) {
    if (
      dnEquals(cert.subjectName, expected.subjectName) &&
      dnEquals(cert.issuerName, expected.issuerName)
    ) {
      best = Math.max(best, 50)
    }
  }

  return best
}

export function selectCertificateByThumbprint(
  list: CertificateSelectionItem[],
  expectedThumbprintSha256: string,
  expectedThumbprintSha1?: string,
  expectationExtra?: Pick<
    CertificateSelectionExpectation,
    'serialHex' | 'issuerName' | 'subjectName'
  >,
): CertificateSelectionItem | null {
  const expected: CertificateSelectionExpectation = {
    sha256: expectedThumbprintSha256,
    sha1: expectedThumbprintSha1,
    serialHex: expectationExtra?.serialHex,
    issuerName: expectationExtra?.issuerName,
    subjectName: expectationExtra?.subjectName,
  }
  let chosen: CertificateSelectionItem | null = null
  let chosenScore = 0
  for (const cert of list) {
    const score = scoreCertificate(cert, expected)
    if (score > chosenScore) {
      chosen = cert
      chosenScore = score
      if (score >= 95) break
    }
  }
  // Somente correspondências de alta confiança entram no mTLS: fingerprint/
  // DER (85-100) ou serial+issuer (70). O match por sujeito+emissor (50)
  // NÃO é suficiente para seleção automática — um certificado renovado com
  // outra chave passaria como o "mesmo". Sem prova, cancela e pede vínculo
  // explícito (auditado como certificate.not_offered).
  return chosenScore >= 70 ? chosen : null
}

export function resolveCertificateSelection(
  context: CertificateSelectionContext | undefined,
  requestUrl: string,
  list: CertificateSelectionItem[],
  expectedSha1?: string,
): CertificateSelectionDecision {
  if (!context) {
    return {
      kind: 'no-context',
      certificate: null,
      offeredCount: list.length,
      reason: 'Nenhum contexto de sessao registrado para esta particao',
    }
  }

  // O Electron entrega o host no formato `host:porta` (sem esquema), o que
  // fazia `new URL()` interpretar o host inteiro como esquema customizado e
  // produzir hostname vazio. parseHttpUrl normaliza esse e outros formatos.
  const parsedUrl = parseHttpUrl(requestUrl)
  if (!parsedUrl) {
    return {
      kind: 'host-not-allowed',
      certificate: null,
      offeredCount: list.length,
      reason: 'URL de requisicao invalida',
    }
  }

  // Certificado de cliente so pode trafegar em HTTPS. HTTP nunca autentica
  // por mTLS; recusamos explicitamente em vez de aceitar em silencio.
  if (parsedUrl.protocol !== 'https:') {
    return {
      kind: 'host-not-allowed',
      certificate: null,
      offeredCount: list.length,
      reason: 'Autenticacao por certificado exige conexao HTTPS',
    }
  }

  const host = normalizeHostname(parsedUrl.hostname)

  // Injeção de certificado é restrita aos endpoints gov.br de identidade/
  // certificado + à allowlist explícita do serviço. Um portal gov.br
  // QUALQUER (mesmo um comprometido) não recebe o A1 do cliente.
  if (!isGovernmentCertificateHost(host) && !isAllowedHost(host, context.allowedDomains)) {
    return {
      kind: 'host-not-allowed',
      certificate: null,
      offeredCount: list.length,
      reason: `Host ${host} fora da allowlist do servico`,
    }
  }

  const sha1 = expectedSha1 ?? context.certificateThumbprintSha1
  const chosen = selectCertificateByThumbprint(list, context.certificateThumbprint, sha1, {
    serialHex: context.certificateSerialHex,
    issuerName: context.certificateIssuerName,
    subjectName: context.certificateSubjectName,
  })
  if (!chosen) {
    return {
      kind: 'not-offered',
      certificate: null,
      offeredCount: list.length,
      reason: 'O certificado da sessao nao foi oferecido pelo servidor',
    }
  }

  return {
    kind: 'selected',
    certificate: chosen,
    offeredCount: list.length,
    reason: 'Certificado do contexto selecionado explicitamente',
  }
}

export function daysUntil(dateIso: string, now = new Date()): number {
  const target = new Date(dateIso)
  if (Number.isNaN(target.getTime())) return 0
  const targetDay = startOfDayUtc(target).getTime()
  const nowDay = startOfDayUtc(now).getTime()
  const ms = targetDay - nowDay
  return Math.round(ms / 86_400_000)
}

export function computeCertificateStatus(input: {
  validTo: string
  source: 'pfx' | 'windows'
  installed: boolean
  usedToAuthenticate?: boolean
  chainIncomplete?: boolean
  now?: Date
}): CertificateStatus {
  const now = input.now ?? new Date()
  const days = daysUntil(input.validTo, now)
  if (days < 0) return 'expired'
  if (input.source === 'windows' && !input.installed) return 'missing_windows'
  if (input.chainIncomplete) return 'chain_incomplete'
  if (input.source === 'pfx' && !input.installed) return 'in_vault'
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring'
  return 'valid'
}

export function isCertificateUsable(status: CertificateStatus): boolean {
  return status === 'valid' || status === 'expiring' || status === 'in_vault'
}

export function normalizeDn(value: string): string {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key = '', ...rest] = part.split('=')
      return `${key.trim().toUpperCase()}=${rest.join('=').trim()}`
    })
    .join(',')
}

export function formatDn(
  attributes: Array<{ name?: string; shortName?: string; value?: string }>,
): string {
  return attributes
    .filter((attr) => attr.value)
    .map((attr) => `${(attr.shortName ?? attr.name ?? '?').toUpperCase()}=${attr.value}`)
    .join(', ')
}
