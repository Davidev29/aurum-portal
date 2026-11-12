'use client'

import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-1.5 shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'pv-pressable inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-sm font-medium text-[var(--pv-muted)] hover:text-[var(--pv-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 data-[state=active]:bg-[var(--pv-panel)] data-[state=active]:font-semibold data-[state=active]:text-[var(--pv-text)] data-[state=active]:shadow',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn(
        'pv-tabs-content mt-5 outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        className,
      )}
      {...props}
    />
  )
}
