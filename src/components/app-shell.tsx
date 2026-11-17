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
  Vault,
} from 'lucide-react'
import { APP_DISPLAY_NAME, APP_LOGO_URL } from '@shared/constants'
import { cn } from '@/lib/utils'
import { useSessions } from '@/lib/queries'
import { Badge } from './ui/badge'
import { LiveClock } from './live-clock'
import { NotificationCenter } from './notification-center'
import { ThemeToggle } from './theme-toggle'

const navigation = [
  {
    section: 'Operação',
    items: [
      { href: '/', label: 'Acessos', icon: Vault },
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

/**
 * Container persistente do conteúdo: a cada troca de rota, apenas rearma a
 * animação de entrada (sem remount do DOM, sem skeleton novo) — a navegação
 * entre menus deve parecer instantânea.
 */
function PageTransition({
  children,
  fullHeight,
}: {
  children: React.ReactNode
  fullHeight?: boolean
}) {
  const pathname = usePathname()
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Reinicia a animação CSS sem trocar a key (o DOM não é destruído).
    el.classList.remove('pv-page-transition')
    void el.offsetWidth
    el.classList.add('pv-page-transition')
  }, [pathname])
  return (
    <div
      ref={ref}
      className={
        fullHeight
          ? 'pv-page-transition mx-auto flex h-full min-h-0 w-full max-w-[1440px] flex-col p-4 sm:p-6 lg:p-8'
          : 'pv-page-transition mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8'
      }
    >
      {children}
    </div>
  )
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
    <div className="flex h-screen overflow-hidden bg-transparent">
      <a
        href="#app-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-[var(--pv-radius-control)] focus:border focus:border-[var(--pv-border)] focus:bg-[var(--pv-panel)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--pv-text)] focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>
      <aside className="pv-glass flex w-[76px] shrink-0 flex-col border-r border-[var(--pv-border)] transition-[width] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] lg:w-[264px]">
        <div className="flex h-[72px] shrink-0 items-center justify-center gap-3 border-b border-[var(--pv-border)] px-2 lg:justify-start lg:px-6">
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
          <div className="hidden min-w-0 lg:block">
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
              <div className="hidden px-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--pv-faint)] lg:block">
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
                    aria-label={item.label}
                    title={item.label}
                    className={cn(
                      'pv-nav-link group relative flex items-center justify-center gap-0 overflow-hidden rounded-[var(--pv-radius-control)] py-2.5 px-2 text-[13.5px] font-medium focus-visible:ring-2 focus-visible:ring-[var(--pv-accent-solid)] lg:justify-start lg:gap-3 lg:py-2 lg:px-3',
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
                    <span className="hidden min-w-0 flex-1 leading-snug lg:block">
                      {item.label}
                    </span>
                    {item.href === '/sessions' && openSessions > 0 ? (
                      <>
                        <span className="pv-anim-check-pop hidden h-5 min-w-5 items-center justify-center rounded-full bg-[var(--pv-success-solid)] px-1.5 text-[10px] font-bold text-white lg:flex">
                          {openSessions}
                        </span>
                        <span
                          className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--pv-success-solid)] px-1 text-[9px] font-bold leading-none text-white ring-2 ring-[var(--pv-panel)] lg:hidden"
                          aria-hidden="true"
                        >
                          {openSessions}
                        </span>
                      </>
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
        className="flex min-w-0 flex-1 flex-col overflow-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pv-accent-solid)]"
      >
        <div className="pv-glass relative flex h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--pv-border)] px-3 sm:gap-4 sm:px-6">
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
            <ThemeToggle />
            <NotificationCenter />
            {openSessions > 0 ? (
              <Link
                href="/sessions"
                className="pv-pressable inline-flex h-9 items-center gap-2 rounded-[var(--pv-radius-control)] border border-[var(--pv-border)] bg-[var(--pv-panel)] px-2.5 text-sm font-bold tabular-nums text-[var(--pv-success)] shadow-sm hover:brightness-[1.02] sm:px-3.5"
                aria-label={`${openSessions} sessão(ões) aberta(s)`}
              >
                <span
                  className="h-2 w-2 animate-pulse rounded-full bg-[var(--pv-success)]"
                  aria-hidden="true"
                />
                <span className="hidden xl:inline">{openSessions} sessão(ões) aberta(s)</span>
                <span className="xl:hidden">{openSessions}</span>
              </Link>
            ) : (
              <Badge variant="outline" className="hidden md:inline-flex">
                Nenhuma sessão aberta
              </Badge>
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
          <PageTransition fullHeight={fullHeight}>{children}</PageTransition>
        </div>
      </main>
    </div>
  )
}
