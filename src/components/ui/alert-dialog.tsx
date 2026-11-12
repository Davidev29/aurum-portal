'use client'

import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/utils'
import { buttonVariants } from './button'

export const AlertDialog = AlertDialogPrimitive.Root
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="pv-overlay fixed inset-0 z-50 bg-[var(--pv-overlay)] backdrop-blur-sm" />
      <AlertDialogPrimitive.Content
        className={cn(
          'pv-dialog fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--pv-radius-panel)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-6 text-[var(--pv-text)] shadow-[var(--pv-shadow-lg)]',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

export function AlertDialogHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className="flex flex-col gap-1.5" {...props} />
}

export function AlertDialogFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="-mx-6 -mb-6 flex flex-col-reverse gap-2 border-t border-[var(--pv-border)] px-6 py-4 sm:flex-row sm:items-center sm:justify-end"
      {...props}
    />
  )
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('text-xl font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn('text-sm leading-relaxed text-[var(--pv-muted)]', className)}
      {...props}
    />
  )
}

export function AlertDialogCancel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: 'secondary' }), className)}
      {...props}
    />
  )
}

export function AlertDialogAction({
  className,
  variant = 'default',
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & {
  variant?: 'default' | 'destructive'
}) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant }), className)}
      {...props}
    />
  )
}
