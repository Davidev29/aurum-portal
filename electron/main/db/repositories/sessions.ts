import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { SessionStatus } from '../../../../shared/constants'
import type { AppDatabase } from '../database'
import { sessions, type SessionRow } from '../schema'

export interface CreateSessionRowInput {
  id: string
  clientId: string
  certificateId: string | null
  serviceId: string
  credentialId: string | null
  authMethod: 'certificate' | 'password'
  partition: string
  openedAt: string
}

export function createSessionRow(db: AppDatabase, input: CreateSessionRowInput): SessionRow {
  const row: SessionRow = {
    ...input,
    status: 'opening',
    closedAt: null,
    lastError: null,
  }
  db.insert(sessions).values(row).run()
  return row
}

export function updateSessionRow(
  db: AppDatabase,
  id: string,
  status: SessionStatus,
  lastError: string | null = null,
): void {
  const closedAt = status === 'closed' ? new Date().toISOString() : null
  db.update(sessions)
    .set({ status, lastError, ...(closedAt ? { closedAt } : {}) })
    .where(eq(sessions.id, id))
    .run()
}

export function closeSessionRow(
  db: AppDatabase,
  id: string,
  lastError: string | null = null,
): void {
  db.update(sessions)
    .set({ status: 'closed', closedAt: new Date().toISOString(), lastError })
    .where(eq(sessions.id, id))
    .run()
}

export function closeOrphanedSessions(db: AppDatabase): number {
  const rows = db.select().from(sessions).where(isNull(sessions.closedAt)).all()
  if (rows.length === 0) return 0
  const now = new Date().toISOString()
  db.update(sessions)
    .set({ status: 'closed', closedAt: now, lastError: 'Encerrada na inicializacao anterior' })
    .where(isNull(sessions.closedAt))
    .run()
  return rows.length
}

export function countOpenSessionRows(db: AppDatabase): number {
  return db.select().from(sessions).where(isNull(sessions.closedAt)).all().length
}

export function listSessionRows(
  db: AppDatabase,
  filter: { clientId?: string; from?: string; to?: string } = {},
): SessionRow[] {
  const conditions = []
  if (filter.clientId) conditions.push(eq(sessions.clientId, filter.clientId))
  if (filter.from) conditions.push(gte(sessions.openedAt, filter.from))
  if (filter.to) conditions.push(lte(sessions.openedAt, filter.to))
  return conditions.length
    ? db
        .select()
        .from(sessions)
        .where(and(...conditions))
        .all()
    : db.select().from(sessions).all()
}

export function newSessionId(): string {
  return randomUUID()
}
