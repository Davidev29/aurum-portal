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
        'mb-6 flex flex-wrap items-start justify-between gap-4 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] px-5 py-5 shadow-[var(--pv-shadow)] sm:px-6',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3.5">
        {icon ? (
          <div className="pv-anim-check-pop mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--pv-accent-solid)] text-[var(--pv-on-accent)] shadow-md">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <div className="pv-eyebrow mb-1">{eyebrow}</div> : null}
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em] text-[var(--pv-text)]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--pv-muted)]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
