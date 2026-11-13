import * as React from 'react'
import { cn } from '@/lib/utils'

const controlClasses =
  'flex h-10 w-full rounded-[var(--pv-radius-control)] border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] px-3.5 py-1 text-sm text-[var(--pv-text)] transition-[border-color,box-shadow] duration-150 ease placeholder:text-[var(--pv-faint)] hover:border-[var(--pv-accent-solid)] focus-visible:border-[var(--pv-accent-solid)] focus-visible:ring-2 focus-visible:ring-brand-600/25 disabled:cursor-not-allowed disabled:opacity-60'

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = 'text', ...props }, ref) => (
  <input ref={ref} type={type} className={cn(controlClasses, className)} {...props} />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[96px] w-full rounded-[var(--pv-radius-control)] border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] px-3.5 py-2.5 text-sm text-[var(--pv-text)] transition-[border-color,box-shadow] duration-150 ease placeholder:text-[var(--pv-faint)] hover:border-[var(--pv-accent-solid)] focus-visible:border-[var(--pv-accent-solid)] focus-visible:ring-2 focus-visible:ring-brand-600/25 disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-sm font-medium leading-none text-[var(--pv-text)]', className)}
    {...props}
  />
))
Label.displayName = 'Label'

type AnyElement = React.ReactElement<{ id?: string }>

function isFormControlElement(element: React.ReactElement): element is AnyElement {
  if (typeof element.type === 'string') {
    return element.type === 'input' || element.type === 'select' || element.type === 'textarea'
  }
  const displayName = (element.type as { displayName?: string }).displayName
  return displayName === 'Input' || displayName === 'Textarea' || displayName === 'Select'
}

/** Localiza o controle (Input/Textarea/Select) entre os children do Field —
 * incluindo children múltiplos (o primeiro controle ganha o htmlFor). */
function findControlChild(children: React.ReactNode): {
  control: AnyElement | undefined
  index: number
} {
  const array = React.Children.toArray(children)
  for (let index = 0; index < array.length; index += 1) {
    const child = array[index]
    if (React.isValidElement(child) && isFormControlElement(child)) {
      return { control: child, index }
    }
  }
  return { control: undefined, index: -1 }
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string | null
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  const generatedId = React.useId()
  const { control, index: controlIndex } = findControlChild(children)
  const controlId = control ? ((control.props as { id?: string }).id ?? generatedId) : undefined
  let resolvedChildren: React.ReactNode = React.Children.toArray(children)

  if (control && !(control.props as { id?: string }).id) {
    resolvedChildren = React.Children.toArray(children).map((child, index) =>
      index === controlIndex
        ? (React.cloneElement(control as AnyElement, { id: generatedId }) as React.ReactNode)
        : child,
    )
  }

  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <label
        htmlFor={controlId}
        className={cn('text-sm font-semibold text-[var(--pv-text)]', !controlId && 'select-none')}
      >
        {label}
        {required ? (
          <span className="ml-1 font-bold text-[var(--pv-danger)]" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {resolvedChildren}
      {error ? (
        <p className="pv-error pv-anim-slide-up" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--pv-muted)]">{hint}</p>
      ) : null}
    </div>
  )
}
