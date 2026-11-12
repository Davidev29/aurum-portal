'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { CalendarDays, Plus, Trash2 } from 'lucide-react'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useHolidays, useObligationsInvalidate } from '@/lib/obligations-queries'
import {
  formatDateBr,
  getNationalHolidays,
  EXTRA_HOLIDAY_COLOR_DEFAULT,
  EXTRA_HOLIDAY_ICON_DEFAULT,
  NATIONAL_HOLIDAY_PRESENTATION,
  type ExtraHolidayIcon,
} from '@shared/holidays'
import { holidayColorOf, holidayIconOf } from '@/lib/holiday-meta'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HolidayPresentationPicker } from '@/components/holiday-presentation-picker'

/**
 * Feriados extras (municipais/estaduais/facultativos locais) usados no
 * cálculo do N-ésimo dia útil e nos avisos de vencimento das obrigações.
 * Cada feriado extra tem ícone e cor próprios, exibidos no calendário do
 * módulo de Obrigações. Os nacionais são calculados automaticamente.
 */
export function HolidaysCard() {
  const invalidate = useObligationsInvalidate()
  const { data: holidays, isLoading } = useHolidays()
  const [date, setDate] = React.useState('')
  const [name, setName] = React.useState('')
  const [icon, setIcon] = React.useState<ExtraHolidayIcon>(EXTRA_HOLIDAY_ICON_DEFAULT)
  const [color, setColor] = React.useState<string>(EXTRA_HOLIDAY_COLOR_DEFAULT)
  const [saving, setSaving] = React.useState(false)

  const nationalPreview = React.useMemo(() => {
    const year = new Date().getFullYear()
    return getNationalHolidays(year)
  }, [])

  const resetForm = () => {
    setDate('')
    setName('')
    setIcon(EXTRA_HOLIDAY_ICON_DEFAULT)
    setColor(EXTRA_HOLIDAY_COLOR_DEFAULT)
  }

  const add = async () => {
    if (!date || !name.trim()) {
      toast.warning('Informe a data e o nome do feriado.')
      return
    }
    setSaving(true)
    try {
      await aurumBitPortal().obligations.addHoliday({ date, name: name.trim(), icon, color })
      invalidate.all()
      resetForm()
      toast.success('Feriado adicionado.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await aurumBitPortal().obligations.removeHoliday(id)
      invalidate.all()
      toast.success('Feriado removido.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--pv-accent-soft-border)] bg-[var(--pv-accent-soft)] text-[var(--pv-accent)]">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold tracking-tight">Feriados e dias não úteis</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--pv-muted)]">
            Feriados nacionais já são calculados automaticamente (incluindo Carnaval, Sexta-feira da
            Paixão e Corpus Christi). Adicione abaixo feriados municipais, estaduais ou facultativos
            da sua praça — com ícone e cor próprios, eles valem para o cálculo do N-ésimo dia útil,
            para os avisos de vencimento e para o calendário de Obrigações.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1.5 text-xs font-semibold">
          Data
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-44"
            aria-label="Data do feriado"
          />
        </label>
        <label className="grid min-w-48 flex-1 gap-1.5 text-xs font-semibold">
          Nome
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Aniversário da cidade"
            aria-label="Nome do feriado"
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add()
            }}
          />
        </label>
        <Button size="sm" onClick={() => void add()} disabled={saving}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Adicionando…' : 'Adicionar'}
        </Button>
      </div>
      <HolidayPresentationPicker
        icon={icon}
        color={color}
        onIconChange={setIcon}
        onColorChange={setColor}
      />

      {isLoading ? (
        <p className="text-xs text-[var(--pv-muted)]">Carregando feriados…</p>
      ) : (holidays ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--pv-border-strong)] px-4 py-3 text-xs text-[var(--pv-muted)]">
          Nenhum feriado extra cadastrado.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--pv-border)] rounded-xl border border-[var(--pv-border)]">
          {(holidays ?? []).map((holiday) => {
            const HolidayIcon = holidayIconOf(holiday.icon)
            const colorValue = holidayColorOf(holiday.color)
            return (
              <li key={holiday.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: colorValue }}
                  aria-hidden="true"
                >
                  <HolidayIcon className="h-4 w-4" />
                </span>
                <span className="w-24 shrink-0 font-mono text-xs font-bold text-[var(--pv-muted)]">
                  {formatDateBr(holiday.date)}
                </span>
                <span className="min-w-0 flex-1 truncate">{holiday.name}</span>
                <button
                  type="button"
                  onClick={() => void remove(holiday.id)}
                  title="Remover feriado"
                  aria-label={`Remover ${holiday.name}`}
                  className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-danger-soft)] hover:text-[var(--pv-danger)]"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <details className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-4 py-3 text-xs text-[var(--pv-muted)]">
        <summary className="cursor-pointer font-semibold text-[var(--pv-text)]">
          Ver feriados nacionais calculados para {new Date().getFullYear()}
        </summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {nationalPreview.map((holiday) => {
            const preset =
              NATIONAL_HOLIDAY_PRESENTATION[holiday.facultative ? 'facultative' : 'official']
            const NationalIcon = holidayIconOf(preset.icon)
            return (
              <li key={holiday.date} className="flex items-center gap-2">
                <NationalIcon
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ color: preset.color }}
                  aria-hidden="true"
                />
                <span className="shrink-0 font-mono font-bold">{formatDateBr(holiday.date)}</span>
                <span className="truncate" title={holiday.name}>
                  {holiday.name}
                  {holiday.facultative ? ' (facultativo)' : ''}
                </span>
              </li>
            )
          })}
        </ul>
      </details>
    </Card>
  )
}
