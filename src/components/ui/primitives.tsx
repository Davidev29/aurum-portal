import * as React from 'react'
import { cn } from '@/lib/utils'

/** Avatar com iniciais — cor determinística por nome. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
  const sizes = {
    sm: 'h-9 w-9 text-[11px]',
    md: 'h-11 w-11 text-xs',
    lg: 'h-16 w-16 text-lg',
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-[var(--pv-accent-solid)] font-bold text-[var(--pv-on-accent)] shadow-sm ring-2 ring-[var(--pv-border)]',
        sizes[size],
        className,
      )}
      aria-hidden="true"
    >
      {initials || '•'}
    </div>
  )
}

/** Cartão de métrica reutilizável. */
export function StatCard({
  label,
  value,
  icon,
  tone = 'brand',
  hint,
  className,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'teal'
  hint?: string
  className?: string
}) {
  const tones: Record<string, string> = {
    brand:
      'bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] border border-[var(--pv-accent-soft-border)]',
    success:
      'bg-[var(--pv-success-soft)] text-[var(--pv-success)] border border-[var(--pv-success-border)]',
    warning:
      'bg-[var(--pv-warning-soft)] text-[var(--pv-warning)] border border-[var(--pv-warning-border)]',
    danger:
      'bg-[var(--pv-danger-soft)] text-[var(--pv-danger)] border border-[var(--pv-danger-border)]',
    teal: 'bg-[color-mix(in_srgb,var(--pv-accent-2)_12%,transparent)] text-[var(--pv-accent-2)] border border-[color-mix(in_srgb,var(--pv-accent-2)_30%,transparent)]',
  }
  const valueTones: Record<string, string> = {
    brand: '',
    success: 'text-[var(--pv-text)]',
    warning: 'text-[var(--pv-text)]',
    danger: 'text-[var(--pv-danger)]',
    teal: '',
  }
  return (
    <div
      className={cn(
        'pv-lift flex items-center gap-3.5 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-4 shadow-[var(--pv-shadow)]',
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
            tones[tone],
          )}
        >
          {icon}
        </div>
      ) : null}
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-[var(--pv-muted)]">{label}</div>
        <div
          className={cn(
            'mt-0.5 text-[22px] font-bold leading-none tracking-tight',
            valueTones[tone],
          )}
        >
          {value}
        </div>
        {hint ? <div className="mt-1 text-[11px] text-[var(--pv-faint)]">{hint}</div> : null}
      </div>
    </div>
  )
}

/** Barra de busca + filtros em superfície elevada. */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-wrap items-center gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Título de seção com ação opcional à direita. */
export function SectionTitle({
  title,
  hint,
  action,
  className,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center justify-between gap-2', className)}>
      <div>
        <h3 className="pv-eyebrow">{title}</h3>
        {hint ? <p className="mt-1 text-xs text-[var(--pv-faint)]">{hint}</p> : null}
      </div>
      {action}
    </div>
  )
}

/** Skeleton de grade. */
export function SkeletonGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="pv-skeleton h-52 rounded-[var(--pv-radius)] border border-[var(--pv-border)]"
        />
      ))}
    </div>
  )
}

/** Skeleton de tabela. */
export function SkeletonTable() {
  return (
    <div
      className="pv-skeleton h-64 rounded-[var(--pv-radius)] border border-[var(--pv-border)]"
      aria-hidden="true"
    />
  )
}
