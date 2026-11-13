'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Coffee,
  FileText,
  Flag,
  Loader2,
  Plus,
  Search,
} from 'lucide-react'
import type { ObligationMonthItem } from '@shared/types'
import { MONTH_LABELS } from '@shared/obligation-rules'
import {
  formatDateBr,
  getNationalHolidays,
  lastDayOfMonth,
  toDateOnly,
  EXTRA_HOLIDAY_COLOR_DEFAULT,
  EXTRA_HOLIDAY_ICON_DEFAULT,
  NATIONAL_HOLIDAY_PRESENTATION,
  type ExtraHolidayIcon,
} from '@shared/holidays'
import { holidayColorOf, holidayIconOf, type DayHoliday } from '@/lib/holiday-meta'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useHolidays, useMonthOverview, useObligationsInvalidate } from '@/lib/obligations-queries'
import { useSettings } from '@/lib/queries'
import { generateObligationsMonthReport } from '@/lib/pdf/obligation-reports'
import { saveReportPdf } from '@/lib/pdf/save-report'
import { cn, formatDocumentMasked } from '@/lib/utils'
import { Avatar } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { HolidayPresentationPicker } from '@/components/holiday-presentation-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
const WEEKDAY_FULL = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const

interface MonthCursor {
  year: number
  monthIndex0: number
}

interface ClientGroup {
  clientId: string
  clientName: string
  clientDocument: string
  items: ObligationMonthItem[]
  datedCount: number
  deliveredCount: number
}

function monthKeyOf(cursor: MonthCursor): string {
  return `${cursor.year}-${String(cursor.monthIndex0 + 1).padStart(2, '0')}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Estado do vencimento para exibição (pendente / vence hoje / atrasada / entregue). */
function dueStatus(item: ObligationMonthItem, today: string) {
  if (item.delivered) return 'delivered' as const
  if (!item.dueDate) return 'eventual' as const
  if (item.dueDate < today) return 'overdue' as const
  if (item.dueDate === today) return 'due-today' as const
  return 'pending' as const
}

export function ObligationsMonthView() {
  const invalidate = useObligationsInvalidate()
  // Página estática (output: export): só monta o conteúdo real no cliente para
  // evitar divergência de hidratação nas datas.
  const [cursor, setCursor] = React.useState<MonthCursor | null>(null)
  const [today, setToday] = React.useState<string | null>(null)

  React.useEffect(() => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), monthIndex0: now.getMonth() })
    setToday(toDateOnly(now))
  }, [])

  const monthKey = cursor ? monthKeyOf(cursor) : null
  const { data: items, isLoading, isPlaceholderData } = useMonthOverview(monthKey)
  const { data: extraHolidays } = useHolidays()
  const { data: settings } = useSettings()
  const [exporting, setExporting] = React.useState(false)

  const [search, setSearch] = React.useState('')
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null)
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)

  /* ---------------- Dados derivados ---------------- */

  const itemsByDay = React.useMemo(() => {
    const map = new Map<string, ObligationMonthItem[]>()
    for (const item of items ?? []) {
      if (!item.dueDate) continue
      const list = map.get(item.dueDate) ?? []
      list.push(item)
      map.set(item.dueDate, list)
    }
    return map
  }, [items])

  const stats = React.useMemo(() => {
    const dated = (items ?? []).filter((item) => item.dueDate !== null)
    const delivered = dated.filter((item) => item.delivered).length
    const overdue = today
      ? dated.filter((item) => !item.delivered && item.dueDate! < today).length
      : 0
    return {
      total: dated.length,
      delivered,
      pending: dated.length - delivered,
      overdue,
    }
  }, [items, today])

  const groups = React.useMemo(() => {
    const byClient = new Map<string, ClientGroup>()
    for (const item of items ?? []) {
      const group = byClient.get(item.clientId) ?? {
        clientId: item.clientId,
        clientName: item.clientName,
        clientDocument: item.clientDocument,
        items: [],
        datedCount: 0,
        deliveredCount: 0,
      }
      group.items.push(item)
      if (item.dueDate) group.datedCount += 1
      if (item.delivered) group.deliveredCount += 1
      byClient.set(item.clientId, group)
    }
    const needle = search.trim().toLowerCase()
    const needleDigits = needle.replace(/\D+/g, '')
    return [...byClient.values()]
      .filter((group) => {
        if (!needle) return true
        if (group.clientName.toLowerCase().includes(needle)) return true
        if (needleDigits.length > 0 && group.clientDocument.includes(needleDigits)) return true
        return false
      })
      .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR'))
  }, [items, search])

  const holidaysByDate = React.useMemo(() => {
    const baseYear = cursor?.year ?? new Date().getFullYear()
    const map = new Map<string, DayHoliday>()
    for (const year of [baseYear - 1, baseYear, baseYear + 1]) {
      for (const holiday of getNationalHolidays(year)) {
        const preset =
          NATIONAL_HOLIDAY_PRESENTATION[holiday.facultative ? 'facultative' : 'official']
        map.set(holiday.date, {
          name: holiday.name,
          icon: preset.icon,
          color: preset.color,
          custom: false,
        })
      }
    }
    for (const holiday of extraHolidays ?? []) {
      map.set(holiday.date, {
        name: holiday.name,
        icon: holiday.icon ?? EXTRA_HOLIDAY_ICON_DEFAULT,
        color: holidayColorOf(holiday.color),
        custom: true,
      })
    }
    return map
  }, [cursor?.year, extraHolidays])

  const calendarCells = React.useMemo(() => {
    if (!cursor) return []
    const { year, monthIndex0 } = cursor
    const daysInMonth = lastDayOfMonth(year, monthIndex0)
    const firstWeekday = new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay()
    const prevYear = monthIndex0 === 0 ? year - 1 : year
    const prevMonthIndex0 = monthIndex0 === 0 ? 11 : monthIndex0 - 1
    const daysInPrev = lastDayOfMonth(prevYear, prevMonthIndex0)
    const cells: Array<{ date: string; day: number; inMonth: boolean }> = []
    for (let i = firstWeekday - 1; i >= 0; i -= 1) {
      const date = `${prevYear}-${pad2(prevMonthIndex0 + 1)}-${pad2(daysInPrev - i)}`
      cells.push({ date, day: daysInPrev - i, inMonth: false })
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: `${year}-${pad2(monthIndex0 + 1)}-${pad2(day)}`, day, inMonth: true })
    }
    const trailing = (7 - (cells.length % 7)) % 7
    const nextYear = monthIndex0 === 11 ? year + 1 : year
    const nextMonthIndex0 = monthIndex0 === 11 ? 0 : monthIndex0 + 1
    for (let day = 1; day <= trailing; day += 1) {
      cells.push({
        date: `${nextYear}-${pad2(nextMonthIndex0 + 1)}-${pad2(day)}`,
        day,
        inMonth: false,
      })
    }
    return cells
  }, [cursor])

  const selectedDayItems = React.useMemo(
    () => (selectedDay ? (itemsByDay.get(selectedDay) ?? []) : []),
    [selectedDay, itemsByDay],
  )

  /* ---------------- Ações ---------------- */

  const shiftMonth = (delta: number) => {
    setCursor((current) => {
      if (!current) return current
      const date = new Date(Date.UTC(current.year, current.monthIndex0 + delta, 1))
      return { year: date.getUTCFullYear(), monthIndex0: date.getUTCMonth() }
    })
  }

  const goToToday = () => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), monthIndex0: now.getMonth() })
    setToday(toDateOnly(now))
  }

  const exportPdf = async () => {
    if (!settings) {
      toast.error('Configurações ainda não carregadas. Tente novamente em instantes.')
      return
    }
    if (!cursor || !today) return
    if (groups.length === 0) {
      toast.info('Nada para exportar — nenhum cliente no filtro atual.')
      return
    }
    setExporting(true)
    try {
      const key = monthKeyOf(cursor)
      const result = await generateObligationsMonthReport({
        items: groups.flatMap((group) => group.items),
        monthTitle: `${MONTH_LABELS[cursor.monthIndex0] ?? ''} de ${cursor.year}`,
        filterDescription: search.trim()
          ? `Busca: "${search.trim()}"`
          : 'Todos os clientes com obrigações no mês',
        today,
        settings,
      })
      const saved = await saveReportPdf({
        filename: `obrigacoes-${key}-${result.trackingCode}.pdf`,
        bytes: result.bytes,
        trackingCode: result.trackingCode,
        title: 'Relatorio de Obrigacoes',
      })
      if (saved.path) {
        toast.success(`${result.pageCount} página(s) exportadas em PDF.`, {
          description: `Código de rastreio: ${result.trackingCode}`,
        })
        await invalidate.audit()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  const toggleExpanded = (clientId: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(clientId)) next.delete(clientId)
      else next.add(clientId)
      return next
    })
  }

  const toggleDelivery = async (item: ObligationMonthItem) => {
    if (!item.dueDate) return
    const key = `${item.clientId}|${item.obligationId}|${item.dueDate}`
    setPendingKey(key)
    try {
      const result = await aurumBitPortal().obligations.setDelivery({
        clientId: item.clientId,
        obligationId: item.obligationId,
        dueDate: item.dueDate,
        delivered: !item.delivered,
      })
      invalidate.all()
      toast.success(
        result.delivered
          ? `Baixa registrada — ${item.sigla} · ${item.clientName}.`
          : `Baixa desfeita — ${item.sigla} · ${item.clientName}.`,
      )
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPendingKey(null)
    }
  }

  const handleAddHoliday = async (input: {
    date: string
    name: string
    icon: ExtraHolidayIcon
    color: string
  }) => {
    try {
      await aurumBitPortal().obligations.addHoliday(input)
      invalidate.all()
      toast.success('Feriado adicionado.')
    } catch (error) {
      toast.error(errorMessage(error))
      throw error // mantém o formulário aberto para nova tentativa
    }
  }

  /* ---------------- Render ---------------- */

  if (!cursor || !today) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]" aria-busy="true">
        <div className="h-72 animate-pulse rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel-2)]" />
        <div className="h-96 animate-pulse rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel-2)]" />
      </div>
    )
  }

  const monthTitle = `${MONTH_LABELS[cursor.monthIndex0] ?? ''} de ${cursor.year}`
  const dataCountLabel = `${stats.delivered}/${stats.total} baixadas`

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        {/* ================= Painel esquerdo — empresas ================= */}
        <section
          aria-label="Empresas com obrigações no mês"
          className="flex flex-col overflow-hidden rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)]"
        >
          <div className="space-y-2 border-b border-[var(--pv-border)] p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--pv-muted)]">
                <Building2 className="h-4 w-4" aria-hidden="true" />
                Empresas
              </h2>
              <span className="rounded-full bg-[var(--pv-panel-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--pv-muted)]">
                {groups.length} {groups.length === 1 ? 'empresa' : 'empresas'}
              </span>
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-faint)]"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar empresa…"
                aria-label="Buscar empresa"
                className="pl-9 text-sm"
              />
            </div>
          </div>

          <div className="pv-scroll max-h-[32rem] overflow-y-auto p-2">
            {isLoading && !items ? (
              <p className="px-3 py-8 text-center text-sm text-[var(--pv-muted)]">Carregando…</p>
            ) : groups.length === 0 ? (
              <EmptyState
                icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
                title={search.trim() ? 'Nenhuma empresa encontrada' : 'Sem obrigações neste mês'}
                description={
                  search.trim()
                    ? 'Ajuste a busca para ver as empresas vinculadas.'
                    : 'Vincule clientes às obrigações na matriz — a ocorrência vale a partir da competência do vínculo.'
                }
              />
            ) : (
              <ul className="space-y-1">
                {groups.map((group) => {
                  const isOpen = expanded.has(group.clientId)
                  const panelId = `month-view-client-${group.clientId}`
                  return (
                    <li
                      key={group.clientId}
                      className="overflow-hidden rounded-xl border border-transparent transition-colors hover:border-[var(--pv-border)]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpanded(group.clientId)}
                        aria-expanded={isOpen}
                        aria-controls={panelId}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--pv-panel-2)] focus-visible:ring-2 focus-visible:ring-brand-600/30"
                      >
                        <Avatar name={group.clientName} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold leading-tight">
                            {group.clientName}
                          </span>
                          <span className="text-[10px] font-medium text-[var(--pv-faint)]">
                            {formatDocumentMasked(group.clientDocument)} ·{' '}
                            {group.datedCount > 0
                              ? `${group.deliveredCount}/${group.datedCount} baixadas`
                              : 'Eventual'}
                          </span>
                        </span>
                        <span className="rounded-full bg-[var(--pv-panel-2)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--pv-muted)]">
                          {group.items.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 shrink-0 text-[var(--pv-faint)] transition-transform duration-200',
                            isOpen && 'rotate-180',
                          )}
                          aria-hidden="true"
                        />
                      </button>

                      <div
                        id={panelId}
                        className={cn(
                          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
                          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
                        )}
                      >
                        <div className="overflow-hidden">
                          <ul className="space-y-0.5 border-t border-[var(--pv-border)]/70 p-1.5">
                            {group.items.map((item) => {
                              const status = dueStatus(item, today)
                              const itemKey = `${item.clientId}|${item.obligationId}|${item.dueDate ?? 'eventual'}`
                              const busy = pendingKey === itemKey
                              return (
                                <li key={itemKey}>
                                  <button
                                    type="button"
                                    disabled={!item.dueDate || busy}
                                    onClick={() => void toggleDelivery(item)}
                                    aria-pressed={item.delivered}
                                    title={
                                      item.dueDate
                                        ? item.delivered
                                          ? 'Desfazer baixa'
                                          : 'Dar baixa na entrega'
                                        : 'Obrigação eventual: sem vencimento para baixa'
                                    }
                                    className={cn(
                                      'group/item flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-600/30',
                                      item.dueDate
                                        ? 'hover:bg-[var(--pv-panel-2)]'
                                        : 'cursor-default',
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                                        item.delivered
                                          ? 'border-[var(--pv-success-solid)] bg-[var(--pv-success-solid)] text-white'
                                          : 'border-[var(--pv-border-strong)] bg-transparent group-hover/item:border-[var(--pv-accent)]',
                                        !item.dueDate && 'border-dashed opacity-40',
                                      )}
                                      aria-hidden="true"
                                    >
                                      {item.delivered ? (
                                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                      ) : null}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="flex items-baseline justify-between gap-2">
                                        <span
                                          className={cn(
                                            'truncate text-[12px] font-extrabold tracking-wide',
                                            item.delivered &&
                                              'text-[var(--pv-muted)] line-through decoration-[var(--pv-success)]/60',
                                          )}
                                        >
                                          {item.sigla}
                                        </span>
                                        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--pv-muted)]">
                                          {item.dueDate ? formatDateBr(item.dueDate) : 'Eventual'}
                                        </span>
                                      </span>
                                      <span className="block truncate text-[10px] text-[var(--pv-faint)]">
                                        {item.obligationName} · {item.departmentName}
                                      </span>
                                      <span
                                        className={cn(
                                          'mt-0.5 block text-[9px] font-bold uppercase tracking-wide',
                                          status === 'delivered' && 'text-[var(--pv-success)]',
                                          status === 'overdue' && 'text-[var(--pv-danger)]',
                                          status === 'due-today' && 'text-[var(--pv-warning)]',
                                          (status === 'pending' || status === 'eventual') &&
                                            'text-[var(--pv-faint)]',
                                        )}
                                      >
                                        {status === 'delivered' && 'Entregue'}
                                        {status === 'overdue' && 'Atrasada'}
                                        {status === 'due-today' && 'Vence hoje'}
                                        {status === 'pending' && 'Pendente'}
                                        {status === 'eventual' && 'Sem vencimento'}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* ================= Painel direito — calendário ================= */}
        <section
          aria-label={`Calendário de ${monthTitle}`}
          className="rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4 shadow-[var(--pv-shadow)] sm:p-5"
        >
          {/* Cabeçalho: navegação de mês + resumo */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Mês anterior"
                title="Mês anterior"
                className="pv-icon-btn flex h-9 w-9 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)]"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <h2 className="min-w-44 text-center text-base font-extrabold tracking-tight">
                {monthTitle}
              </h2>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Próximo mês"
                title="Próximo mês"
                className="pv-icon-btn flex h-9 w-9 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)]"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <Button variant="secondary" size="sm" onClick={goToToday}>
              Hoje
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void exportPdf()}
              disabled={exporting || !settings}
              title="Exportar checklist de obrigações do mês (PDF timbrado)"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {exporting ? 'Gerando…' : 'Exportar PDF'}
            </Button>
            <div
              className={cn(
                'ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-[var(--pv-muted)] transition-opacity',
                isPlaceholderData && 'opacity-50',
              )}
              aria-live="polite"
            >
              <ClipboardCheck className="h-4 w-4 text-[var(--pv-accent)]" aria-hidden="true" />
              <span className="tabular-nums">{dataCountLabel} no mês</span>
              {stats.pending > 0 ? (
                <span className="tabular-nums">
                  · <strong className="text-[var(--pv-text)]">{stats.pending}</strong> pendente(s)
                </span>
              ) : null}
              {stats.overdue > 0 ? (
                <span className="font-bold text-[var(--pv-danger)]">
                  · {stats.overdue} atrasada(s)
                </span>
              ) : null}
            </div>
          </div>

          {/* Dias da semana */}
          <div className="mt-4 grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--pv-faint)]"
              >
                {label}
              </div>
            ))}
          </div>

          {/* Grade de dias */}
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((cell) => {
              const dayItems = itemsByDay.get(cell.date) ?? []
              const count = dayItems.length
              const delivered = dayItems.filter((item) => item.delivered).length
              const isToday = cell.date === today
              const holiday = holidaysByDate.get(cell.date)
              const HolidayIcon = holiday ? holidayIconOf(holiday.icon) : null
              const allDelivered = count > 0 && delivered === count
              const hasOverdue =
                count > 0 && dayItems.some((item) => !item.delivered && item.dueDate! < today)

              const content = (
                <>
                  <span className="flex items-start justify-between gap-1">
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
                        isToday && 'bg-[var(--pv-accent-solid)] text-[var(--pv-on-accent)]',
                        !isToday && cell.inMonth && 'text-[var(--pv-text)]',
                        !cell.inMonth && 'text-[var(--pv-faint)]/60',
                      )}
                    >
                      {cell.day}
                    </span>
                    {HolidayIcon && holiday ? (
                      <HolidayIcon
                        className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', !cell.inMonth && 'opacity-45')}
                        style={{ color: holiday.color }}
                        role="img"
                        aria-label={`Feriado: ${holiday.name}`}
                      />
                    ) : null}
                  </span>
                  {count > 0 ? (
                    <span
                      className={cn(
                        'mt-auto inline-flex w-fit items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums leading-none',
                        allDelivered &&
                          'border-[var(--pv-success-border)] bg-[var(--pv-success-soft)] text-[var(--pv-success)]',
                        !allDelivered &&
                          hasOverdue &&
                          'border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] text-[var(--pv-danger)]',
                        !allDelivered &&
                          !hasOverdue &&
                          'border-[var(--pv-warning-border)] bg-[var(--pv-warning-soft)] text-[var(--pv-warning)]',
                      )}
                    >
                      {allDelivered ? (
                        <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden="true" />
                      ) : null}
                      {count}
                    </span>
                  ) : null}
                </>
              )

              const cellClass = cn(
                'flex min-h-16 flex-col rounded-xl border p-1.5 text-left transition-[background-color,border-color,box-shadow] sm:min-h-20',
                cell.inMonth
                  ? 'cursor-pointer border-[var(--pv-border)]/70 bg-[var(--pv-panel-2)]/40 hover:border-[var(--pv-accent)] hover:bg-[var(--pv-panel-2)] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-brand-600/30'
                  : 'border-transparent bg-transparent',
                count > 0 && cell.inMonth && 'border-[var(--pv-border-strong)]',
                isToday && 'ring-1 ring-[var(--pv-accent)]',
              )

              const dayAriaLabel =
                count > 0
                  ? `${count} ${count === 1 ? 'obrigação' : 'obrigações'} em ${formatDateBr(cell.date)} — abrir baixa do dia`
                  : `Nenhuma obrigação em ${formatDateBr(cell.date)} — abrir o dia`

              return cell.inMonth ? (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDay(cell.date)}
                  title={holiday ? `Feriado: ${holiday.name}` : undefined}
                  aria-label={holiday ? `${dayAriaLabel} · Feriado: ${holiday.name}` : dayAriaLabel}
                  className={cellClass}
                >
                  {content}
                </button>
              ) : (
                <div key={cell.date} aria-hidden="true" className={cellClass} title={holiday?.name}>
                  {content}
                </div>
              )
            })}
          </div>

          {/* Legenda */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-medium text-[var(--pv-faint)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--pv-warning)]" aria-hidden="true" />
              Pendente de baixa
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--pv-danger)]" aria-hidden="true" />
              Atrasada
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-[var(--pv-success)]" aria-hidden="true" />
              Todas baixadas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Flag className="h-3 w-3 text-[#b91c1c]" aria-hidden="true" />
              Feriado (cor personalizada nos extras)
            </span>
            <span className="ml-auto">
              Clique em qualquer dia para ver ou adicionar feriados e dar baixa.
            </span>
          </div>
        </section>
      </div>

      <p className="text-xs text-[var(--pv-faint)]">
        Vínculos valem a partir da competência em que foram criados: se o vencimento do mês já
        passou pela data de início, a obrigação só conta a partir do mês seguinte. Obrigações
        eventuais não têm vencimento (sem baixa).
      </p>

      {/* ================= Modal do dia — baixa e feriados ================= */}
      <DayDeliveryDialog
        day={selectedDay}
        items={selectedDayItems}
        holiday={selectedDay ? (holidaysByDate.get(selectedDay) ?? null) : null}
        pendingKey={pendingKey}
        onToggle={toggleDelivery}
        onAddHoliday={handleAddHoliday}
        onClose={() => setSelectedDay(null)}
      />
    </div>
  )
}

function DayDeliveryDialog({
  day,
  items,
  holiday,
  pendingKey,
  onToggle,
  onAddHoliday,
  onClose,
}: {
  day: string | null
  items: ObligationMonthItem[]
  holiday: DayHoliday | null
  pendingKey: string | null
  onToggle: (item: ObligationMonthItem) => void
  onAddHoliday: (input: {
    date: string
    name: string
    icon: ExtraHolidayIcon
    color: string
  }) => Promise<void>
  onClose: () => void
}) {
  const deliveredCount = items.filter((item) => item.delivered).length
  const total = items.length
  const percent = total === 0 ? 0 : Math.round((deliveredCount / total) * 100)

  const [holidayFormOpen, setHolidayFormOpen] = React.useState(false)
  const [holidayName, setHolidayName] = React.useState('')
  const [holidayIcon, setHolidayIcon] = React.useState<ExtraHolidayIcon>(EXTRA_HOLIDAY_ICON_DEFAULT)
  const [holidayColor, setHolidayColor] = React.useState<string>(EXTRA_HOLIDAY_COLOR_DEFAULT)
  const [savingHoliday, setSavingHoliday] = React.useState(false)

  React.useEffect(() => {
    setHolidayFormOpen(false)
    setHolidayName('')
    setHolidayIcon(EXTRA_HOLIDAY_ICON_DEFAULT)
    setHolidayColor(EXTRA_HOLIDAY_COLOR_DEFAULT)
    setSavingHoliday(false)
  }, [day])

  const submitHoliday = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = holidayName.trim()
    if (!day || !name) return
    setSavingHoliday(true)
    try {
      await onAddHoliday({ date: day, name, icon: holidayIcon, color: holidayColor })
      setHolidayFormOpen(false)
      setHolidayName('')
    } catch {
      // O pai exibe o toast de erro; o formulário fica aberto para nova tentativa.
    } finally {
      setSavingHoliday(false)
    }
  }

  const title = day
    ? (() => {
        const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
        const dateObj = new Date(year, month - 1, date, 12)
        const weekday = WEEKDAY_FULL[dateObj.getDay()] ?? ''
        return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${formatDateBr(day)}`
      })()
    : ''

  const HolidayIcon = holiday ? holidayIconOf(holiday.icon) : null

  return (
    <Dialog
      open={day !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {total === 0
              ? holiday
                ? 'Nenhuma obrigação vence neste dia — é feriado.'
                : 'Nenhuma empresa com vencimento neste dia.'
              : `${deliveredCount} de ${total} obrigaç${total === 1 ? 'ão' : 'ões'} baixada${
                  total === 1 ? '' : 's'
                }. Marque o check para dar baixa na entrega.`}
          </DialogDescription>
        </DialogHeader>

        {holiday && HolidayIcon ? (
          <div
            className="flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5"
            style={{
              borderColor: `color-mix(in srgb, ${holiday.color} 55%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${holiday.color} 10%, transparent)`,
            }}
            role="status"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: holiday.color }}
            >
              <HolidayIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span
                className="block truncate text-[13px] font-bold"
                style={{ color: holiday.color }}
              >
                {holiday.name}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--pv-muted)]">
                {holiday.custom ? 'Cadastrado por você' : 'Feriado nacional'} · dia não útil
              </span>
            </span>
            <span
              className="ml-auto shrink-0 text-[10px] font-extrabold uppercase tracking-[0.14em]"
              style={{ color: holiday.color }}
            >
              Feriado
            </span>
          </div>
        ) : null}

        {total > 0 ? (
          <div
            className="h-2 overflow-hidden rounded-full bg-[var(--pv-panel-2)]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progresso das baixas do dia"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-300',
                percent === 100 ? 'bg-[var(--pv-success)]' : 'bg-[var(--pv-accent-solid)]',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}

        <div className="pv-scroll -mx-1 max-h-[52vh] overflow-y-auto px-1">
          {total === 0 ? (
            holidayFormOpen ? (
              <form
                onSubmit={(event) => void submitHoliday(event)}
                className="space-y-3 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)]/40 p-4"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--pv-muted)]">
                  Novo feriado em {day ? formatDateBr(day) : ''}
                </p>
                <Input
                  value={holidayName}
                  onChange={(event) => setHolidayName(event.target.value)}
                  placeholder="Ex.: Aniversário da cidade"
                  aria-label="Nome do feriado"
                  maxLength={120}
                  autoFocus
                />
                <HolidayPresentationPicker
                  icon={holidayIcon}
                  color={holidayColor}
                  onIconChange={setHolidayIcon}
                  onColorChange={setHolidayColor}
                />
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setHolidayFormOpen(false)}
                    disabled={savingHoliday}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={savingHoliday || holidayName.trim().length === 0}
                  >
                    {savingHoliday ? 'Adicionando…' : 'Adicionar feriado'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-[var(--pv-border-strong)] px-6 py-9 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--pv-success-soft)] text-[var(--pv-success)]">
                  <Coffee className="h-7 w-7" aria-hidden="true" />
                </span>
                <p className="text-[17px] font-extrabold tracking-tight">
                  Tudo tranquilo neste dia
                </p>
                <p className="max-w-sm text-xs leading-relaxed text-[var(--pv-muted)]">
                  {holiday
                    ? 'Feriado não útil — nenhuma obrigação vence nesta data. Aproveite!'
                    : 'Nenhuma obrigação vence nesta data. É um bom dia para adiantar entregas ou planejar o mês.'}
                </p>
                {!holiday ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="mt-1"
                    onClick={() => setHolidayFormOpen(true)}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Adicionar feriado
                  </Button>
                ) : null}
              </div>
            )
          ) : (
            <ul className="divide-y divide-[var(--pv-border)] overflow-hidden rounded-xl border border-[var(--pv-border)]">
              {items.map((item) => {
                const key = `${item.clientId}|${item.obligationId}|${item.dueDate}`
                const busy = pendingKey === key
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => onToggle(item)}
                      disabled={busy}
                      aria-pressed={item.delivered}
                      title={item.delivered ? 'Desfazer baixa' : 'Dar baixa na entrega'}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--pv-panel-2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/30 disabled:opacity-60"
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
                          item.delivered
                            ? 'border-[var(--pv-success-solid)] bg-[var(--pv-success-solid)] text-white'
                            : 'border-[var(--pv-border-strong)] bg-transparent',
                        )}
                        aria-hidden="true"
                      >
                        {item.delivered ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold leading-tight">
                          {item.clientName}
                        </span>
                        <span className="text-[10px] font-medium text-[var(--pv-faint)]">
                          {formatDocumentMasked(item.clientDocument)}
                        </span>
                      </span>
                      <span className="min-w-0 max-w-56 text-right">
                        <span
                          className={cn(
                            'block text-[12px] font-extrabold tracking-wide',
                            item.delivered && 'text-[var(--pv-muted)] line-through',
                          )}
                        >
                          {item.sigla}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--pv-faint)]">
                          {item.obligationName} · {item.departmentName}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <span className="mr-auto self-center text-[11px] text-[var(--pv-faint)]">
            {total > 0
              ? 'A baixa vale apenas para a competência deste vencimento.'
              : 'Feriados ganham ícone e cor no calendário.'}
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
