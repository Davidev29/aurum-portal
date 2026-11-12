import * as React from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  actions,
  icon,
  eyebrow,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  icon?: React.ReactNode
  eyebrow?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--pv-radius-panel)] border border-[var(--pv-border)] bg-[var(--pv-panel)] px-5 py-4 shadow-[var(--pv-shadow)]',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--pv-radius-control)] border border-[var(--pv-accent-soft-border)] bg-[var(--pv-accent-soft)] text-[var(--pv-accent)]">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <div className="pv-eyebrow mb-0.5">{eyebrow}</div> : null}
          <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.02em] text-[var(--pv-text)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--pv-muted)]">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
