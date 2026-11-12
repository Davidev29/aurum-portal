'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Bell, BellOff, CalendarClock, CheckCheck, Trash2 } from 'lucide-react'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useNotifications, useObligationsInvalidate } from '@/lib/obligations-queries'
import { cn, formatDateTime } from '@/lib/utils'
import { formatDateBr } from '@shared/holidays'

/**
 * Central de avisos do aplicativo: obrigações cujo vencimento se aproxima
 * (definido pela antecedência de cada obrigação) aparecem aqui, gerados pelo
 * agendador diário do processo principal.
 */
export function NotificationCenter() {
  const { data, isLoading } = useNotifications()
  const invalidate = useObligationsInvalidate()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  const notifications = data?.notifications ?? []
  const unreadCount = data?.unreadCount ?? 0

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const markAllRead = async () => {
    setBusy(true)
    try {
      await aurumBitPortal().obligations.markAllNotificationsRead()
      invalidate.notifications()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const clearRead = async () => {
    setBusy(true)
    try {
      await aurumBitPortal().obligations.clearReadNotifications()
      invalidate.notifications()
      toast.success('Avisos lidos foram removidos.')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const markRead = async (id: string) => {
    try {
      await aurumBitPortal().obligations.markNotificationRead(id)
      invalidate.notifications()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={
          unreadCount > 0
            ? `Central de avisos — ${unreadCount} aviso(s) não lido(s)`
            : 'Central de avisos'
        }
        aria-expanded={open}
        className="pv-icon-btn relative flex h-9 w-9 items-center justify-center rounded-full border border-[var(--pv-border)] bg-[var(--pv-panel-2)] text-[var(--pv-muted)] transition-colors hover:text-[var(--pv-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pv-danger-solid)] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[var(--pv-panel)]">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Central de avisos"
          className="absolute right-0 z-50 mt-2 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow-lg)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--pv-border)] px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight">Central de avisos</h2>
              {unreadCount > 0 ? (
                <span className="rounded-full bg-[var(--pv-warning-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--pv-warning)]">
                  {unreadCount} não lido(s)
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={busy || unreadCount === 0}
                title="Marcar todas como lidas"
                aria-label="Marcar todas como lidas"
                className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCheck className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => void clearRead()}
                disabled={busy}
                title="Remover avisos lidos"
                aria-label="Remover avisos lidos"
                className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto pv-scroll">
            {isLoading ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--pv-muted)]">Carregando…</p>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <BellOff className="h-6 w-6 text-[var(--pv-faint)]" aria-hidden="true" />
                <p className="text-sm font-medium text-[var(--pv-muted)]">Nenhum aviso pendente.</p>
                <p className="max-w-[260px] text-xs leading-relaxed text-[var(--pv-faint)]">
                  Os avisos de vencimento aparecem aqui conforme a antecedência configurada em cada
                  obrigação.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--pv-border)]">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void markRead(notification.id)}
                      title={notification.read ? 'Aviso já lido' : 'Marcar como lido'}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--pv-panel-2)]',
                        !notification.read && 'bg-[var(--pv-accent-soft)]/40',
                      )}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--pv-warning-soft)] text-[var(--pv-warning)]">
                        <CalendarClock className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold text-[var(--pv-text)]">
                            {notification.title}
                          </span>
                          {!notification.read ? (
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-[var(--pv-accent)]"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--pv-muted)]">
                          {notification.message}
                        </span>
                        <span className="mt-1 block text-[10px] font-medium text-[var(--pv-faint)]">
                          {notification.dueDate
                            ? `Vencimento: ${formatDateBr(notification.dueDate)} · `
                            : ''}
                          Aviso de {formatDateTime(notification.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-[var(--pv-border)] px-4 py-2.5">
            <Link
              href="/obrigacoes"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-[var(--pv-accent)] hover:underline"
            >
              Ver módulo de Obrigações →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
