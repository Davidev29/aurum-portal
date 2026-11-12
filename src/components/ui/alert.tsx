import * as React from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const styles = {
  info: 'border-[var(--pv-info-border)] bg-[var(--pv-info-soft)] text-[var(--pv-info)]',
  warning: 'border-[var(--pv-warning-border)] bg-[var(--pv-warning-soft)] text-[var(--pv-warning)]',
  danger:
    'border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] text-[var(--pv-danger)] font-semibold',
  success: 'border-[var(--pv-success-border)] bg-[var(--pv-success-soft)] text-[var(--pv-success)]',
}

const icons = {
  info: Info,
  warning: AlertTriangle,
  danger: XCircle,
  success: CheckCircle2,
}

export function Alert({
  variant = 'info',
  title,
  children,
  className,
  action,
}: {
  variant?: 'info' | 'warning' | 'danger' | 'success'
  title?: string
  children?: React.ReactNode
  className?: string
  action?: React.ReactNode
}) {
  const Icon = icons[variant]
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn(
        'pv-anim-slide-up rounded-2xl border p-4 text-sm shadow-sm [&_p]:text-[var(--pv-text)]',
        styles[variant],
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 opacity-90" />
        <div className="min-w-0 flex-1 text-[var(--pv-text)]">
          {title ? <div className="font-semibold leading-tight">{title}</div> : null}
          {children ? (
            <div className={cn('leading-relaxed', title && 'mt-0.5')}>{children}</div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  )
}
