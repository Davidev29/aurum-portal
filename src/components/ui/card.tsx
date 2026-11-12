import * as React from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'pv-lift rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] text-[var(--pv-text)] shadow-[var(--pv-shadow)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 p-6 pb-4', className)} {...props} />
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-semibold tracking-tight', className)} {...props} />
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('text-sm leading-relaxed text-[var(--pv-muted)]', className)} {...props} />
  )
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-[var(--pv-border)] p-6 pt-4',
        className,
      )}
      {...props}
    />
  )
}
