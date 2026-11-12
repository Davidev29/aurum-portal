import * as React from 'react'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'pv-anim-slide-up flex flex-col items-center justify-center gap-4 rounded-[var(--pv-radius)] border border-dashed border-[var(--pv-border-strong)] bg-[var(--pv-panel)]/60 px-6 py-16 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="pv-anim-pop flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] shadow-sm ring-1 ring-[var(--pv-accent-soft-border)]">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-[var(--pv-muted)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  )
}
