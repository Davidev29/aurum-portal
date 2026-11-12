import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'pv-btn group inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--pv-radius-control)] text-sm font-semibold focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--pv-accent-solid)] text-[var(--pv-on-accent)] hover:bg-[var(--pv-accent-solid-hover)] hover:shadow-md focus-visible:ring-brand-600/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pv-bg)] dark:focus-visible:ring-brand-300/50',
        secondary:
          'border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] text-[var(--pv-text)] shadow-sm hover:border-[var(--pv-accent-solid)] hover:text-[var(--pv-accent)] hover:bg-[var(--pv-accent-soft)] focus-visible:ring-brand-500/40 focus-visible:ring-offset-1',
        ghost:
          'pv-icon-btn text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)] focus-visible:ring-brand-500/40',
        outline:
          'border border-[var(--pv-border-strong)] bg-transparent text-[var(--pv-text)] hover:border-[var(--pv-accent)] hover:bg-[var(--pv-accent-soft)] hover:shadow-sm focus-visible:ring-brand-500/40',
        destructive:
          'bg-[var(--pv-danger-solid)] text-white font-semibold shadow-sm hover:brightness-[1.08] hover:shadow-md focus-visible:ring-red-600/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pv-bg)]',
        soft: 'bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] border border-[var(--pv-accent-soft-border)] hover:shadow-sm hover:brightness-[0.98] focus-visible:ring-brand-500/40',
        link: 'pv-btn--link h-auto gap-1 rounded-none p-0 text-[var(--pv-accent)] underline-offset-4 hover:underline focus-visible:ring-brand-500/40',
      },
      size: {
        default: 'h-10 px-4',
        sm: 'h-9 rounded-lg px-3 text-[13px]',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'h-10 w-10',
        'icon-sm': 'h-9 w-9 rounded-lg',
        'icon-xs': 'h-8 w-8 rounded-md',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Desativa o ripple de clique (padrão: ativo). */
  ripple?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ripple = true, onMouseDown, ...props }, ref) => {
    const handleMouseDown = React.useCallback(
      (event: React.MouseEvent<HTMLButtonElement>) => {
        onMouseDown?.(event)
        if (!ripple || event.button !== 0) return
        const button = event.currentTarget
        const rect = button.getBoundingClientRect()
        const size = Math.max(rect.width, rect.height)
        const x = event.clientX - rect.left - size / 2
        const y = event.clientY - rect.top - size / 2
        const span = document.createElement('span')
        span.className = 'pv-ripple'
        const isGhost =
          variant === 'secondary' ||
          variant === 'ghost' ||
          variant === 'outline' ||
          variant === 'soft' ||
          variant === 'link'
        if (isGhost) span.classList.add('pv-ripple--dark')
        span.style.width = span.style.height = `${size}px`
        span.style.left = `${x}px`
        span.style.top = `${y}px`
        button.appendChild(span)
        window.setTimeout(() => span.remove(), 550)
      },
      [onMouseDown, ripple, variant],
    )

    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        onMouseDown={handleMouseDown}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
