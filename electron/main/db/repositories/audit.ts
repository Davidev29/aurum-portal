import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { AuditEvent, AuditFilter, AuditPage } from '../../../../shared/types'
import type { AppDatabase } from '../database'
import { auditEvents, type AuditEventRow } from '../schema'
import { redactRecord } from '../../security/redaction'

export interface AuditInput {
  type: string
  entity: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

export function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    type: row.type,
    entity: row.entity,
    entityId: row.entityId,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
  }
}

export function appendAuditEvent(db: AppDatabase, input: AuditInput): AuditEvent {
  const row: AuditEventRow = {
    id: randomUUID(),
    type: input.type,
    entity: input.entity,
    entityId: input.entityId ?? null,
    metadata: redactRecord(input.metadata ?? {}),
    createdAt: new Date().toISOString(),
  }
  db.insert(auditEvents).values(row).run()
  return mapAuditEvent(row)
}

function auditConditions(filter: AuditFilter) {
  const conditions = []
  if (filter.types?.length) conditions.push(inArray(auditEvents.type, filter.types))
  if (filter.entity) conditions.push(eq(auditEvents.entity, filter.entity))
  if (filter.entityId) conditions.push(eq(auditEvents.entityId, filter.entityId))
  if (filter.from) conditions.push(gte(auditEvents.createdAt, filter.from))
  if (filter.to) conditions.push(lte(auditEvents.createdAt, filter.to))
  return conditions
}

export function listAuditEvents(db: AppDatabase, filter: AuditFilter = {}): AuditPage {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
  const offset = Math.max(filter.offset ?? 0, 0)
  const conditions = auditConditions(filter)
  const query = db.select().from(auditEvents)
  const rows = (
    conditions.length ? query.where(and(...conditions)) : query
  )
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
  const countQuery = db.select({ total: sql<number>`count(*)` }).from(auditEvents)
  const total = (
    conditions.length ? countQuery.where(and(...conditions)) : countQuery
  ).get()
  return { events: rows.map(mapAuditEvent), total: Number(total?.total ?? 0) }
}

export function allAuditEvents(db: AppDatabase, filter: AuditFilter = {}): AuditEvent[] {
  const conditions = auditConditions(filter)
  const query = db.select().from(auditEvents)
  return (conditions.length ? query.where(and(...conditions)) : query)
    .orderBy(desc(auditEvents.createdAt))
    .all()
    .map(mapAuditEvent)
}

export function countAuditEvents(db: AppDatabase): number {
  const row = db.select({ total: sql<number>`count(*)` }).from(auditEvents).get()
  return Number(row?.total ?? 0)
}
