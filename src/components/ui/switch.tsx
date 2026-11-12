'use client'

import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-[var(--pv-border-strong)] transition-[background-color,box-shadow] duration-200 ease hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--pv-accent-solid)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  )
}

export function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer h-5 w-5 shrink-0 rounded-md border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] shadow-sm transition-[background-color,border-color] duration-150 ease hover:border-[var(--pv-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[var(--pv-accent-solid)] data-[state=checked]:bg-[var(--pv-accent-solid)] data-[state=checked]:text-[var(--pv-on-accent)]',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="h-3.5 w-3.5 pv-anim-check-pop" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
