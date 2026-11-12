import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold leading-none tracking-[0.01em] transition-transform duration-150 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
  {
    variants: {
      variant: {
        default:
          'border-[var(--pv-accent-soft-border-strong,var(--pv-accent-soft-border))] bg-[var(--pv-accent-soft)] text-[var(--pv-accent)]',
        secondary: 'border-[var(--pv-border)] bg-[var(--pv-panel-2)] text-[var(--pv-muted)]',
        success:
          'border-[var(--pv-success-border)] bg-[var(--pv-success-soft)] text-[var(--pv-success)]',
        warning:
          'border-[var(--pv-warning-border)] bg-[var(--pv-warning-soft)] text-[var(--pv-warning)]',
        danger:
          'border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] text-[var(--pv-danger)] font-bold',
        info: 'border-[var(--pv-info-border)] bg-[var(--pv-info-soft)] text-[var(--pv-info)]',
        teal: 'border-[color-mix(in_srgb,var(--pv-accent-2)_30%,transparent)] bg-[color-mix(in_srgb,var(--pv-accent-2)_12%,transparent)] text-[var(--pv-accent-2)]',
        outline: 'border-[var(--pv-border)] bg-transparent text-[var(--pv-muted)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
