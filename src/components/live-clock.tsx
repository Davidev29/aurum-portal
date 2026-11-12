'use client'

import * as React from 'react'
import { Clock } from 'lucide-react'

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * Relógio ao vivo para a barra superior: ícone de relógio, data e hora local.
 * Renderiza um placeholder estável no SSR para evitar divergência de hidratação;
 * o horário real aparece após a montagem no cliente e atualiza a cada segundo.
 */
export function LiveClock() {
  const [now, setNow] = React.useState<Date | null>(null)

  React.useEffect(() => {
    const tick = () => setNow(new Date())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  const timeLabel = now ? timeFormatter.format(now) : '--:--:--'
  const dateLabel = now ? dateFormatter.format(now) : '—'

  return (
    <div
      className="pointer-events-none hidden select-none items-center gap-2.5 rounded-full border border-[var(--pv-border)] bg-[var(--pv-panel)] py-1.5 pl-1.5 pr-4 xl:flex"
      role="timer"
      aria-label="Data e hora atuais"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] ring-1 ring-[var(--pv-accent-soft-border)]">
        <Clock className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="flex flex-col leading-none">
        <time
          dateTime={now?.toISOString()}
          className="pv-num text-[13px] font-semibold tabular-nums tracking-tight text-[var(--pv-text)]"
        >
          {timeLabel}
        </time>
        <span className="mt-1 text-[10px] font-semibold capitalize leading-none text-[var(--pv-muted)]">
          {dateLabel}
        </span>
      </span>
    </div>
  )
}
