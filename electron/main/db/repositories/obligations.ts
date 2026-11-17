import { eq, and, desc, inArray, like } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type {
  ApplyGroupInput,
  ApplyGroupResult,
  AppNotification,
  ClientObligation,
  Department,
  ExtraHoliday,
  Obligation,
  ObligationFilter,
  ObligationGroup,
  ObligationGroupObligation,
  ObligationMonthItem,
  PasteLinksResult,
  SetDeliveryResult,
  SetLinkResult,
} from '../../../../shared/types'
import {
  applyGroupSchema,
  departmentInputSchema,
  departmentUpdateSchema,
  holidayInputSchema,
  obligationFilterSchema,
  obligationGroupInputSchema,
  obligationGroupUpdateSchema,
  obligationInputSchema,
  obligationUpdateSchema,
  pasteLinksSchema,
  monthOverviewSchema,
  setLinkSchema,
  setDeliverySchema,
  updateLinkSchema,
} from '../../../../shared/contracts'
import {
  computeDueDate,
  nextDueDate,
  normalizeObligationRule,
  obligationRuleIssues,
  todayStr,
  RECURRENCE_LABELS,
  type ObligationRule,
} from '../../../../shared/obligation-rules'
import type { AppDatabase } from '../database'
import { AppError } from '../../errors'
import {
  clientObligations,
  clients,
  departments,
  extraHolidays,
  notifications,
  obligationDeliveries,
  obligations,
  obligationGroupItems,
  obligationGroups,
  type ClientObligationRow,
  type DepartmentRow,
  type ExtraHolidayRow,
  type ObligationDeliveryRow,
  type ObligationGroupRow,
  type ObligationRow,
  type NotificationRow,
} from '../schema'
import { emptyToNull } from '../../security/redaction'

/* ---------------------------------------------------------------------------
 * Mappers
 * ------------------------------------------------------------------------- */

export function mapDepartment(row: DepartmentRow, obligationsCount: number): Department {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    obligationsCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapObligationRow(
  row: ObligationRow,
  departmentName: string,
  today: string,
  holidayDates: string[],
): Obligation {
  const rule: ObligationRule = {
    recurrence: row.recurrence,
    dueRule: row.dueRule ?? null,
    diaFixo: row.diaFixo ?? null,
    diaUtil: row.diaUtil ?? null,
    mesReferencia: row.mesReferencia ?? null,
    antecedenciaNotificacaoDias: row.antecedenciaNotificacaoDias,
  }
  return {
    id: row.id,
    name: row.name,
    sigla: row.sigla,
    description: row.description,
    departmentId: row.departmentId,
    departmentName,
    recurrence: row.recurrence,
    dueRule: row.dueRule ?? null,
    diaFixo: row.diaFixo ?? null,
    diaUtil: row.diaUtil ?? null,
    mesReferencia: row.mesReferencia ?? null,
    antecedenciaNotificacaoDias: row.antecedenciaNotificacaoDias,
    active: row.active,
    nextDueDate: nextDueDate(rule, today, holidayDates),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function mapClientObligation(row: ClientObligationRow): ClientObligation {
  return {
    id: row.id,
    clientId: row.clientId,
    obligationId: row.obligationId,
    dataInicio: row.dataInicio,
    dataFim: row.dataFim,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    obligationId: row.obligationId,
    clientId: row.clientId,
    dueDate: row.dueDate,
    read: row.read,
    createdAt: row.createdAt,
  }
}

export function mapExtraHoliday(row: ExtraHolidayRow): ExtraHoliday {
  return {
    id: row.id,
    date: row.date,
    name: row.name,
    icon: row.icon ?? null,
    color: row.color ?? null,
    createdAt: row.createdAt,
  }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

function holidayDates(db: AppDatabase): string[] {
  return db
    .select({ date: extraHolidays.date })
    .from(extraHolidays)
    .all()
    .map((row) => row.date)
}

function departmentNameById(db: AppDatabase): Map<string, string> {
  return new Map(
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .all()
      .map((row) => [row.id, row.name]),
  )
}

const sortPtBr = (a: string, b: string) => a.localeCompare(b, 'pt-BR')

/* ---------------------------------------------------------------------------
 * Departamentos
 * ------------------------------------------------------------------------- */

export function listDepartments(db: AppDatabase): Department[] {
  const rows = db.select().from(departments).all()
  const counts = new Map<string, number>()
  for (const row of db.select({ departmentId: obligations.departmentId }).from(obligations).all()) {
    counts.set(row.departmentId, (counts.get(row.departmentId) ?? 0) + 1)
  }
  return rows
    .map((row) => mapDepartment(row, counts.get(row.id) ?? 0))
    .sort((a, b) => sortPtBr(a.name, b.name))
}

export function getDepartmentRow(db: AppDatabase, id: string): DepartmentRow | null {
  return db.select().from(departments).where(eq(departments.id, id)).get() ?? null
}

function assertDepartmentNameAvailable(db: AppDatabase, name: string, excludeId?: string): void {
  const normalized = name.trim().toLowerCase()
  const rows = db.select().from(departments).all()
  const clash = rows.find(
    (row) => row.name.trim().toLowerCase() === normalized && row.id !== excludeId,
  )
  if (clash) {
    throw new AppError(
      'CONFLICT',
      'Departamento duplicado',
      `Já existe um departamento chamado "${clash.name}".`,
    )
  }
}

export function createDepartment(db: AppDatabase, input: unknown): Department {
  const parsed = departmentInputSchema.parse(input)
  const name = parsed.name.trim()
  assertDepartmentNameAvailable(db, name)
  const now = new Date().toISOString()
  const row: DepartmentRow = {
    id: randomUUID(),
    name,
    description: emptyToNull(parsed.description),
    active: parsed.active ?? true,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(departments).values(row).run()
  return mapDepartment(row, 0)
}

export function updateDepartment(db: AppDatabase, id: string, input: unknown): Department {
  const parsed = departmentUpdateSchema.parse(input)
  const current = getDepartmentRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Departamento não encontrado')
  const name = parsed.name?.trim() ?? current.name
  if (name.toLowerCase() !== current.name.trim().toLowerCase()) {
    assertDepartmentNameAvailable(db, name, id)
  }
  const now = new Date().toISOString()
  const row: DepartmentRow = {
    ...current,
    name,
    description:
      parsed.description === undefined ? current.description : emptyToNull(parsed.description),
    active: parsed.active ?? current.active,
    updatedAt: now,
  }
  db.update(departments).set(row).where(eq(departments.id, id)).run()
  const obligationsCount = db
    .select({ id: obligations.id })
    .from(obligations)
    .where(eq(obligations.departmentId, id))
    .all().length
  return mapDepartment(row, obligationsCount)
}

export function setDepartmentActive(db: AppDatabase, id: string, active: boolean): Department {
  const current = getDepartmentRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Departamento não encontrado')
  const now = new Date().toISOString()
  db.update(departments).set({ active, updatedAt: now }).where(eq(departments.id, id)).run()
  const obligationsCount = db
    .select({ id: obligations.id })
    .from(obligations)
    .where(eq(obligations.departmentId, id))
    .all().length
  return mapDepartment({ ...current, active, updatedAt: now }, obligationsCount)
}

export function deleteDepartment(db: AppDatabase, id: string): void {
  const current = getDepartmentRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Departamento não encontrado')
  const linked = db
    .select({ id: obligations.id })
    .from(obligations)
    .where(eq(obligations.departmentId, id))
    .all().length
  if (linked > 0) {
    throw new AppError(
      'CONFLICT',
      'Departamento possui obrigações vinculadas',
      `Não é possível excluir "${current.name}": ${linked} obrigação(ões) vinculada(s). Inative o departamento ou remova as obrigações antes.`,
      { obligationsCount: linked },
    )
  }
  db.delete(departments).where(eq(departments.id, id)).run()
}

/* ---------------------------------------------------------------------------
 * Obrigações
 * ------------------------------------------------------------------------- */

export function listObligations(db: AppDatabase, filter: ObligationFilter = {}): Obligation[] {
  const parsed = obligationFilterSchema.parse(filter) ?? {}
  const today = todayStr()
  const holidays = holidayDates(db)
  const deptNames = departmentNameById(db)
  const rows = db.select().from(obligations).all()
  const search = parsed.search?.trim().toLowerCase()
  const recurrenceFilter =
    parsed.recurrence && parsed.recurrence !== 'all' ? parsed.recurrence : null
  const activeFilter = parsed.active && parsed.active !== 'all' ? parsed.active : null
  const departmentFilter =
    parsed.departmentId && parsed.departmentId !== 'all' ? parsed.departmentId : null

  return rows
    .map((row) => mapObligationRow(row, deptNames.get(row.departmentId) ?? '—', today, holidays))
    .filter((obligation) => {
      if (departmentFilter && obligation.departmentId !== departmentFilter) return false
      if (recurrenceFilter && obligation.recurrence !== recurrenceFilter) return false
      if (activeFilter === 'active' && !obligation.active) return false
      if (activeFilter === 'inactive' && obligation.active) return false
      if (!search) return true
      return [
        obligation.name,
        obligation.sigla,
        obligation.description ?? '',
        obligation.departmentName,
        RECURRENCE_LABELS[obligation.recurrence],
      ]
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
    .sort((a, b) => sortPtBr(a.departmentName, b.departmentName) || sortPtBr(a.sigla, b.sigla))
}

export function getObligationRow(db: AppDatabase, id: string): ObligationRow | null {
  return db.select().from(obligations).where(eq(obligations.id, id)).get() ?? null
}

function getObligation(db: AppDatabase, id: string): Obligation {
  const row = getObligationRow(db, id)
  if (!row) throw new AppError('NOT_FOUND', 'Obrigação não encontrada')
  const deptNames = departmentNameById(db)
  return mapObligationRow(row, deptNames.get(row.departmentId) ?? '—', todayStr(), holidayDates(db))
}

function assertSiglaAvailable(
  db: AppDatabase,
  departmentId: string,
  sigla: string,
  excludeId?: string,
): void {
  const normalized = sigla.trim().toUpperCase()
  const rows = db.select().from(obligations).where(eq(obligations.departmentId, departmentId)).all()
  const clash = rows.find(
    (row) => row.sigla.trim().toUpperCase() === normalized && row.id !== excludeId,
  )
  if (clash) {
    throw new AppError(
      'CONFLICT',
      'Sigla duplicada no departamento',
      `A sigla "${normalized}" já é usada pela obrigação "${clash.name}" neste departamento.`,
    )
  }
}

function mergedRule(
  current: ObligationRow,
  parsed: Record<string, unknown>,
): ObligationRule & { antecedenciaNotificacaoDias: number } {
  const pick = <T>(key: string, fallback: T): T =>
    parsed[key] !== undefined ? (parsed[key] as T) : fallback
  const recurrence = pick('recurrence', current.recurrence)
  const dueRule =
    parsed.dueRule !== undefined ? (parsed.dueRule as ObligationRow['dueRule']) : current.dueRule
  const antecedenciaNotificacaoDias = pick(
    'antecedenciaNotificacaoDias',
    current.antecedenciaNotificacaoDias,
  )
  return {
    recurrence,
    dueRule: dueRule ?? null,
    diaFixo: pick('diaFixo', current.diaFixo) ?? null,
    diaUtil: pick('diaUtil', current.diaUtil) ?? null,
    mesReferencia: pick('mesReferencia', current.mesReferencia) ?? null,
    antecedenciaNotificacaoDias,
  }
}

function assertRuleValid(rule: ObligationRule): void {
  const issues = obligationRuleIssues(rule)
  if (issues.length > 0) {
    throw new AppError('VALIDATION', issues.join('; '), issues.join('; '))
  }
}

/** Normaliza null/undefined conforme a recorrência (ex.: eventual zera a regra). */
function normalizedRuleColumns(rule: ObligationRule): {
  dueRule: ObligationRow['dueRule']
  diaFixo: number | null
  diaUtil: number | null
  mesReferencia: number | null
} {
  if (rule.recurrence === 'eventual') {
    return { dueRule: null, diaFixo: null, diaUtil: null, mesReferencia: null }
  }
  return {
    dueRule: rule.dueRule,
    diaFixo: rule.dueRule === 'dia_fixo' ? rule.diaFixo : null,
    diaUtil: rule.dueRule === 'dia_util' ? rule.diaUtil : null,
    mesReferencia: rule.recurrence === 'mensal' ? null : rule.mesReferencia,
  }
}

export function createObligation(db: AppDatabase, input: unknown): Obligation {
  const parsed = obligationInputSchema.parse(input)
  const department = getDepartmentRow(db, parsed.departmentId)
  if (!department) throw new AppError('NOT_FOUND', 'Departamento não encontrado')
  const rule: ObligationRule = {
    recurrence: parsed.recurrence,
    dueRule: parsed.dueRule ?? null,
    diaFixo: parsed.diaFixo ?? null,
    diaUtil: parsed.diaUtil ?? null,
    mesReferencia: parsed.mesReferencia ?? null,
    antecedenciaNotificacaoDias: parsed.antecedenciaNotificacaoDias,
  }
  assertRuleValid(rule)
  const columns = normalizedRuleColumns(rule)
  const sigla = parsed.sigla.trim().toUpperCase()
  assertSiglaAvailable(db, department.id, sigla)
  const now = new Date().toISOString()
  const row: ObligationRow = {
    id: randomUUID(),
    name: parsed.name.trim(),
    sigla,
    description: emptyToNull(parsed.description),
    departmentId: department.id,
    recurrence: parsed.recurrence,
    ...columns,
    antecedenciaNotificacaoDias: rule.antecedenciaNotificacaoDias,
    active: parsed.active ?? true,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(obligations).values(row).run()
  return getObligation(db, row.id)
}

export function updateObligation(db: AppDatabase, id: string, input: unknown): Obligation {
  const parsed = obligationUpdateSchema.parse(input)
  const current = getObligationRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Obrigação não encontrada')

  const departmentId = parsed.departmentId ?? current.departmentId
  const department = getDepartmentRow(db, departmentId)
  if (!department) throw new AppError('NOT_FOUND', 'Departamento não encontrado')

  const rule = normalizeObligationRule(mergedRule(current, parsed as Record<string, unknown>))
  assertRuleValid(rule)
  const columns = normalizedRuleColumns(rule)
  const sigla = (parsed.sigla ?? current.sigla).trim().toUpperCase()
  assertSiglaAvailable(db, departmentId, sigla, id)

  const now = new Date().toISOString()
  const row: ObligationRow = {
    ...current,
    name: parsed.name?.trim() ?? current.name,
    sigla,
    description:
      parsed.description === undefined ? current.description : emptyToNull(parsed.description),
    departmentId,
    recurrence: rule.recurrence,
    ...columns,
    antecedenciaNotificacaoDias: rule.antecedenciaNotificacaoDias,
    active: parsed.active ?? current.active,
    updatedAt: now,
  }
  db.update(obligations).set(row).where(eq(obligations.id, id)).run()
  return getObligation(db, id)
}

export function setObligationActive(db: AppDatabase, id: string, active: boolean): Obligation {
  const current = getObligationRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Obrigação não encontrada')
  const now = new Date().toISOString()
  db.update(obligations).set({ active, updatedAt: now }).where(eq(obligations.id, id)).run()
  return getObligation(db, id)
}

export function deleteObligation(db: AppDatabase, id: string): { deletedInactiveLinks: number } {
  const current = getObligationRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Obrigação não encontrada')
  const linked = db
    .select({ id: clientObligations.id, active: clientObligations.active })
    .from(clientObligations)
    .where(eq(clientObligations.obligationId, id))
    .all()
  const activeLinks = linked.filter((link) => link.active).length
  if (activeLinks > 0) {
    throw new AppError(
      'CONFLICT',
      'Obrigação possui vínculos ativos',
      `Não é possível excluir "${current.sigla}": ${activeLinks} vínculo(s) ativo(s) com clientes. Inative a obrigação ou desvincule os clientes antes.`,
      { activeLinks },
    )
  }
  // Sem vínculos ativos: remove vínculos inativos remanescentes e a obrigação
  // NA MESMA transação — nunca fica metade apagada.
  let deletedChanges = 0
  db.transaction(() => {
    const deleted = db.delete(clientObligations).where(eq(clientObligations.obligationId, id)).run()
    db.delete(obligations).where(eq(obligations.id, id)).run()
    deletedChanges = Number(deleted.changes ?? 0)
  })
  return { deletedInactiveLinks: deletedChanges }
}

/* ---------------------------------------------------------------------------
 * Grupos de obrigações
 * ------------------------------------------------------------------------- */

function groupObligationsByIds(
  db: AppDatabase,
  obligationIds: string[],
): ObligationGroupObligation[] {
  if (obligationIds.length === 0) return []
  const deptNames = departmentNameById(db)
  return db
    .select()
    .from(obligations)
    .where(inArray(obligations.id, obligationIds))
    .all()
    .map((row) => ({
      id: row.id,
      sigla: row.sigla,
      name: row.name,
      departmentName: deptNames.get(row.departmentId) ?? '—',
      recurrence: row.recurrence,
      active: row.active,
    }))
    .sort((a, b) => sortPtBr(a.departmentName, b.departmentName) || sortPtBr(a.sigla, b.sigla))
}

function mapGroup(
  db: AppDatabase,
  row: ObligationGroupRow,
  obligationIds: string[],
): ObligationGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    obligationIds,
    obligations: groupObligationsByIds(db, obligationIds),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listGroups(db: AppDatabase): ObligationGroup[] {
  const rows = db.select().from(obligationGroups).all()
  const items = db.select().from(obligationGroupItems).all()
  const byGroup = new Map<string, string[]>()
  for (const item of items) {
    const list = byGroup.get(item.groupId) ?? []
    list.push(item.obligationId)
    byGroup.set(item.groupId, list)
  }
  return rows
    .map((row) => mapGroup(db, row, byGroup.get(row.id) ?? []))
    .sort((a, b) => sortPtBr(a.name, b.name))
}

function getGroupRow(db: AppDatabase, id: string): ObligationGroupRow | null {
  return db.select().from(obligationGroups).where(eq(obligationGroups.id, id)).get() ?? null
}

function groupItemIds(db: AppDatabase, groupId: string): string[] {
  return db
    .select({ obligationId: obligationGroupItems.obligationId })
    .from(obligationGroupItems)
    .where(eq(obligationGroupItems.groupId, groupId))
    .all()
    .map((row) => row.obligationId)
}

function assertObligationIdsExist(db: AppDatabase, obligationIds: string[]): void {
  if (obligationIds.length === 0) return
  const found = db
    .select({ id: obligations.id })
    .from(obligations)
    .where(inArray(obligations.id, obligationIds))
    .all().length
  if (found !== new Set(obligationIds).size) {
    throw new AppError('VALIDATION', 'Uma ou mais obrigações selecionadas não existem mais.')
  }
}

export function createGroup(db: AppDatabase, input: unknown): ObligationGroup {
  const parsed = obligationGroupInputSchema.parse(input)
  const name = parsed.name.trim()
  const clash = db
    .select()
    .from(obligationGroups)
    .all()
    .find((row) => row.name.trim().toLowerCase() === name.toLowerCase())
  if (clash) {
    throw new AppError('CONFLICT', 'Grupo duplicado', `Já existe um grupo chamado "${clash.name}".`)
  }
  const obligationIds = [...new Set(parsed.obligationIds)]
  assertObligationIdsExist(db, obligationIds)
  const now = new Date().toISOString()
  const row: ObligationGroupRow = {
    id: randomUUID(),
    name,
    description: emptyToNull(parsed.description),
    createdAt: now,
    updatedAt: now,
  }
  db.transaction((tx) => {
    tx.insert(obligationGroups).values(row).run()
    if (obligationIds.length > 0) {
      tx.insert(obligationGroupItems)
        .values(obligationIds.map((obligationId) => ({ groupId: row.id, obligationId })))
        .run()
    }
  })
  return mapGroup(db, row, obligationIds)
}

export function updateGroup(db: AppDatabase, id: string, input: unknown): ObligationGroup {
  const parsed = obligationGroupUpdateSchema.parse(input)
  const current = getGroupRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Grupo de obrigações não encontrado')
  const name = parsed.name?.trim() ?? current.name
  if (name.toLowerCase() !== current.name.trim().toLowerCase()) {
    const clash = db
      .select()
      .from(obligationGroups)
      .all()
      .find((row) => row.id !== id && row.name.trim().toLowerCase() === name.toLowerCase())
    if (clash) {
      throw new AppError(
        'CONFLICT',
        'Grupo duplicado',
        `Já existe um grupo chamado "${clash.name}".`,
      )
    }
  }
  const obligationIds =
    parsed.obligationIds === undefined ? groupItemIds(db, id) : [...new Set(parsed.obligationIds)]
  assertObligationIdsExist(db, obligationIds)
  const now = new Date().toISOString()
  const row: ObligationGroupRow = {
    ...current,
    name,
    description:
      parsed.description === undefined ? current.description : emptyToNull(parsed.description),
    updatedAt: now,
  }
  db.transaction((tx) => {
    tx.update(obligationGroups).set(row).where(eq(obligationGroups.id, id)).run()
    if (parsed.obligationIds !== undefined) {
      tx.delete(obligationGroupItems).where(eq(obligationGroupItems.groupId, id)).run()
      if (obligationIds.length > 0) {
        tx.insert(obligationGroupItems)
          .values(obligationIds.map((obligationId) => ({ groupId: id, obligationId })))
          .run()
      }
    }
  })
  return mapGroup(db, row, obligationIds)
}

export function getGroup(db: AppDatabase, id: string): ObligationGroup {
  const row = getGroupRow(db, id)
  if (!row) throw new AppError('NOT_FOUND', 'Grupo de obrigações não encontrado')
  return mapGroup(db, row, groupItemIds(db, id))
}

export function deleteGroup(db: AppDatabase, id: string): void {
  const current = getGroupRow(db, id)
  if (!current) throw new AppError('NOT_FOUND', 'Grupo de obrigações não encontrado')
  db.delete(obligationGroups).where(eq(obligationGroups.id, id)).run()
}

/**
 * Aplica um grupo a um ou mais clientes, criando vínculos individuais
 * (nunca compartilhados). Idempotente: vínculos ativos são ignorados e
 * vínculos inativos são reativados.
 */
export function applyGroup(db: AppDatabase, input: ApplyGroupInput): ApplyGroupResult {
  const parsed = applyGroupSchema.parse(input)
  const group = getGroupRow(db, parsed.groupId)
  if (!group) throw new AppError('NOT_FOUND', 'Grupo de obrigações não encontrado')
  const obligationIds = groupItemIds(db, group.id)
  const clientIds = [...new Set(parsed.clientIds)]
  const existingClients = new Set(
    db
      .select({ id: clients.id })
      .from(clients)
      .where(inArray(clients.id, clientIds))
      .all()
      .map((row) => row.id),
  )
  const validClientIds = clientIds.filter((id) => existingClients.has(id))
  if (validClientIds.length === 0) {
    throw new AppError('VALIDATION', 'Nenhum cliente selecionado existe mais.')
  }
  const dataInicio = parsed.dataInicio ?? todayStr()
  const result: ApplyGroupResult = { created: 0, reactivated: 0, skipped: 0 }
  const now = new Date().toISOString()
  db.transaction((tx) => {
    for (const obligationId of obligationIds) {
      for (const clientId of validClientIds) {
        const existing = tx
          .select()
          .from(clientObligations)
          .where(
            and(
              eq(clientObligations.clientId, clientId),
              eq(clientObligations.obligationId, obligationId),
            ),
          )
          .get()
        if (existing) {
          if (existing.active) {
            result.skipped += 1
          } else {
            tx.update(clientObligations)
              .set({ active: true, updatedAt: now })
              .where(eq(clientObligations.id, existing.id))
              .run()
            result.reactivated += 1
          }
          continue
        }
        tx.insert(clientObligations)
          .values({
            id: randomUUID(),
            clientId,
            obligationId,
            dataInicio,
            dataFim: null,
            active: true,
            createdAt: now,
            updatedAt: now,
          })
          .run()
        result.created += 1
      }
    }
  })
  return result
}

/* ---------------------------------------------------------------------------
 * Vínculos cliente ↔ obrigação
 * ------------------------------------------------------------------------- */

export function listAllLinks(db: AppDatabase): ClientObligation[] {
  return db.select().from(clientObligations).all().map(mapClientObligation)
}

export function listLinksByClient(db: AppDatabase, clientId: string): ClientObligation[] {
  return db
    .select()
    .from(clientObligations)
    .where(eq(clientObligations.clientId, clientId))
    .all()
    .map(mapClientObligation)
}

export function setClientObligationLink(
  db: AppDatabase,
  input: { clientId: string; obligationId: string; active: boolean },
): SetLinkResult {
  const parsed = setLinkSchema.parse(input)
  const client = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.clientId))
    .get()
  if (!client) throw new AppError('NOT_FOUND', 'Cliente não encontrado')
  const obligation = getObligationRow(db, parsed.obligationId)
  if (!obligation) throw new AppError('NOT_FOUND', 'Obrigação não encontrada')

  const existing = db
    .select()
    .from(clientObligations)
    .where(
      and(
        eq(clientObligations.clientId, parsed.clientId),
        eq(clientObligations.obligationId, parsed.obligationId),
      ),
    )
    .get()
  const now = new Date().toISOString()

  if (existing) {
    if (existing.active === parsed.active) {
      return {
        link: mapClientObligation(existing),
        created: false,
        reactivated: false,
        changed: false,
      }
    }
    const updated = { ...existing, active: parsed.active, updatedAt: now }
    db.update(clientObligations)
      .set({ active: parsed.active, updatedAt: now })
      .where(eq(clientObligations.id, existing.id))
      .run()
    return {
      link: mapClientObligation(updated),
      created: false,
      reactivated: parsed.active,
      changed: true,
    }
  }

  if (!parsed.active) {
    throw new AppError('NOT_FOUND', 'Vínculo não encontrado para remover.')
  }
  const row: ClientObligationRow = {
    id: randomUUID(),
    clientId: parsed.clientId,
    obligationId: parsed.obligationId,
    dataInicio: todayStr(),
    dataFim: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(clientObligations).values(row).run()
  return { link: mapClientObligation(row), created: true, reactivated: false, changed: true }
}

export function updateLink(db: AppDatabase, input: unknown): ClientObligation {
  const parsed = updateLinkSchema.parse(input)
  const current = db
    .select()
    .from(clientObligations)
    .where(eq(clientObligations.id, parsed.id))
    .get()
  if (!current) throw new AppError('NOT_FOUND', 'Vínculo não encontrado')
  const dataInicio = parsed.dataInicio ?? current.dataInicio
  const dataFim = parsed.dataFim === undefined ? current.dataFim : parsed.dataFim
  if (dataFim && dataFim < dataInicio) {
    throw new AppError('VALIDATION', 'A data final não pode ser anterior à data inicial.')
  }
  const now = new Date().toISOString()
  const row: ClientObligationRow = {
    ...current,
    dataInicio,
    dataFim,
    active: parsed.active ?? current.active,
    updatedAt: now,
  }
  db.update(clientObligations).set(row).where(eq(clientObligations.id, current.id)).run()
  return mapClientObligation(row)
}

export function removeLink(db: AppDatabase, id: string): ClientObligation {
  const current = db.select().from(clientObligations).where(eq(clientObligations.id, id)).get()
  if (!current) throw new AppError('NOT_FOUND', 'Vínculo não encontrado')
  db.delete(clientObligations).where(eq(clientObligations.id, id)).run()
  return mapClientObligation(current)
}

/**
 * Cola os vínculos da área de transferência em outro cliente. Cria registros
 * independentes; obrigações já vinculadas ativamente são ignoradas e vínculos
 * inativos são reativados.
 */
export function pasteLinks(
  db: AppDatabase,
  input: { targetClientId: string; obligationIds: string[]; dataInicio?: string | null },
): PasteLinksResult {
  const parsed = pasteLinksSchema.parse(input)
  const client = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, parsed.targetClientId))
    .get()
  if (!client) throw new AppError('NOT_FOUND', 'Cliente não encontrado')
  const obligationIds = [...new Set(parsed.obligationIds)]
  const existing = new Set(
    db
      .select({ id: obligations.id })
      .from(obligations)
      .where(inArray(obligations.id, obligationIds))
      .all()
      .map((row) => row.id),
  )
  const dataInicio = parsed.dataInicio ?? todayStr()
  const result: PasteLinksResult = { created: 0, reactivated: 0, skipped: 0 }
  const now = new Date().toISOString()
  db.transaction((tx) => {
    for (const obligationId of obligationIds) {
      if (!existing.has(obligationId)) continue
      const link = tx
        .select()
        .from(clientObligations)
        .where(
          and(
            eq(clientObligations.clientId, parsed.targetClientId),
            eq(clientObligations.obligationId, obligationId),
          ),
        )
        .get()
      if (link) {
        if (link.active) {
          result.skipped += 1
        } else {
          tx.update(clientObligations)
            .set({ active: true, updatedAt: now })
            .where(eq(clientObligations.id, link.id))
            .run()
          result.reactivated += 1
        }
        continue
      }
      tx.insert(clientObligations)
        .values({
          id: randomUUID(),
          clientId: parsed.targetClientId,
          obligationId,
          dataInicio,
          dataFim: null,
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .run()
      result.created += 1
    }
  })
  return result
}

/* ---------------------------------------------------------------------------
 * Visão mensal (calendário) e baixas de entrega
 * ------------------------------------------------------------------------- */

type ObligationRuleFields = {
  recurrence: ObligationRow['recurrence']
  dueRule: ObligationRow['dueRule']
  diaFixo: number | null
  diaUtil: number | null
  mesReferencia: number | null
  antecedenciaNotificacaoDias: number
}

function ruleFromFields(fields: ObligationRuleFields): ObligationRule {
  return {
    recurrence: fields.recurrence,
    dueRule: fields.dueRule ?? null,
    diaFixo: fields.diaFixo ?? null,
    diaUtil: fields.diaUtil ?? null,
    mesReferencia: fields.mesReferencia ?? null,
    antecedenciaNotificacaoDias: fields.antecedenciaNotificacaoDias,
  }
}

function deliveryKey(clientId: string, obligationId: string, dueDate: string): string {
  return `${clientId}|${obligationId}|${dueDate}`
}

/**
 * Ocorrências do mês (AAAA-MM) para todos os vínculos ativos (cliente ativo,
 * obrigação ativa). O vínculo só gera ocorrência a partir da competência em
 * que foi criado — se o vencimento do mês já passou pela `dataInicio`, a
 * obrigação só passa a contar na próxima competência (nunca nasce atrasada).
 */
export function listMonthOverview(db: AppDatabase, month: string): ObligationMonthItem[] {
  const parsed = monthOverviewSchema.parse({ month })
  const year = Number(parsed.month.slice(0, 4))
  const monthIndex0 = Number(parsed.month.slice(5, 7)) - 1
  const holidays = holidayDates(db)
  const deptNames = departmentNameById(db)

  const rows = db
    .select({
      linkId: clientObligations.id,
      clientId: clients.id,
      clientName: clients.name,
      clientDocument: clients.document,
      dataInicio: clientObligations.dataInicio,
      dataFim: clientObligations.dataFim,
      obligationId: obligations.id,
      sigla: obligations.sigla,
      name: obligations.name,
      departmentId: obligations.departmentId,
      recurrence: obligations.recurrence,
      dueRule: obligations.dueRule,
      diaFixo: obligations.diaFixo,
      diaUtil: obligations.diaUtil,
      mesReferencia: obligations.mesReferencia,
      antecedenciaNotificacaoDias: obligations.antecedenciaNotificacaoDias,
    })
    .from(clientObligations)
    .innerJoin(obligations, eq(obligations.id, clientObligations.obligationId))
    .innerJoin(clients, eq(clients.id, clientObligations.clientId))
    .where(
      and(
        eq(clientObligations.active, true),
        eq(obligations.active, true),
        eq(clients.status, 'active'),
      ),
    )
    .all()

  const deliveries = db
    .select()
    .from(obligationDeliveries)
    .where(like(obligationDeliveries.dueDate, `${parsed.month}-%`))
    .all()
  const deliveryByKey = new Map<string, ObligationDeliveryRow>(
    deliveries.map((delivery) => [
      deliveryKey(delivery.clientId, delivery.obligationId, delivery.dueDate),
      delivery,
    ]),
  )

  const items: ObligationMonthItem[] = []
  for (const row of rows) {
    let dueDate: string | null = null
    if (row.recurrence !== 'eventual') {
      dueDate = computeDueDate(ruleFromFields(row), year, monthIndex0, holidays)
      if (!dueDate) continue // mês não é de ocorrência da recorrência
      if (dueDate < row.dataInicio) continue // competência anterior ao vínculo
      if (row.dataFim && dueDate > row.dataFim) continue // vínculo encerrado
    }
    const delivery = dueDate
      ? deliveryByKey.get(deliveryKey(row.clientId, row.obligationId, dueDate))
      : undefined
    items.push({
      linkId: row.linkId,
      clientId: row.clientId,
      clientName: row.clientName,
      clientDocument: row.clientDocument,
      obligationId: row.obligationId,
      sigla: row.sigla,
      obligationName: row.name,
      departmentName: deptNames.get(row.departmentId) ?? '—',
      recurrence: row.recurrence,
      dueDate,
      dataInicio: row.dataInicio,
      delivered: Boolean(delivery),
      deliveredAt: delivery?.completedAt ?? null,
    })
  }

  return items.sort(
    (a, b) =>
      sortPtBr(a.clientName, b.clientName) ||
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
      sortPtBr(a.sigla, b.sigla),
  )
}

/**
 * Dá (ou desfaz) a baixa de uma ocorrência. Idempotente: marcar duas vezes
 * mantém a data da primeira baixa; desmarcar remove o registro.
 */
export function setDelivery(db: AppDatabase, input: unknown): SetDeliveryResult {
  const parsed = setDeliverySchema.parse(input)
  const obligation = getObligationRow(db, parsed.obligationId)
  if (!obligation) throw new AppError('NOT_FOUND', 'Obrigação não encontrada')
  if (obligation.recurrence === 'eventual') {
    throw new AppError('VALIDATION', 'Obrigação eventual não possui vencimento para baixa.')
  }
  const link = db
    .select()
    .from(clientObligations)
    .where(
      and(
        eq(clientObligations.clientId, parsed.clientId),
        eq(clientObligations.obligationId, parsed.obligationId),
      ),
    )
    .get()
  if (!link) throw new AppError('NOT_FOUND', 'Vínculo não encontrado para este cliente.')

  // A data precisa ser a ocorrência real da obrigação no mês dela.
  const year = Number(parsed.dueDate.slice(0, 4))
  const monthIndex0 = Number(parsed.dueDate.slice(5, 7)) - 1
  const expected = computeDueDate(ruleFromFields(obligation), year, monthIndex0, holidayDates(db))
  if (expected !== parsed.dueDate) {
    throw new AppError(
      'VALIDATION',
      'A data informada não corresponde ao vencimento da obrigação nesta competência.',
    )
  }
  if (parsed.dueDate < link.dataInicio || (link.dataFim && parsed.dueDate > link.dataFim)) {
    throw new AppError('VALIDATION', 'Esta ocorrência está fora do período do vínculo.')
  }

  const filters = () =>
    and(
      eq(obligationDeliveries.clientId, parsed.clientId),
      eq(obligationDeliveries.obligationId, parsed.obligationId),
      eq(obligationDeliveries.dueDate, parsed.dueDate),
    )

  if (!parsed.delivered) {
    db.delete(obligationDeliveries).where(filters()).run()
    return { delivered: false, completedAt: null }
  }

  const existing = db.select().from(obligationDeliveries).where(filters()).get()
  if (existing) return { delivered: true, completedAt: existing.completedAt }

  const now = new Date().toISOString()
  db.insert(obligationDeliveries)
    .values({
      id: randomUUID(),
      clientId: parsed.clientId,
      obligationId: parsed.obligationId,
      dueDate: parsed.dueDate,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return { delivered: true, completedAt: now }
}

/* ---------------------------------------------------------------------------
 * Notificações (central de avisos)
 * ------------------------------------------------------------------------- */

export function listNotifications(
  db: AppDatabase,
  limit = 50,
): { notifications: AppNotification[]; unreadCount: number } {
  const rows = db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200))
    .all()
  const unread = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.read, false))
    .all()
  return {
    notifications: rows.map(mapNotification),
    unreadCount: unread.length,
  }
}

export interface NewNotificationInput {
  type: 'obligation.due'
  title: string
  message: string
  obligationId: string | null
  clientId: string | null
  dueDate: string | null
}

/** Insere somente se não existir aviso igual (idempotente para o agendador). */
export function insertNotificationIfAbsent(
  db: AppDatabase,
  input: NewNotificationInput,
): AppNotification | null {
  if (input.obligationId && input.clientId && input.dueDate) {
    const dupe = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.type, input.type),
          eq(notifications.obligationId, input.obligationId),
          eq(notifications.clientId, input.clientId),
          eq(notifications.dueDate, input.dueDate),
        ),
      )
      .get()
    if (dupe) return null
  }
  const row: NotificationRow = {
    id: randomUUID(),
    type: input.type,
    title: input.title,
    message: input.message,
    obligationId: input.obligationId,
    clientId: input.clientId,
    dueDate: input.dueDate,
    read: false,
    createdAt: new Date().toISOString(),
  }
  db.insert(notifications).values(row).onConflictDoNothing().run()
  // Confirma o que foi de fato gravado: com o índice único parcial (v11),
  // uma corrida concorrente perde sem lançar — o que conta é o que persistiu.
  const persisted = db.select().from(notifications).where(eq(notifications.id, row.id)).get()
  return persisted ? mapNotification(persisted) : null
}

export function markNotificationRead(db: AppDatabase, id: string): void {
  const current = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.id, id))
    .get()
  if (!current) throw new AppError('NOT_FOUND', 'Notificação não encontrada')
  db.update(notifications).set({ read: true }).where(eq(notifications.id, id)).run()
}

export function markAllNotificationsRead(db: AppDatabase): void {
  db.update(notifications).set({ read: true }).where(eq(notifications.read, false)).run()
}

export function clearReadNotifications(db: AppDatabase): void {
  db.delete(notifications).where(eq(notifications.read, true)).run()
}

/* ---------------------------------------------------------------------------
 * Feriados extras
 * ------------------------------------------------------------------------- */

export function listHolidays(db: AppDatabase): ExtraHoliday[] {
  return db
    .select()
    .from(extraHolidays)
    .all()
    .map(mapExtraHoliday)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function addHoliday(db: AppDatabase, input: unknown): ExtraHoliday {
  const parsed = holidayInputSchema.parse(input)
  const clash = db.select().from(extraHolidays).where(eq(extraHolidays.date, parsed.date)).get()
  if (clash) {
    throw new AppError(
      'CONFLICT',
      'Feriado duplicado',
      `Já existe um feriado em ${parsed.date.split('-').reverse().join('/')} (${clash.name}).`,
    )
  }
  const row: ExtraHolidayRow = {
    id: randomUUID(),
    date: parsed.date,
    name: parsed.name.trim(),
    icon: parsed.icon ?? null,
    color: parsed.color ?? null,
    createdAt: new Date().toISOString(),
  }
  db.insert(extraHolidays).values(row).run()
  return mapExtraHoliday(row)
}

export function removeHoliday(db: AppDatabase, id: string): void {
  const current = db
    .select({ id: extraHolidays.id })
    .from(extraHolidays)
    .where(eq(extraHolidays.id, id))
    .get()
  if (!current) throw new AppError('NOT_FOUND', 'Feriado não encontrado')
  db.delete(extraHolidays).where(eq(extraHolidays.id, id)).run()
}
