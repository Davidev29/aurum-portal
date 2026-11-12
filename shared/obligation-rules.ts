/**
 * Regras de recorrência e vencimento das obrigações.
 *
 * Módulo puro: fonte única para o agendador de notificações (main), para o
 * formulário/prévia (renderer) e para os testes unitários.
 */

import {
  addDays,
  dateOnlyToUtc,
  lastDayOfMonth,
  nthBusinessDayOfMonth,
  toDateOnly,
} from './holidays'

export const RECURRENCE_TYPES = [
  'mensal',
  'bimestral',
  'trimestral',
  'semestral',
  'anual',
  'eventual',
] as const
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number]

export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  mensal: 'Mensal',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
  eventual: 'Eventual',
}

export const DUE_RULE_TYPES = ['dia_fixo', 'dia_util'] as const
export type DueRuleType = (typeof DUE_RULE_TYPES)[number]

export const DUE_RULE_LABELS: Record<DueRuleType, string> = {
  dia_fixo: 'Dia fixo do mês',
  dia_util: 'N-ésimo dia útil do mês',
}

export const MONTH_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

export interface ObligationRule {
  recurrence: RecurrenceType
  dueRule: DueRuleType | null
  /** Dia fixo do mês (1–31). Para dia 31 em mês curto, o vencimento cai no último dia. */
  diaFixo: number | null
  /** N-ésimo dia útil do mês (1–15). */
  diaUtil: number | null
  /** Mês de referência (1–12), âncora de bimestral/trimestral/semestral/anual. */
  mesReferencia: number | null
  /** Dias de antecedência para notificar antes do vencimento (0–90). */
  antecedenciaNotificacaoDias: number
}

export const MAX_ANTECEDENCIA_DIAS = 90
export const MAX_DIA_UTIL = 15

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/**
 * Normaliza a regra conforme a recorrência (eventual zera tudo; mensal zera a
 * âncora; cada regra zera o campo do outro tipo). Usada pelo repositório ao
 * mesclar updates parciais — campos ficam consistentes sem exigir que o
 * chamador zere tudo manualmente.
 */
export function normalizeObligationRule<T extends ObligationRule>(rule: T): T {
  if (rule.recurrence === 'eventual') {
    return { ...rule, dueRule: null, diaFixo: null, diaUtil: null, mesReferencia: null }
  }
  const next = { ...rule }
  if (next.recurrence === 'mensal') next.mesReferencia = null
  if (next.dueRule === 'dia_fixo') {
    next.diaUtil = null
  } else if (next.dueRule === 'dia_util') {
    next.diaFixo = null
  } else {
    next.diaFixo = null
    next.diaUtil = null
  }
  return next
}

/**
 * Valida a compatibilidade entre recorrência e regra de vencimento.
 * Retorna a lista de problemas (vazia quando válido). Usada pelo zod
 * (`superRefine`) e pelo repositório (revalidação no merge de updates).
 */
export function obligationRuleIssues(input: {
  recurrence?: RecurrenceType | null
  dueRule?: DueRuleType | null
  diaFixo?: number | null
  diaUtil?: number | null
  mesReferencia?: number | null
  antecedenciaNotificacaoDias?: number | null
}): string[] {
  const issues: string[] = []
  const recurrence = input.recurrence
  if (!recurrence || !RECURRENCE_TYPES.includes(recurrence)) {
    issues.push('Informe a recorrência da obrigação')
    return issues
  }
  const { dueRule, diaFixo, diaUtil, mesReferencia, antecedenciaNotificacaoDias } = input

  if (antecedenciaNotificacaoDias !== undefined && antecedenciaNotificacaoDias !== null) {
    if (
      !isInt(antecedenciaNotificacaoDias) ||
      antecedenciaNotificacaoDias < 0 ||
      antecedenciaNotificacaoDias > MAX_ANTECEDENCIA_DIAS
    ) {
      issues.push(
        `A antecedência deve ser um número inteiro entre 0 e ${MAX_ANTECEDENCIA_DIAS} dias`,
      )
    }
  }

  if (recurrence === 'eventual') {
    if (dueRule) issues.push('Obrigação eventual não possui regra de vencimento automático')
    if (diaFixo != null) issues.push('Obrigação eventual não possui dia fixo')
    if (diaUtil != null) issues.push('Obrigação eventual não possui dia útil')
    if (mesReferencia != null) issues.push('Obrigação eventual não possui mês de referência')
    return issues
  }

  if (!dueRule || !DUE_RULE_TYPES.includes(dueRule)) {
    issues.push('Informe a regra de vencimento (dia fixo ou N-ésimo dia útil)')
  } else if (dueRule === 'dia_fixo') {
    if (!isInt(diaFixo) || diaFixo < 1 || diaFixo > 31) {
      issues.push('Informe um dia fixo entre 1 e 31')
    } else if (diaUtil != null) {
      issues.push('A regra de dia fixo não aceita dia útil')
    }
  } else if (dueRule === 'dia_util') {
    if (!isInt(diaUtil) || diaUtil < 1 || diaUtil > MAX_DIA_UTIL) {
      issues.push(`Informe o N-ésimo dia útil entre 1 e ${MAX_DIA_UTIL}`)
    } else if (diaFixo != null) {
      issues.push('A regra de dia útil não aceita dia fixo')
    }
  }

  const needsAnchor =
    recurrence === 'bimestral' ||
    recurrence === 'trimestral' ||
    recurrence === 'semestral' ||
    recurrence === 'anual'
  if (needsAnchor) {
    if (!isInt(mesReferencia) || mesReferencia < 1 || mesReferencia > 12) {
      issues.push('Informe o mês de referência (1 a 12) para esta recorrência')
    }
  } else if (recurrence === 'mensal' && mesReferencia != null) {
    issues.push('Obrigação mensal não utiliza mês de referência')
  }

  return issues
}

/** Intervalo (em meses) entre ocorrências de cada recorrência. null = sem agenda. */
const RECURRENCE_PERIOD_MONTHS: Record<
  Exclude<RecurrenceType, 'eventual' | 'mensal' | 'anual'>,
  number
> = {
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
}

/** true quando o mês (year, monthIndex0) é mês de ocorrência da obrigação. */
export function isOccurrenceMonth(
  rule: Pick<ObligationRule, 'recurrence' | 'mesReferencia'>,
  year: number,
  monthIndex0: number,
): boolean {
  const { recurrence, mesReferencia } = rule
  if (recurrence === 'eventual') return false
  if (recurrence === 'mensal') return true
  if (!isInt(mesReferencia) || mesReferencia < 1 || mesReferencia > 12) return false
  const anchor = mesReferencia - 1
  if (recurrence === 'anual') return monthIndex0 === anchor
  const period = RECURRENCE_PERIOD_MONTHS[recurrence]
  const diff = monthIndex0 - anchor
  return ((diff % period) + period) % period === 0
}

/**
 * Data de vencimento da ocorrência em um mês específico, ou null quando o mês
 * não é de ocorrência (ou a obrigação é eventual / dia útil inexistente).
 */
export function computeDueDate(
  rule: ObligationRule,
  year: number,
  monthIndex0: number,
  extraHolidays: Iterable<string> = [],
): string | null {
  if (!isOccurrenceMonth(rule, year, monthIndex0)) return null
  if (rule.dueRule === 'dia_fixo') {
    if (!isInt(rule.diaFixo)) return null
    const day = Math.min(rule.diaFixo, lastDayOfMonth(year, monthIndex0))
    return `${year}-${String(monthIndex0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  if (rule.dueRule === 'dia_util') {
    if (!isInt(rule.diaUtil)) return null
    return nthBusinessDayOfMonth(year, monthIndex0, rule.diaUtil, extraHolidays)
  }
  return null
}

/** Próxima ocorrência a partir de `fromDateStr` (inclusivo), ou null se eventual. */
export function nextDueDate(
  rule: ObligationRule,
  fromDateStr: string,
  extraHolidays: Iterable<string> = [],
  maxMonths = 36,
): string | null {
  if (rule.recurrence === 'eventual') return null
  const holidays = [...extraHolidays]
  const start = dateOnlyToUtc(fromDateStr)
  for (let i = 0; i < maxMonths; i += 1) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
    const year = cursor.getUTCFullYear()
    const monthIndex0 = cursor.getUTCMonth()
    const due = computeDueDate(rule, year, monthIndex0, holidays)
    if (due && due >= fromDateStr) return due
  }
  return null
}

/**
 * Usado pelo agendador diário: se hoje + antecedência cai exatamente em uma
 * ocorrência, retorna a data de vencimento; caso contrário, null.
 */
export function notificationDueDate(
  rule: ObligationRule,
  todayStr: string,
  extraHolidays: Iterable<string> = [],
): string | null {
  if (rule.recurrence === 'eventual') return null
  const target = addDays(todayStr, rule.antecedenciaNotificacaoDias)
  const utc = dateOnlyToUtc(target)
  const due = computeDueDate(rule, utc.getUTCFullYear(), utc.getUTCMonth(), [...extraHolidays])
  return due === target ? due : null
}

/** Texto legível da regra, exibido no formulário e na matriz. */
export function describeObligationRule(
  rule: Pick<ObligationRule, 'recurrence' | 'dueRule' | 'diaFixo' | 'diaUtil' | 'mesReferencia'>,
): string {
  const { recurrence, dueRule, diaFixo, diaUtil, mesReferencia } = rule
  if (recurrence === 'eventual') return 'Eventual (sem vencimento automático)'
  const period = RECURRENCE_LABELS[recurrence].toLowerCase()
  const monthLabel =
    isInt(mesReferencia) && mesReferencia >= 1 && mesReferencia <= 12
      ? (MONTH_LABELS[mesReferencia - 1]?.toLowerCase() ?? null)
      : null
  let when: string
  if (recurrence === 'mensal') when = 'todo mês'
  else if (recurrence === 'anual') when = monthLabel ? `todo ano em ${monthLabel}` : 'todo ano'
  else
    when = monthLabel
      ? `a cada ${RECURRENCE_PERIOD_MONTHS[recurrence as 'bimestral' | 'trimestral' | 'semestral']} meses a partir de ${monthLabel}`
      : period
  if (dueRule === 'dia_fixo' && isInt(diaFixo)) {
    return `${when} · dia ${diaFixo}`
  }
  if (dueRule === 'dia_util' && isInt(diaUtil)) {
    return `${when} · ${diaUtil}º dia útil`
  }
  return when
}

/** Hoje (date-only local). Exportado para conveniência/testes. */
export function todayStr(now: Date = new Date()): string {
  return toDateOnly(now)
}
