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
        'mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-[var(--pv-radius-panel)] border border-[var(--pv-border)] bg-[var(--pv-panel)] px-4 py-3.5 shadow-[var(--pv-shadow)] sm:mb-6 sm:px-5 sm:py-4',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        {icon ? (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--pv-radius-control)] border border-[var(--pv-accent-soft-border)] bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] sm:h-10 sm:w-10">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <div className="pv-eyebrow mb-0.5">{eyebrow}</div> : null}
          <h1 className="text-[17px] font-semibold leading-tight tracking-[-0.02em] text-[var(--pv-text)] sm:text-[19px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--pv-muted)]">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}
