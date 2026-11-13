import { and, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type {
  Credential,
  CredentialCreateInput,
  CredentialFilter,
  CredentialUpdateInput,
} from '../../../../shared/types'
import { credentialCreateSchema, credentialUpdateSchema } from '../../../../shared/contracts'
import type { AppDatabase } from '../database'
import { AppError } from '../../errors'
import { clients, credentials, services, type CredentialRow } from '../schema'
import type { VaultService } from '../../vault/service'
import { emptyToNull } from '../../security/redaction'

export interface CredentialRecord {
  row: CredentialRow
  clientName: string
  serviceName: string
  serviceSlug: string
}

function fingerprintCounts(db: AppDatabase): Map<string, number> {
  const rows = db
    .select({ fingerprint: credentials.passwordFingerprint, total: sql<number>`count(*)` })
    .from(credentials)
    .groupBy(credentials.passwordFingerprint)
    .all()
  return new Map(rows.map((row) => [row.fingerprint, Number(row.total)]))
}

function mapCredential(
  row: CredentialRow,
  clientName: string,
  serviceName: string,
  serviceSlug: string,
  counts: Map<string, number>,
): Credential {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName,
    serviceId: row.serviceId,
    serviceName,
    serviceSlug,
    label: row.label,
    username: row.username,
    usernameType: row.usernameType,
    notes: row.notes,
    fields: row.fields ? row.fields.map(({ name, kind }) => ({ name, kind })) : null,
    isDefault: row.isDefault,
    reused: (counts.get(row.passwordFingerprint) ?? 0) > 1,
    lastUsedAt: row.lastUsedAt,
    passwordChangedAt: row.passwordChangedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listCredentials(db: AppDatabase, filter: CredentialFilter = {}): Credential[] {
  const conditions = []
  if (filter.clientId) conditions.push(eq(credentials.clientId, filter.clientId))
  if (filter.serviceId) conditions.push(eq(credentials.serviceId, filter.serviceId))
  const query = db
    .select({
      credential: credentials,
      clientName: clients.name,
      serviceName: services.name,
      serviceSlug: services.slug,
    })
    .from(credentials)
    .innerJoin(clients, eq(clients.id, credentials.clientId))
    .innerJoin(services, eq(services.id, credentials.serviceId))
  const rows = conditions.length ? query.where(and(...conditions)).all() : query.all()
  const counts = fingerprintCounts(db)
  const search = filter.search?.trim().toLowerCase()
  return rows
    .filter((row) => {
      if (!search) return true
      return [row.credential.label, row.credential.username, row.clientName, row.serviceName]
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
    .map((row) =>
      mapCredential(row.credential, row.clientName, row.serviceName, row.serviceSlug, counts),
    )
    .sort(
      (a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR') || a.label.localeCompare(b.label),
    )
}

export function getCredentialRow(db: AppDatabase, id: string): CredentialRow {
  const row = db.select().from(credentials).where(eq(credentials.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Credencial nao encontrada')
  return row
}

export function getCredentialRecord(db: AppDatabase, id: string): CredentialRecord {
  const row = getCredentialRow(db, id)
  const client = db.select().from(clients).where(eq(clients.id, row.clientId)).get()
  const service = db.select().from(services).where(eq(services.id, row.serviceId)).get()
  if (!client || !service) throw new AppError('NOT_FOUND', 'Vinculo da credencial invalido')
  return { row, clientName: client.name, serviceName: service.name, serviceSlug: service.slug }
}

/**
 * Cifra os valores dos campos adicionais (AES-256-GCM, AAD
 * `credentials:{id}:field:{name}`). Valores vazios são descartados; campos
 * sem segredo (ex.: username/password — que são metadados) passam sem envelope.
 */
function sealCredentialFields(
  vault: VaultService,
  credentialId: string,
  fields:
    | Array<{
        name: string
        kind: 'username' | 'password' | 'text'
        value?: string
        enc?: 'aes-256-gcm'
      }>
    | null
    | undefined,
  /** Valores cifrados existentes a preservar quando o campo chega sem valor
   * (edição: campo deixado em branco não pode apagar o valor guardado). */
  preserveFrom?: Array<{
    name: string
    kind: string
    value?: string | null | undefined
    enc?: string | null | undefined
  }> | null,
): Array<{
  name: string
  kind: 'username' | 'password' | 'text'
  value?: string
  enc?: 'aes-256-gcm'
}> | null {
  if (!fields) return null
  return fields.map((field) => {
    const value = field.value
    if (value === undefined || value === '') {
      // Sem valor enviado na edição: preserva o blob cifrado atual.
      const previous = preserveFrom?.find(
        (item) => item.name === field.name && item.kind === field.kind,
      )
      if (previous?.value) {
        if (previous.enc === 'aes-256-gcm') {
          // Já cifrado — preserva o blob intacto.
          return {
            name: field.name,
            kind: field.kind,
            value: previous.value,
            enc: 'aes-256-gcm' as const,
          }
        }
        // Legado em claro — sela na hora (migração transparente, sem perder dado).
        return {
          name: field.name,
          kind: field.kind,
          value: vault.sealFieldValue(credentialId, field.name, previous.value),
          enc: 'aes-256-gcm' as const,
        }
      }
      return { name: field.name, kind: field.kind }
    }
    if (field.enc === 'aes-256-gcm') {
      // Já cifrado — nunca re-cifrar (o envelope apareceria duplicado no replay).
      return { name: field.name, kind: field.kind, value, enc: 'aes-256-gcm' as const }
    }
    return {
      name: field.name,
      kind: field.kind,
      value: vault.sealFieldValue(credentialId, field.name, value),
      enc: 'aes-256-gcm' as const,
    }
  })
}

export function createCredential(
  db: AppDatabase,
  vault: VaultService,
  input: CredentialCreateInput,
): Credential {
  const parsed = credentialCreateSchema.parse(input)
  const client = db.select().from(clients).where(eq(clients.id, parsed.clientId)).get()
  if (!client) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
  if (client.status === 'archived') {
    throw new AppError('FORBIDDEN', 'Nao e possivel adicionar credenciais a um cliente arquivado')
  }
  const service = db.select().from(services).where(eq(services.id, parsed.serviceId)).get()
  if (!service) throw new AppError('NOT_FOUND', 'Servico nao encontrado')

  const id = randomUUID()
  const now = new Date().toISOString()
  const existingCount = db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(eq(credentials.clientId, parsed.clientId), eq(credentials.serviceId, parsed.serviceId)),
    )
    .all().length
  const makeDefault = parsed.isDefault === true || existingCount === 0

  db.transaction(() => {
    if (makeDefault) {
      db.update(credentials)
        .set({ isDefault: false })
        .where(
          and(
            eq(credentials.clientId, parsed.clientId),
            eq(credentials.serviceId, parsed.serviceId),
          ),
        )
        .run()
    }
    db.insert(credentials)
      .values({
        id,
        clientId: parsed.clientId,
        serviceId: parsed.serviceId,
        label: parsed.label,
        username: parsed.username,
        usernameType: parsed.usernameType,
        passwordEnc: vault.sealCredentialPassword(id, parsed.password),
        passwordFingerprint: vault.fingerprintPassword(parsed.password),
        notes: emptyToNull(parsed.notes),
        fields: sealCredentialFields(vault, id, parsed.fields),
        isDefault: makeDefault,
        lastUsedAt: null,
        passwordChangedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run()
  })

  return getCredentialView(db, id)
}

export function updateCredential(
  db: AppDatabase,
  vault: VaultService,
  id: string,
  input: CredentialUpdateInput,
): Credential {
  const parsed = credentialUpdateSchema.parse(input)
  const current = getCredentialRow(db, id)
  const now = new Date().toISOString()
  const next: CredentialRow = {
    ...current,
    label: parsed.label ?? current.label,
    username: parsed.username ?? current.username,
    usernameType: parsed.usernameType ?? current.usernameType,
    notes: parsed.notes === undefined ? current.notes : emptyToNull(parsed.notes),
    fields:
      parsed.fields === undefined
        ? current.fields
        : sealCredentialFields(vault, id, parsed.fields, current.fields ?? null),
    updatedAt: now,
  }
  if (parsed.password !== undefined) {
    next.passwordEnc = vault.sealCredentialPassword(id, parsed.password)
    next.passwordFingerprint = vault.fingerprintPassword(parsed.password)
    next.passwordChangedAt = now
  }
  if (parsed.isDefault === true) {
    next.isDefault = true
  }
  db.transaction(() => {
    if (parsed.isDefault === true) {
      db.update(credentials)
        .set({ isDefault: false, updatedAt: now })
        .where(
          and(
            eq(credentials.clientId, current.clientId),
            eq(credentials.serviceId, current.serviceId),
          ),
        )
        .run()
    }
    db.update(credentials).set(next).where(eq(credentials.id, id)).run()
  })
  return getCredentialView(db, id)
}

export function deleteCredential(db: AppDatabase, id: string): void {
  const current = getCredentialRow(db, id)
  db.transaction(() => {
    db.delete(credentials).where(eq(credentials.id, id)).run()
    if (current.isDefault) {
      const replacement = db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.clientId, current.clientId),
            eq(credentials.serviceId, current.serviceId),
          ),
        )
        .all()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      if (replacement) {
        db.update(credentials)
          .set({ isDefault: true })
          .where(eq(credentials.id, replacement.id))
          .run()
      }
    }
  })
}

export function setDefaultCredential(db: AppDatabase, id: string): Credential {
  const current = getCredentialRow(db, id)
  db.transaction(() => {
    db.update(credentials)
      .set({ isDefault: false })
      .where(
        and(
          eq(credentials.clientId, current.clientId),
          eq(credentials.serviceId, current.serviceId),
        ),
      )
      .run()
    db.update(credentials).set({ isDefault: true }).where(eq(credentials.id, id)).run()
  })
  return getCredentialView(db, id)
}

export function getCredentialView(db: AppDatabase, id: string): Credential {
  // Visao de um unico registro sem varrer a tabela: contagem de reuso
  // restrita a propria impressão digital da credencial (o mapa do
  // fingerprintCounts global custaria O(N) e uma ordenacao pt-BR completa
  // a cada criacao/edicao — criacao em lote degradava quadraticamente).
  const row = getCredentialRow(db, id)
  const client = db.select().from(clients).where(eq(clients.id, row.clientId)).get()
  const service = db.select().from(services).where(eq(services.id, row.serviceId)).get()
  if (!client || !service) throw new AppError('NOT_FOUND', 'Credencial nao encontrada')
  const reuseRow = db
    .select({ total: sql<number>`count(*)` })
    .from(credentials)
    .where(eq(credentials.passwordFingerprint, row.passwordFingerprint))
    .get()
  const counts = new Map([[row.passwordFingerprint, Number(reuseRow?.total ?? 0)]])
  return mapCredential(row, client.name, service.name, service.slug, counts)
}

export function revealCredential(
  db: AppDatabase,
  vault: VaultService,
  id: string,
): { username: string; password: string; extraValues: Record<string, string> } {
  const row = getCredentialRow(db, id)
  const extraValues: Record<string, string> = {}
  for (const field of row.fields ?? []) {
    if (!field.value) continue
    try {
      extraValues[field.name] =
        field.enc === 'aes-256-gcm'
          ? vault.openFieldValue(id, field.name, field.value)
          : field.value // retrocompatibilidade: valor legado em texto claro
    } catch {
      // Nunca derruba o login por um campo corrompido — o passo vira humano.
    }
  }
  return {
    username: row.username,
    password: vault.openCredentialPassword(id, row.passwordEnc),
    extraValues,
  }
}

export function markCredentialUsed(db: AppDatabase, id: string): void {
  const now = new Date().toISOString()
  db.update(credentials)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(credentials.id, id))
    .run()
}

export function findDefaultCredential(
  db: AppDatabase,
  clientId: string,
  serviceId: string,
): CredentialRow | null {
  const rows = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.clientId, clientId), eq(credentials.serviceId, serviceId)))
    .all()
  return rows.find((row) => row.isDefault) ?? rows[0] ?? null
}

export function hasCredentials(db: AppDatabase, clientId: string, serviceId: string): boolean {
  return Boolean(findDefaultCredential(db, clientId, serviceId))
}
