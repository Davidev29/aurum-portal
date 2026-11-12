'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({
  className,
  children,
  hideClose = false,
  animate = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  hideClose?: boolean
  /** false remove a animação de entrada (modais de progresso com conteúdo mutável). */
  animate?: boolean
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="pv-overlay fixed inset-0 z-50 bg-[var(--pv-overlay)] backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn(
          animate && 'pv-dialog',
          'fixed left-1/2 top-1/2 z-50 grid max-h-[92vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-6 text-[var(--pv-text)] shadow-[var(--pv-shadow-lg)] pv-scroll',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="pv-icon-btn absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="h-5 w-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pr-10', className)} {...props} />
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        '-mx-6 -mb-6 flex flex-col-reverse gap-2 border-t border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-6 py-4 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-xl font-bold tracking-tight', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm leading-relaxed text-[var(--pv-muted)]', className)}
      {...props}
    />
  )
}
