'use client'

import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
export const DropdownMenuGroup = DropdownMenuPrimitive.Group

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'pv-floating z-50 min-w-56 overflow-hidden rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-1.5 text-[var(--pv-text)] shadow-[var(--pv-shadow-lg)]',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        'px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--pv-faint)]',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  variant?: 'default' | 'danger'
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium outline-none transition-colors duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
        variant === 'danger'
          ? 'text-[var(--pv-danger)] data-[highlighted]:bg-[var(--pv-danger-soft)]'
          : 'text-[var(--pv-text)] data-[highlighted]:bg-[var(--pv-panel-2)]',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('mx-1 my-1.5 h-px bg-[var(--pv-border-subtle)]', className)}
      {...props}
    />
  )
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl py-2 pl-8 pr-2.5 text-[13px] font-medium text-[var(--pv-text)] outline-none transition-colors duration-150 data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-[var(--pv-panel-2)]',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-[var(--pv-accent)]" strokeWidth={2.5} />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2.5 rounded-xl py-2 pl-8 pr-2.5 text-[13px] font-medium text-[var(--pv-text)] outline-none data-[highlighted]:bg-[var(--pv-panel-2)]',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-[var(--pv-accent)] text-[var(--pv-accent)]" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        'pv-floating z-50 min-w-44 overflow-hidden rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-1.5 shadow-[var(--pv-shadow-lg)]',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] font-medium text-[var(--pv-text)] outline-none data-[highlighted]:bg-[var(--pv-panel-2)]',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-4 w-4 text-[var(--pv-faint)]" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}
