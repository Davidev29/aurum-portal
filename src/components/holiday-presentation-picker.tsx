'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import type { ExtraHolidayIcon } from '@shared/holidays'
import { EXTRA_HOLIDAY_COLORS, HOLIDAY_ICON_OPTIONS } from '@/lib/holiday-meta'
import { cn } from '@/lib/utils'

/**
 * Seletor de apresentação (ícone + cor) para feriados. Usado tanto no
 * cadastro em Configurações quanto na criação rápida a partir do calendário.
 */
export function HolidayPresentationPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: ExtraHolidayIcon
  color: string
  onIconChange: (icon: ExtraHolidayIcon) => void
  onColorChange: (color: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <fieldset>
        <legend className="text-[11px] font-bold uppercase tracking-wide text-[var(--pv-muted)]">
          Ícone
        </legend>
        <div
          className="mt-1.5 flex flex-wrap gap-1"
          role="radiogroup"
          aria-label="Ícone do feriado"
        >
          {HOLIDAY_ICON_OPTIONS.map(({ key, label, Icon }) => {
            const selected = key === icon
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                title={label}
                aria-label={`Ícone ${label}`}
                onClick={() => onIconChange(key)}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg border transition-[background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-brand-600/30',
                  selected
                    ? 'border-[var(--pv-accent-solid)] bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] shadow-sm'
                    : 'border-[var(--pv-border)] text-[var(--pv-muted)] hover:border-[var(--pv-accent)] hover:text-[var(--pv-accent)]',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-[11px] font-bold uppercase tracking-wide text-[var(--pv-muted)]">
          Cor
        </legend>
        <div
          className="mt-1.5 flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-label="Cor do feriado"
        >
          {EXTRA_HOLIDAY_COLORS.map((swatch) => {
            const selected = swatch.toLowerCase() === color.toLowerCase()
            return (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={selected}
                title={swatch}
                aria-label={`Cor ${swatch}`}
                onClick={() => onColorChange(swatch)}
                style={{ backgroundColor: swatch }}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg border-2 transition-[background-color,border-color,color] duration-150 focus-visible:ring-2 focus-visible:ring-brand-600/30',
                  selected
                    ? 'scale-110 border-[var(--pv-text)] shadow-md'
                    : 'border-transparent hover:scale-105',
                )}
              >
                {selected ? (
                  <Check
                    className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
                    strokeWidth={3.5}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-[var(--pv-faint)]">
          A cor aparece no calendário e na lista de feriados.
        </p>
      </fieldset>
    </div>
  )
}
