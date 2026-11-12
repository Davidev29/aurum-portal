'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  AppWindow,
  Building2,
  ChevronRight,
  ClipboardCheck,
  FileBadge,
  FilePenLine,
  ScrollText,
  SlidersHorizontal,
  Store,
} from 'lucide-react'
import { APP_DISPLAY_NAME, APP_LOGO_URL } from '@shared/constants'
import { cn } from '@/lib/utils'
import { useSessions } from '@/lib/queries'
import { Badge } from './ui/badge'
import { LiveClock } from './live-clock'
import { NotificationCenter } from './notification-center'

const navigation = [
  {
    section: 'Operação',
    items: [
      { href: '/', label: 'Store', icon: Store },
      { href: '/clients', label: 'Clientes', icon: Building2 },
      { href: '/obrigacoes', label: 'Obrigações', icon: ClipboardCheck },
      { href: '/certificates', label: 'Certificados', icon: FileBadge },
    ],
  },
  {
    section: 'Trabalho',
    items: [
      { href: '/assinaturas', label: 'Assinatura digital', icon: FilePenLine },
      { href: '/sessions', label: 'Sessões', icon: AppWindow },
    ],
  },
  {
    section: 'Sistema',
    items: [
      { href: '/audit', label: 'Auditoria', icon: ScrollText },
      { href: '/settings', label: 'Configurações', icon: SlidersHorizontal },
    ],
  },
]

const allItems = navigation.flatMap((group) => group.items)

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

export function AppShell({
  children,
  fullHeight = false,
}: {
  children: React.ReactNode
  /** Oculta o scroll da página: a tela preenche a janela e controla o próprio layout. */
  fullHeight?: boolean
}) {
  const pathname = usePathname()
  const { data: sessions } = useSessions()
  const openSessions = sessions?.length ?? 0
  const current = allItems.find((item) => isActive(pathname, item.href))

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--pv-bg)]">
      <a
        href="#app-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[var(--pv-radius-control)] focus:border focus:border-[var(--pv-border)] focus:bg-[var(--pv-panel)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--pv-text)] focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-[var(--pv-border)] bg-[var(--pv-panel)]">
        <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-[var(--pv-border)] px-6">
          <div className="relative shrink-0">
            <img
              src={APP_LOGO_URL}
              alt={APP_DISPLAY_NAME}
              className="h-11 w-11 rounded-[var(--pv-radius)] object-cover ring-1 ring-[var(--pv-border-strong)]"
              draggable={false}
            />
            <span
              className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-[var(--pv-success)] ring-2 ring-[var(--pv-panel)]"
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold tracking-[-0.01em]">
              {APP_DISPLAY_NAME}
            </div>
            <div className="text-[11px] font-medium text-[var(--pv-faint)]">
              Cofre de acessos gov.br
            </div>
          </div>
        </div>

        <nav
          className="flex-1 space-y-6 overflow-y-auto px-3 py-4 pv-scroll"
          aria-label="Navegação principal"
        >
          {navigation.map((group) => (
            <div key={group.section} className="space-y-1">
              <div className="px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--pv-faint)]">
                {group.section}
              </div>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href)
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'pv-nav-link group relative flex items-center gap-3 overflow-hidden rounded-[var(--pv-radius-control)] py-2 px-3 text-[13.5px] font-medium focus-visible:ring-2 focus-visible:ring-[var(--pv-accent-solid)]',
                      active ? 'is-active' : 'hover:bg-[var(--pv-panel-2)]',
                    )}
                  >
                    <span
                      className={cn(
                        'pv-nav-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--pv-radius-xs)] border',
                        active
                          ? 'border-[var(--pv-accent-soft-border)] text-[var(--pv-accent)]'
                          : 'border-[var(--pv-border)] bg-[var(--pv-panel-2)] text-[var(--pv-muted)] group-hover:bg-[var(--pv-panel-3)] group-hover:text-[var(--pv-text)]',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                    {item.href === '/sessions' && openSessions > 0 ? (
                      <span className="pv-anim-check-pop flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pv-success-solid)] px-1.5 text-[10px] font-bold text-white">
                        {openSessions}
                      </span>
                    ) : null}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main
        id="app-content"
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col overflow-hidden focus:outline-none"
      >
        <div className="relative flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--pv-border)] bg-[var(--pv-panel)]/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-[var(--pv-panel)]/80">
          <nav
            className="flex min-w-0 items-center gap-1.5 text-xs text-[var(--pv-muted)]"
            aria-label="Caminho"
          >
            <span className="hidden sm:inline">{APP_DISPLAY_NAME}</span>
            <ChevronRight className="hidden h-3.5 w-3.5 sm:inline" aria-hidden="true" />
            <span
              key={current?.href ?? 'panel'}
              className="pv-anim-slide-right max-w-[240px] truncate rounded-full border border-[var(--pv-border-subtle)] bg-[var(--pv-panel-2)]/60 px-2.5 py-1 font-semibold text-[var(--pv-text)]"
            >
              {current?.label ?? 'Painel'}
            </span>
          </nav>
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <LiveClock />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationCenter />
            {openSessions > 0 ? (
              <Link
                href="/sessions"
                className="pv-pressable inline-flex h-9 items-center gap-2 rounded-[var(--pv-radius-control)] border border-[var(--pv-border)] bg-[var(--pv-panel)] px-3.5 text-sm font-bold text-[var(--pv-success)] shadow-sm hover:brightness-[1.02]"
              >
                <span
                  className="h-2 w-2 animate-pulse rounded-full bg-[var(--pv-success)]"
                  aria-hidden="true"
                />
                {openSessions} sessão(ões) aberta(s)
              </Link>
            ) : (
              <Badge variant="outline">Nenhuma sessão aberta</Badge>
            )}
          </div>
        </div>
        <div
          className={
            fullHeight
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : 'min-h-0 flex-1 overflow-y-auto pv-scroll'
          }
        >
          <div
            key={pathname ?? 'root'}
            className={
              fullHeight
                ? 'pv-page-transition mx-auto flex h-full min-h-0 w-full max-w-[1440px] flex-col p-6 md:p-8'
                : 'pv-page-transition mx-auto w-full max-w-[1440px] p-6 md:p-8'
            }
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
