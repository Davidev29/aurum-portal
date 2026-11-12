/**
 * Agendador diário de lembretes de obrigações.
 *
 * Regra: toda obrigação com vínculo ativo cujo `data_vencimento -
 * antecedencia_notificacao_dias` seja hoje gera uma notificação na central de
 * avisos do app (deduplicada por obrigação + cliente + data de vencimento).
 * Roda na abertura do aplicativo e depois a cada 6 horas.
 */
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/database'
import { clients, clientObligations, obligations } from '../db/schema'
import { appendAuditEvent } from '../db/repositories/audit'
import { insertNotificationIfAbsent, listHolidays } from '../db/repositories/obligations'
import { notificationDueDate, todayStr } from '../../../shared/obligation-rules'
import { formatDateBr } from '../../../shared/holidays'
import { IPC } from '../../../shared/contracts'
import { logger } from '../logger'

export interface ObligationReminderDeps {
  db: AppDatabase
  broadcast: (channel: string, payload: unknown) => void
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 horas
const STARTUP_DELAY_MS = 5_000

/** Gera os avisos pendentes de hoje. Retorna quantos foram criados. */
export function generateDueNotifications(db: AppDatabase, now: Date = new Date()): number {
  const today = todayStr(now)
  const holidayDates = listHolidays(db).map((holiday) => holiday.date)

  const links = db
    .select({
      clientId: clientObligations.clientId,
      clientName: clients.name,
      obligationId: obligations.id,
      obligationName: obligations.name,
      sigla: obligations.sigla,
      recurrence: obligations.recurrence,
      dueRule: obligations.dueRule,
      diaFixo: obligations.diaFixo,
      diaUtil: obligations.diaUtil,
      mesReferencia: obligations.mesReferencia,
      antecedenciaNotificacaoDias: obligations.antecedenciaNotificacaoDias,
      dataInicio: clientObligations.dataInicio,
      dataFim: clientObligations.dataFim,
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

  let created = 0
  for (const link of links) {
    const dueDate = notificationDueDate(
      {
        recurrence: link.recurrence,
        dueRule: link.dueRule,
        diaFixo: link.diaFixo,
        diaUtil: link.diaUtil,
        mesReferencia: link.mesReferencia,
        antecedenciaNotificacaoDias: link.antecedenciaNotificacaoDias,
      },
      today,
      holidayDates,
    )
    if (!dueDate) continue
    // Não avisa competência anterior à criação do vínculo nem posterior ao fim.
    if (dueDate < link.dataInicio) continue
    if (link.dataFim && dueDate > link.dataFim) continue

    const antecedencia = link.antecedenciaNotificacaoDias
    const when =
      antecedencia === 0
        ? 'vence hoje'
        : `vence em ${antecedencia} dia(s), em ${formatDateBr(dueDate)}`
    const inserted = insertNotificationIfAbsent(db, {
      type: 'obligation.due',
      title: `${link.sigla} · ${link.clientName}`,
      message: `${link.obligationName} ${when}.`,
      obligationId: link.obligationId,
      clientId: link.clientId,
      dueDate,
    })
    if (inserted) created += 1
  }

  if (created > 0) {
    try {
      appendAuditEvent(db, {
        type: 'obligation.notifications_sent',
        entity: 'obligation',
        entityId: null,
        metadata: { date: today, created },
      })
    } catch {
      // Auditoria nunca bloqueia o agendador.
    }
  }
  return created
}

/** Registra o agendador. Retorna função de encerramento (usado em testes/quit). */
export function startObligationReminderScheduler(deps: ObligationReminderDeps): () => void {
  const { db, broadcast } = deps
  let running = false

  const run = () => {
    if (running) return
    running = true
    try {
      const created = generateDueNotifications(db)
      if (created > 0) broadcast(IPC.events.notificationsChanged, { created })
    } catch (error) {
      logger.warn('obligations.reminder_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      running = false
    }
  }

  const startup = setTimeout(run, STARTUP_DELAY_MS)
  const interval = setInterval(run, CHECK_INTERVAL_MS)
  return () => {
    clearTimeout(startup)
    clearInterval(interval)
  }
}
