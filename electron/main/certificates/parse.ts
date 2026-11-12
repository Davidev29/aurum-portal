import forge from 'node-forge'
import { createHash } from 'node:crypto'
import { findDocumentInText, getDocumentType, onlyDigits } from '../../../shared/validation'

export interface ParsedPfx {
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  subjectDn: string
  issuerDn: string
  serialHex: string
  thumbprintSha1: string
  thumbprintSha256: string
  validFrom: string
  validTo: string
  isExpired: boolean
  certificateCount: number
  hasPrivateKey: boolean
}

type ForgeAttribute = { name?: string; shortName?: string; value?: string }

function attributesToDn(attributes: unknown): string {
  if (!Array.isArray(attributes)) return ''
  return attributes
    .map((attribute) => attribute as ForgeAttribute)
    .filter((attribute) => attribute.value)
    .map(
      (attribute) =>
        `${(attribute.shortName ?? attribute.name ?? '?').toUpperCase()}=${attribute.value}`,
    )
    .join(', ')
}

function readAttributeField(cert: forge.pki.Certificate, name: string): string | null {
  try {
    const field = cert.subject.getField(name)
    if (!field) return null
    const value = (field as unknown as { value?: string }).value
    return value ? String(value) : null
  } catch {
    return null
  }
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('latin1')
  if (value instanceof Uint8Array) return Buffer.from(value).toString('latin1')
  return ''
}

function extractSanCandidates(cert: forge.pki.Certificate): Array<{ value: string; oid?: string }> {
  const result: Array<{ value: string; oid?: string }> = []
  try {
    const extension = cert.getExtension('subjectAltName') as unknown as {
      altNames?: Array<{ type: number; value?: unknown; oid?: string }>
      value?: string
    }
    for (const altName of extension?.altNames ?? []) {
      if (altName.type === 0) {
        const value = toStringValue(altName.value)
        if (value) result.push({ value, oid: altName.oid })
      }
      if (altName.type === 2) {
        const value = toStringValue(altName.value)
        if (value) result.push({ value })
      }
    }
    if (extension?.value) result.push({ value: extension.value })
  } catch {
    // Some legacy certificates have malformed SAN extensions; CN fallback is used.
  }
  return result
}

function chooseDocument(
  cn: string | null,
  sanCandidates: Array<{ value: string; oid?: string }>,
): { document: string | null; type: 'CPF' | 'CNPJ' | 'OTHER' } {
  const fromCn = cn ? findDocumentInText(cn) : null
  if (fromCn) return { document: fromCn.document, type: fromCn.type }

  const normalized: Array<{ document: string; type: 'CPF' | 'CNPJ' }> = []
  for (const candidate of sanCandidates) {
    const direct = onlyDigits(candidate.value)
    if (direct.length === 11 || direct.length === 14) {
      const type = getDocumentType(direct)
      if (type) normalized.push({ document: direct, type })
    }
    const found = findDocumentInText(candidate.value)
    if (found) normalized.push(found)
  }

  const preferredOid = normalized.find((item) => item.type === 'CNPJ') ?? normalized[0]
  if (preferredOid) return { document: preferredOid.document, type: preferredOid.type }
  return { document: null, type: 'OTHER' }
}

function localKeyIdOf(bag: forge.pkcs12.Bag): string | null {
  const attributes = bag.attributes as Record<string, unknown> | undefined
  const value = attributes?.localKeyId
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.length > 0) return String(value[0])
  if (value && typeof value === 'object' && 'toString' in value) return String(value)
  return null
}

function isCaCertificate(cert: forge.pki.Certificate): boolean {
  try {
    const basic = cert.getExtension('basicConstraints') as unknown as { cA?: boolean }
    return basic?.cA === true
  } catch {
    return false
  }
}

export function parsePfx(pfx: Buffer, password: string): ParsedPfx {
  if (!pfx || pfx.length === 0) throw new Error('Arquivo PFX vazio')
  let p12: forge.pkcs12.Pkcs12Pfx
  try {
    const der = forge.util.createBuffer(pfx.toString('binary'))
    const asn1 = forge.asn1.fromDer(der)
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password|mac|decrypt|invalid/i.test(message)) {
      throw new Error('Senha do PFX incorreta ou arquivo corrompido')
    }
    throw new Error('Nao foi possivel ler o PFX/P12')
  }

  const certBagOid = forge.pki.oids.certBag ?? '1.2.840.113549.1.12.10.1.3'
  const shroudedKeyBagOid = forge.pki.oids.pkcs8ShroudedKeyBag ?? '1.2.840.113549.1.12.10.1.2'
  const keyBagOid = forge.pki.oids.keyBag ?? '1.2.840.113549.1.12.10.1.1'

  const certBags = (
    (p12.getBags({ bagType: certBagOid })[certBagOid] ?? []) as forge.pkcs12.Bag[]
  ).filter((bag) => bag.cert)
  if (certBags.length === 0) throw new Error('O arquivo nao contem certificado')

  const keyBags = [
    ...((p12.getBags({ bagType: shroudedKeyBagOid })[shroudedKeyBagOid] ??
      []) as forge.pkcs12.Bag[]),
    ...((p12.getBags({ bagType: keyBagOid })[keyBagOid] ?? []) as forge.pkcs12.Bag[]),
  ]

  const keyLocalId = keyBags.map(localKeyIdOf).find((value): value is string => Boolean(value))
  let selected =
    (keyLocalId
      ? certBags.find((bag) => localKeyIdOf(bag) === keyLocalId && bag.cert)?.cert
      : undefined) ?? undefined
  selected ??= certBags.find((bag) => bag.cert && !isCaCertificate(bag.cert))?.cert
  selected ??= certBags[0]?.cert

  if (!selected) throw new Error('O arquivo nao contem certificado com chave privada')
  const cert = selected

  const certificateAsn1 = forge.pki.certificateToAsn1(cert)
  const derBytes = forge.asn1.toDer(certificateAsn1).getBytes()
  const der = Buffer.from(derBytes, 'binary')
  const sha1 = createHash('sha1').update(der).digest('hex').toUpperCase()
  const sha256 = createHash('sha256').update(der).digest('hex').toUpperCase()

  const cn = readAttributeField(cert, 'CN')
  const organization = readAttributeField(cert, 'O')
  const document = chooseDocument(cn, extractSanCandidates(cert))
  const holderNameRaw = cn ?? organization ?? 'Titular sem nome'
  const holderName =
    holderNameRaw.replace(/:\s*\d[\d.\-/\s]{9,20}\d\s*$/, '').trim() || holderNameRaw

  const validFrom = cert.validity.notBefore.toISOString()
  const validTo = cert.validity.notAfter.toISOString()

  return {
    holderName,
    document: document.document,
    documentType: document.type,
    subjectDn: attributesToDn(cert.subject.attributes),
    issuerDn: attributesToDn(cert.issuer.attributes),
    serialHex: String(cert.serialNumber ?? '').toUpperCase(),
    thumbprintSha1: sha1,
    thumbprintSha256: sha256,
    validFrom,
    validTo,
    isExpired: cert.validity.notAfter.getTime() < Date.now(),
    certificateCount: certBags.length,
    hasPrivateKey: keyBags.length > 0,
  }
}

export function parsePfxSafe(
  pfx: Buffer,
  password: string,
): { ok: true; value: ParsedPfx } | { ok: false; error: string } {
  try {
    return { ok: true, value: parsePfx(pfx, password) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido ao ler PFX',
    }
  }
}
