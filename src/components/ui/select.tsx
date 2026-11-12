import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className="flex h-10 w-full appearance-none rounded-[var(--pv-radius-control)] border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] pl-3.5 pr-10 text-sm text-[var(--pv-text)] transition-[border-color,box-shadow] duration-150 ease hover:border-[var(--pv-accent-solid)] focus-visible:border-[var(--pv-accent-solid)] focus-visible:ring-2 focus-visible:ring-brand-600/25 disabled:cursor-not-allowed disabled:opacity-60"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)] transition-transform duration-200 ease-[var(--pv-ease-out-expo)] peer-hover:rotate-180"
      />
    </div>
  )
})
Select.displayName = 'Select'

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-[var(--pv-border)]', className)} role="separator" />
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-[var(--pv-panel-3)]', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <div
        className="h-full rounded-full bg-[var(--pv-accent)] transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
