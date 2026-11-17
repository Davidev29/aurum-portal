import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type {
  Certificate,
  CertificateDetails,
  CertificateFilter,
  CertificateRenewalEntry,
  CertificateClientLink,
  WindowsCertificate,
} from '../../../../shared/types'
import type { CertificateStatus } from '../../../../shared/constants'
import { getDocumentType } from '../../../../shared/validation'
import {
  chainEffectiveValidTo,
  collapseToCurrentCertificates,
  computeRenewalInfo,
  getEffectiveExpiryInfo,
  renewalDocumentKey,
  renewalHistoryFor,
  toRenewalEntry,
} from '../../../../shared/certificate-renewal'
import { computeCertificateStatus, daysUntil } from '../../certificates/core'
import type { ParsedPfx } from '../../certificates/parse'
import type { AppDatabase } from '../database'
import { AppError } from '../../errors'
import {
  certificateClients,
  certificates,
  clients,
  type CertificateRow,
  type ClientRow,
} from '../schema'
import type { VaultService } from '../../vault/service'

export interface CertificateViewContext {
  links: CertificateClientLink[]
  installed: boolean
}

export function mapCertificate(
  row: CertificateRow,
  links: CertificateClientLink[],
  now = new Date(),
): Certificate {
  const status: CertificateStatus =
    row.statusOverride ??
    computeCertificateStatus({
      validTo: row.validTo,
      source: row.source,
      installed: row.installed,
      chainIncomplete: row.chainStatus ? !/^(ok|true|valid)$/i.test(row.chainStatus) : false,
      now,
    })
  return {
    id: row.id,
    clientId: row.clientId,
    clients: links,
    label: row.label,
    holderName: row.holderName,
    document: row.document,
    documentType: row.documentType,
    subjectDn: row.subjectDn,
    issuerDn: row.issuerDn,
    serialHex: row.serialHex,
    thumbprintSha1: row.thumbprintSha1,
    thumbprintSha256: row.thumbprintSha256,
    validFrom: row.validFrom,
    validTo: row.validTo,
    source: row.source,
    installed: row.installed,
    installedAt: row.installedAt,
    lastSeenAt: row.lastSeenAt,
    status,
    daysUntilExpiry: daysUntil(row.validTo, now),
    chainStatus: row.chainStatus,
    hasPfx: Boolean(row.pfxEnc),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export interface CreatedCertificate {
  row: CertificateRow
  /**
   * Clientes herdados de certificados anteriores da MESMA cadeia de renovação
   * (mesmo CPF/CNPJ — ou mesmo titular quando não há documento). A herança só
   * copia vínculos com consentimento registrado; ver inheritRenewalClientLinks.
   */
  inheritedClientIds: string[]
}

/**
 * Herança de vínculos na cadeia de renovação.
 *
 * Quando um certificado chega sem cliente explícito, os vínculos CONSENTIDOS
 * dos certificados anteriores da mesma cadeia (mesmo documento, ou mesmo
 * titular na ausência de documento) são copiados para ele — preservando a
 * data original do consentimento. Sem isso, o certificado renovado aparecia
 * sem vínculo e o anterior ficava oculto pela colapse de renovação da
 * listagem: o cliente sumia do fluxo de Acessos mesmo tendo certificado
 * válido e autorização já registrada.
 *
 * Regras de segurança:
 * - Só herda vínculos com `consentAt` preenchido (prova de consentimento).
 * - Clientes arquivados (ou removidos) não recebem vínculo.
 * - Vínculo explícito do próprio import nunca é duplicado nem sobrescrito.
 * - O `consentAt` herdado preserva a data original do consentimento.
 */
function inheritRenewalClientLinks(
  db: AppDatabase,
  created: CertificateRow,
  now: string,
): string[] {
  const key = renewalDocumentKey({
    id: created.id,
    holderName: created.holderName,
    document: created.document,
    documentType: created.documentType,
    validFrom: created.validFrom,
    validTo: created.validTo,
    createdAt: created.createdAt,
  })
  const universe = db.select().from(certificates).all()
  const predecessors = universe.filter(
    (row) => row.id !== created.id && renewalDocumentKey(row) === key,
  )
  if (predecessors.length === 0) return []

  const predecessorIds = predecessors.map((row) => row.id)
  const consented = db
    .select({
      clientId: certificateClients.clientId,
      consentAt: certificateClients.consentAt,
    })
    .from(certificateClients)
    .where(inArray(certificateClients.certificateId, predecessorIds))
    .all()
    .filter((link) => Boolean(link.consentAt))

  if (consented.length === 0) return []

  // Consentimento mais antigo registrado por cliente (preserva a data real).
  const consentByClient = new Map<string, string>()
  for (const link of consented) {
    const consentAt = link.consentAt as string
    const current = consentByClient.get(link.clientId)
    if (!current || consentAt < current) consentByClient.set(link.clientId, consentAt)
  }

  // Ignora clientes arquivados ou inexistentes (não recebem novos vínculos).
  const clientIds = [...consentByClient.keys()]
  const statusRows = db
    .select({ id: clients.id, status: clients.status })
    .from(clients)
    .where(inArray(clients.id, clientIds))
    .all()
  const allowed = new Set(
    statusRows.filter((row) => row.status !== 'archived').map((row) => row.id),
  )

  // Nunca duplica vínculo explícito existente neste certificado.
  const alreadyLinked = new Set(
    db
      .select({ clientId: certificateClients.clientId })
      .from(certificateClients)
      .where(eq(certificateClients.certificateId, created.id))
      .all()
      .map((row) => row.clientId),
  )

  const frequency = new Map<string, number>()
  for (const link of consented) {
    if (allowed.has(link.clientId)) {
      frequency.set(link.clientId, (frequency.get(link.clientId) ?? 0) + 1)
    }
  }

  const inherited: string[] = []
  for (const clientId of clientIds) {
    if (!allowed.has(clientId) || alreadyLinked.has(clientId)) continue
    db.insert(certificateClients)
      .values({
        certificateId: created.id,
        clientId,
        consentAt: consentByClient.get(clientId) ?? now,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run()
    inherited.push(clientId)
  }

  // Define o vínculo "primário" legado (certificates.client_id) quando ainda
  // não há um: vence o cliente mais vezes vinculado na cadeia (empate: id).
  if (inherited.length > 0 && !created.clientId) {
    const winner = [...inherited].sort(
      (a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0) || a.localeCompare(b),
    )[0]
    const resolved = winner ?? null
    db.update(certificates)
      .set({ clientId: resolved, updatedAt: now })
      .where(eq(certificates.id, created.id))
      .run()
    // Mantém o objeto retornado em sincronia com o banco.
    created.clientId = resolved
  }
  return inherited
}

export function getCertificateRow(db: AppDatabase, id: string): CertificateRow {
  const row = db.select().from(certificates).where(eq(certificates.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Certificado nao encontrado')
  return row
}

export function findCertificateByThumbprint(
  db: AppDatabase,
  thumbprintSha256: string,
): CertificateRow | null {
  return (
    db
      .select()
      .from(certificates)
      .where(eq(certificates.thumbprintSha256, thumbprintSha256.toUpperCase()))
      .get() ?? null
  )
}

export function findCertificateBySha1(
  db: AppDatabase,
  thumbprintSha1: string,
): CertificateRow | null {
  return (
    db
      .select()
      .from(certificates)
      .where(eq(certificates.thumbprintSha1, thumbprintSha1.toUpperCase()))
      .get() ?? null
  )
}

export function getCertificateLinks(
  db: AppDatabase,
  certificateId: string,
): CertificateClientLink[] {
  return db
    .select({ id: clients.id, name: clients.name, document: clients.document })
    .from(certificateClients)
    .innerJoin(clients, eq(clients.id, certificateClients.clientId))
    .where(eq(certificateClients.certificateId, certificateId))
    .all()
}

export function getCertificateView(db: AppDatabase, id: string): Certificate {
  const row = getCertificateRow(db, id)
  const view = mapCertificate(row, getCertificateLinks(db, id))
  // Renovação precisa do universo completo (mesmo documento), não só deste item.
  const allRows = db.select().from(certificates).all()
  const allViews = allRows.map((item) =>
    item.id === row.id ? view : mapCertificate(item, getCertificateLinks(db, item.id)),
  )
  return enrichWithRenewal(allViews, new Date()).find((item) => item.id === id) ?? view
}

export function enrichWithRenewal(
  certificatesToEnrich: Certificate[],
  now: Date = new Date(),
): Certificate[] {
  // O enriquecimento usa o universo completo informado (lista global), não apenas
  // o subconjunto filtrado, para que "já foi renovado" não dependa do filtro ativo.
  return certificatesToEnrich.map((certificate) => {
    const info = computeRenewalInfo(certificate, certificatesToEnrich, now)
    // Vencimento efetivo = fim da validade do ÚLTIMO certificado da cadeia de
    // renovação (o maior validTo do mesmo documento/titular), independente de
    // ser sucessor imediato ou não. É essa data que status/dias/exibição usam.
    const chainValidTo = chainEffectiveValidTo(certificate, info.history)
    const expiry = getEffectiveExpiryInfo(certificate, chainValidTo, now)
    const status = computeCertificateStatus({
      validTo: chainValidTo,
      source: certificate.source,
      installed: certificate.installed,
      chainIncomplete: certificate.chainStatus
        ? !/^(ok|true|valid)$/i.test(certificate.chainStatus)
        : false,
      now,
    })
    return {
      ...certificate,
      isRenewed: info.isRenewed,
      hasNewerValid: info.hasNewerValid,
      renewedById: info.renewedBy?.id ?? null,
      renewedByValidTo: info.renewedBy?.validTo ?? null,
      hasOlderCertificate: Boolean(info.previous),
      hasNewerCertificate: Boolean(info.next),
      // A data real de cada certificado é preservada em `validTo`; a validade
      // exibida/efetiva da cadeia vai em `effectiveValidTo`.
      effectiveValidTo: chainValidTo,
      daysUntilExpiry: expiry.daysUntilExpiry,
      status,
    }
  })
}

export function getCertificateDetails(
  db: AppDatabase,
  id: string,
  now: Date = new Date(),
): CertificateDetails {
  const current = getCertificateView(db, id)
  // Para o histórico usamos TODOS os certificados (sem filtro e sem colapso
  // de renovação), pois a renovação pode estar vinculada a outro cliente
  // com o mesmo documento.
  const all = listCertificates(db, { includeHistory: true }, now)
  const historyCertificates = renewalHistoryFor(current, all)
  const info = computeRenewalInfo(current, all, now)
  const history: CertificateRenewalEntry[] = historyCertificates.map((certificate) =>
    toRenewalEntry(certificate, current.id),
  )
  const toEntry = (certificateId: string | undefined | null): CertificateRenewalEntry | null => {
    if (!certificateId) return null
    const found = historyCertificates.find((certificate) => certificate.id === certificateId)
    return found ? toRenewalEntry(found, current.id) : null
  }
  return {
    certificate: current,
    history,
    isRenewed: info.isRenewed,
    renewedBy: toEntry(info.renewedBy?.id),
    previous: toEntry(info.previous?.id),
    next: toEntry(info.next?.id),
    hasHistory: history.length > 1,
  }
}

export function listCertificates(
  db: AppDatabase,
  filter: CertificateFilter = {},
  now: Date = new Date(),
): Certificate[] {
  const rows = db.select().from(certificates).all()
  const links = db
    .select({
      certificateId: certificateClients.certificateId,
      id: clients.id,
      name: clients.name,
      document: clients.document,
    })
    .from(certificateClients)
    .innerJoin(clients, eq(clients.id, certificateClients.clientId))
    .all()
  const linksByCertificate = new Map<string, CertificateClientLink[]>()
  for (const link of links) {
    const list = linksByCertificate.get(link.certificateId) ?? []
    list.push({ id: link.id, name: link.name, document: link.document })
    linksByCertificate.set(link.certificateId, list)
  }
  const search = filter.search?.trim().toLowerCase()
  // Enriquecimento de renovação calculado sobre o universo completo (sem filtro),
  // para que status=expired enxergue o sucessor válido mesmo fora do filtro.
  const allViews = enrichWithRenewal(
    rows.map((row) => mapCertificate(row, linksByCertificate.get(row.id) ?? [], now)),
    now,
  )
  const filtered = allViews.filter((certificate) => {
    if (filter.clientId) {
      const linked =
        certificate.clientId === filter.clientId ||
        certificate.clients.some((client) => client.id === filter.clientId)
      if (!linked) return false
    }
    if (filter.status && filter.status !== 'all' && certificate.status !== filter.status) {
      return false
    }
    if (!search) return true
    return [
      certificate.holderName,
      certificate.label,
      certificate.document ?? '',
      certificate.issuerDn,
      ...certificate.clients.map((client) => client.name),
    ]
      .join(' ')
      .toLowerCase()
      .includes(search)
  })
  // Certificados históricos já renovados são "arquivados" pela renovação: a
  // listagem mostra apenas o certificado ATUAL de cada cadeia (mesmo CPF/CNPJ
  // ou titular). Os históricos continuam acessíveis no modal de detalhes
  // (histórico de renovação), que pede `includeHistory`.
  // O colapso acontece depois do filtro para que, p. ex., a visão de um
  // cliente mostre o melhor certificado entre os vinculados a ele.
  const visible = filter.includeHistory ? filtered : collapseToCurrentCertificates(filtered)
  return visible.sort((a, b) => new Date(a.validTo).getTime() - new Date(b.validTo).getTime())
}

export interface CreatePfxCertificateInput {
  parsed: ParsedPfx
  pfx: Buffer
  password: string
  label?: string
  clientId?: string | null
  consent?: boolean
  install: boolean
  installed: boolean
  chainStatus?: string | null
}

export function createPfxCertificate(
  db: AppDatabase,
  vault: VaultService,
  input: CreatePfxCertificateInput,
): CreatedCertificate {
  const existing = findCertificateByThumbprint(db, input.parsed.thumbprintSha256)
  if (existing) {
    if (input.clientId)
      linkClientToCertificate(db, existing.id, input.clientId, input.consent === true)
    throw new AppError(
      'CONFLICT',
      'Certificado ja importado',
      'Este certificado ja esta cadastrado.',
      { certificateId: existing.id },
    )
  }
  if (input.clientId && input.consent !== true) {
    throw new AppError(
      'FORBIDDEN',
      'Consentimento obrigatorio',
      'Confirme que voce tem autorizacao do titular para usar este certificado.',
    )
  }
  const id = randomUUID()
  const sealed = vault.sealPfx(id, input.pfx, input.password)
  const now = new Date().toISOString()
  const row: CertificateRow = {
    id,
    clientId: input.clientId ?? null,
    label: input.label?.trim() || input.parsed.holderName,
    holderName: input.parsed.holderName,
    document: input.parsed.document,
    documentType: input.parsed.documentType,
    subjectDn: input.parsed.subjectDn,
    issuerDn: input.parsed.issuerDn,
    serialHex: input.parsed.serialHex,
    thumbprintSha1: input.parsed.thumbprintSha1.toUpperCase(),
    thumbprintSha256: input.parsed.thumbprintSha256.toUpperCase(),
    validFrom: input.parsed.validFrom,
    validTo: input.parsed.validTo,
    source: 'pfx',
    pfxEnc: sealed.pfxEnc,
    pfxPasswordEnc: sealed.passwordEnc,
    installed: input.installed,
    installedAt: input.installed ? now : null,
    lastSeenAt: input.installed ? now : null,
    chainStatus: input.chainStatus ?? null,
    statusOverride: null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  let inheritedClientIds: string[] = []
  db.transaction(() => {
    db.insert(certificates).values(row).run()
    if (input.clientId) {
      db.insert(certificateClients)
        .values({
          certificateId: id,
          clientId: input.clientId,
          consentAt: input.consent ? now : null,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run()
    }
    // Renovação sem cliente explícito: herda os vínculos consentidos da cadeia
    // NA MESMA transação — cert nunca fica visível sem seus vínculos.
    inheritedClientIds = inheritRenewalClientLinks(db, row, now)
  })
  return { row, inheritedClientIds }
}

export function createWindowsCertificate(
  db: AppDatabase,
  record: WindowsCertificate,
  clientId?: string | null,
  consent = false,
): CreatedCertificate {
  const existing = findCertificateByThumbprint(db, record.thumbprintSha256 ?? '')
  if (existing) {
    let inheritedClientIds: string[] = []
    db.transaction(() => {
      if (clientId) linkClientToCertificate(db, existing.id, clientId, consent)
      inheritedClientIds = inheritRenewalClientLinks(db, existing, new Date().toISOString())
    })
    return { row: existing, inheritedClientIds }
  }
  if (clientId && !consent) {
    throw new AppError(
      'FORBIDDEN',
      'Consentimento obrigatorio',
      'Confirme que voce tem autorizacao do titular para usar este certificado.',
    )
  }
  const id = randomUUID()
  const now = new Date().toISOString()
  const row: CertificateRow = {
    id,
    clientId: clientId ?? null,
    label: record.holderName,
    holderName: record.holderName,
    document: record.document,
    documentType: record.document ? (getDocumentType(record.document) ?? 'OTHER') : 'OTHER',
    subjectDn: record.subject,
    issuerDn: record.issuer,
    serialHex: record.serialNumber,
    thumbprintSha1: record.thumbprintSha1.toUpperCase(),
    thumbprintSha256: (record.thumbprintSha256 ?? '').toUpperCase(),
    validFrom: record.notBefore,
    validTo: record.notAfter,
    source: 'windows',
    pfxEnc: null,
    pfxPasswordEnc: null,
    installed: true,
    installedAt: now,
    lastSeenAt: now,
    chainStatus: null,
    statusOverride: null,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  if (!row.thumbprintSha256 || row.thumbprintSha256.length !== 64) {
    throw new AppError(
      'VALIDATION',
      'Thumbprint SHA-256 indisponivel para o certificado do Windows',
    )
  }
  let inheritedClientIds: string[] = []
  db.transaction(() => {
    db.insert(certificates).values(row).run()
    if (clientId) {
      db.insert(certificateClients)
        .values({
          certificateId: id,
          clientId,
          consentAt: now,
          createdAt: now,
        })
        .onConflictDoNothing()
        .run()
    }
    inheritedClientIds = inheritRenewalClientLinks(db, row, now)
  })
  return { row, inheritedClientIds }
}

export function linkClientToCertificate(
  db: AppDatabase,
  certificateId: string,
  clientId: string,
  consent: boolean,
): void {
  const certificate = getCertificateRow(db, certificateId)
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get()
  if (!client) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
  if (client.status === 'archived') {
    throw new AppError('FORBIDDEN', 'Nao e possivel vincular certificado a cliente arquivado')
  }
  if (!consent) {
    throw new AppError(
      'FORBIDDEN',
      'Consentimento obrigatorio',
      'Registre a autorizacao do titular antes de vincular o certificado.',
    )
  }
  const now = new Date().toISOString()
  db.transaction(() => {
    db.insert(certificateClients)
      .values({ certificateId, clientId, consentAt: now, createdAt: now })
      .onConflictDoUpdate({
        target: [certificateClients.certificateId, certificateClients.clientId],
        set: { consentAt: now },
      })
      .run()
    if (!certificate.clientId) {
      db.update(certificates)
        .set({ clientId, updatedAt: now })
        .where(eq(certificates.id, certificateId))
        .run()
    }
  })
}

export function unlinkClientFromCertificate(
  db: AppDatabase,
  certificateId: string,
  clientId: string,
): void {
  const current = getCertificateRow(db, certificateId)
  const now = new Date().toISOString()
  db.transaction(() => {
    db.delete(certificateClients)
      .where(
        and(
          eq(certificateClients.certificateId, certificateId),
          eq(certificateClients.clientId, clientId),
        ),
      )
      .run()
    if (current.clientId === clientId) {
      const next = db
        .select()
        .from(certificateClients)
        .where(eq(certificateClients.certificateId, certificateId))
        .get()
      db.update(certificates)
        .set({ clientId: next?.clientId ?? null, updatedAt: now })
        .where(eq(certificates.id, certificateId))
        .run()
    }
  })
}

export function setCertificateInstalled(
  db: AppDatabase,
  id: string,
  installed: boolean,
  extra: { chainStatus?: string | null; lastSeenAt?: string | null } = {},
): CertificateRow {
  const current = getCertificateRow(db, id)
  const now = new Date().toISOString()
  const next: CertificateRow = {
    ...current,
    installed,
    installedAt: installed ? (current.installedAt ?? now) : current.installedAt,
    lastSeenAt: installed ? (extra.lastSeenAt ?? now) : current.lastSeenAt,
    chainStatus: extra.chainStatus === undefined ? current.chainStatus : extra.chainStatus,
    updatedAt: now,
  }
  db.update(certificates).set(next).where(eq(certificates.id, id)).run()
  return next
}

export function refreshWindowsPresence(db: AppDatabase, presentThumbprintsSha1: Set<string>): void {
  const rows = db.select().from(certificates).all()
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const row of rows) {
      const installed = presentThumbprintsSha1.has(row.thumbprintSha1.toUpperCase())
      if (installed !== row.installed) {
        db.update(certificates)
          .set({
            installed,
            installedAt: installed ? (row.installedAt ?? now) : row.installedAt,
            lastSeenAt: installed ? now : row.lastSeenAt,
            updatedAt: now,
          })
          .where(eq(certificates.id, row.id))
          .run()
      } else if (installed) {
        db.update(certificates).set({ lastSeenAt: now }).where(eq(certificates.id, row.id)).run()
      }
    }
  })
}

export function markCertificateUsed(db: AppDatabase, id: string): void {
  const now = new Date().toISOString()
  db.update(certificates).set({ lastUsedAt: now }).where(eq(certificates.id, id)).run()
}

export function certificateStats(db: AppDatabase): {
  total: number
  expiring: number
  expired: number
  missingWindows: number
  installed: number
} {
  const list = listCertificates(db)
  return {
    total: list.length,
    expiring: list.filter((certificate) => certificate.status === 'expiring').length,
    expired: list.filter((certificate) => certificate.status === 'expired').length,
    missingWindows: list.filter(
      (certificate) =>
        certificate.status === 'missing_windows' || certificate.status === 'in_vault',
    ).length,
    installed: list.filter((certificate) => certificate.installed).length,
  }
}

export function findClientsForCertificate(db: AppDatabase, document: string | null): ClientRow[] {
  if (!document) return []
  return db.select().from(clients).where(eq(clients.document, document)).all()
}

export function listCertificatesForClient(db: AppDatabase, clientId: string): Certificate[] {
  return listCertificates(db, { clientId, status: 'all' })
}

export function activeCertificateLinks(db: AppDatabase, certificateIds: string[]): number {
  if (certificateIds.length === 0) return 0
  return db
    .select()
    .from(certificateClients)
    .where(inArray(certificateClients.certificateId, certificateIds))
    .all().length
}
