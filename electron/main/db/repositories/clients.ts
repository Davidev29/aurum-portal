import { eq, ne, and, desc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Client, ClientFilter, ClientInput, ClientNote } from '../../../../shared/types'
import { clientInputSchema, clientUpdateSchema } from '../../../../shared/contracts'
import { onlyDigits } from '../../../../shared/validation'
import type { AppDatabase } from '../database'
import { AppError } from '../../errors'
import { clients, clientNotes, type ClientRow, type ClientNoteRow } from '../schema'
import { emptyToNull } from '../../security/redaction'

export function mapClient(row: ClientRow): Client {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    honorariosCents: row.honorariosCents ?? null,
    tags: row.tags ?? [],
    status: row.status,
    consentAt: row.consentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listClients(db: AppDatabase, filter: ClientFilter = {}): Client[] {
  const rows = db.select().from(clients).all().map(mapClient)
  const search = filter.search?.trim().toLowerCase()
  return rows
    .filter((client) => {
      if (filter.status && filter.status !== 'all' && client.status !== filter.status) return false
      if (filter.tag && !client.tags.includes(filter.tag)) return false
      if (!search) return true
      return [client.name, client.document, client.email ?? '', ...client.tags]
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function getClient(db: AppDatabase, id: string): Client | null {
  const row = db.select().from(clients).where(eq(clients.id, id)).get()
  return row ? mapClient(row) : null
}

export function findClientByDocument(db: AppDatabase, document: string): Client | null {
  const row = db
    .select()
    .from(clients)
    .where(eq(clients.document, onlyDigits(document)))
    .get()
  return row ? mapClient(row) : null
}

export function createClient(db: AppDatabase, input: ClientInput): Client {
  const parsed = clientInputSchema.parse(input)
  const document = onlyDigits(parsed.document)
  const existing = db.select().from(clients).where(eq(clients.document, document)).get()
  if (existing) {
    throw new AppError(
      'CONFLICT',
      'Ja existe um cliente com este documento',
      `Ja existe um cliente cadastrado com este documento (${existing.name}).`,
    )
  }
  const now = new Date().toISOString()
  const type = parsed.type ?? (document.length === 14 ? 'PJ' : 'PF')
  const name = parsed.name?.trim() || `Cliente ${document}`
  const row: ClientRow = {
    id: randomUUID(),
    type,
    name,
    document,
    email: emptyToNull(parsed.email),
    phone: emptyToNull(parsed.phone),
    notes: emptyToNull(parsed.notes),
    honorariosCents: parsed.honorariosCents ?? null,
    tags: parsed.tags ?? [],
    status: 'active',
    consentAt: parsed.consent ? now : null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(clients).values(row).run()
  return mapClient(row)
}

export function updateClient(db: AppDatabase, id: string, input: Partial<ClientInput>): Client {
  const parsed = clientUpdateSchema.parse(input)
  const current = db.select().from(clients).where(eq(clients.id, id)).get()
  if (!current) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')

  const document = parsed.document ? onlyDigits(parsed.document) : current.document
  if (document !== current.document) {
    const duplicate = db
      .select()
      .from(clients)
      .where(and(eq(clients.document, document), ne(clients.id, id)))
      .get()
    if (duplicate) {
      throw new AppError(
        'CONFLICT',
        'Ja existe um cliente com este documento',
        `O documento pertence a outro cliente (${duplicate.name}).`,
      )
    }
  }

  const now = new Date().toISOString()
  const row: ClientRow = {
    ...current,
    type: parsed.type ?? current.type,
    name: parsed.name ?? current.name,
    document,
    email: parsed.email === undefined ? current.email : emptyToNull(parsed.email),
    phone: parsed.phone === undefined ? current.phone : emptyToNull(parsed.phone),
    notes: parsed.notes === undefined ? current.notes : emptyToNull(parsed.notes),
    honorariosCents:
      parsed.honorariosCents === undefined ? current.honorariosCents : parsed.honorariosCents,
    tags: parsed.tags ?? current.tags,
    consentAt: parsed.consent === true ? (current.consentAt ?? now) : current.consentAt,
    updatedAt: now,
  }
  db.update(clients).set(row).where(eq(clients.id, id)).run()
  return mapClient(row)
}

export function setClientStatus(
  db: AppDatabase,
  id: string,
  status: 'active' | 'archived',
): Client {
  const current = db.select().from(clients).where(eq(clients.id, id)).get()
  if (!current) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
  const now = new Date().toISOString()
  db.update(clients).set({ status, updatedAt: now }).where(eq(clients.id, id)).run()
  return mapClient({ ...current, status, updatedAt: now })
}

export function clientsForCsv(db: AppDatabase): Client[] {
  return db.select().from(clients).all().map(mapClient)
}

export function mapClientNote(row: ClientNoteRow): ClientNote {
  return {
    id: row.id,
    clientId: row.clientId,
    text: row.text,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function validateNoteText(text: string): string {
  const trimmed = text?.trim() ?? ''
  if (!trimmed) {
    throw new AppError('VALIDATION', 'O texto da observacao nao pode ser vazio')
  }
  if (trimmed.length > 5000) {
    throw new AppError('VALIDATION', 'O texto da observacao deve ter no maximo 5000 caracteres')
  }
  return trimmed
}

export function listClientNotes(db: AppDatabase, clientId: string): ClientNote[] {
  if (!clientId) throw new AppError('VALIDATION', 'Informe o cliente')
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get()
  if (!client) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
  return db
    .select()
    .from(clientNotes)
    .where(eq(clientNotes.clientId, clientId))
    .orderBy(desc(clientNotes.createdAt), desc(clientNotes.updatedAt))
    .all()
    .map(mapClientNote)
}

export function createClientNote(db: AppDatabase, clientId: string, text: string): ClientNote {
  const trimmed = validateNoteText(text)
  if (!clientId) throw new AppError('VALIDATION', 'Informe o cliente')
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get()
  if (!client) throw new AppError('NOT_FOUND', 'Cliente nao encontrado')
  const now = new Date().toISOString()
  const row: ClientNoteRow = {
    id: randomUUID(),
    clientId,
    text: trimmed,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(clientNotes).values(row).run()
  return mapClientNote(row)
}

export function updateClientNote(db: AppDatabase, id: string, text: string): ClientNote {
  const trimmed = validateNoteText(text)
  if (!id) throw new AppError('VALIDATION', 'Informe a nota')
  const current = db.select().from(clientNotes).where(eq(clientNotes.id, id)).get()
  if (!current) throw new AppError('NOT_FOUND', 'Nota nao encontrada')
  const now = new Date().toISOString()
  db.update(clientNotes).set({ text: trimmed, updatedAt: now }).where(eq(clientNotes.id, id)).run()
  return mapClientNote({ ...current, text: trimmed, updatedAt: now })
}

export function getClientNoteRow(db: AppDatabase, id: string): ClientNoteRow | null {
  return db.select().from(clientNotes).where(eq(clientNotes.id, id)).get() ?? null
}

export function deleteClientNote(db: AppDatabase, id: string): void {
  if (!id) throw new AppError('VALIDATION', 'Informe a nota')
  const current = db.select().from(clientNotes).where(eq(clientNotes.id, id)).get()
  if (!current) throw new AppError('NOT_FOUND', 'Nota nao encontrada')
  db.delete(clientNotes).where(eq(clientNotes.id, id)).run()
}
