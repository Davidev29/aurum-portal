'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Bookmark,
  ExternalLink,
  KeyRound,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Timer,
  X,
} from 'lucide-react'
import type { PortalSession } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useInvalidate, useSessions } from '@/lib/queries'
import { formatDateTime, initials, timeAgo } from '@/lib/utils'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SessionStatusBadge } from '@/components/status-badges'
import { ConfirmDialog } from '@/components/confirm-dialog'

export default function SessionsPage() {
  const router = useRouter()
  const invalidate = useInvalidate()
  const { data: sessions, isLoading, isFetching, refetch } = useSessions()
  const [closing, setClosing] = React.useState<PortalSession | null>(null)
  const [busy, setBusy] = React.useState(false)

  const focus = async (session: PortalSession) => {
    try {
      await aurumBitPortal().sessions.focus(session.id)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const close = async () => {
    if (!closing) return
    setBusy(true)
    try {
      await aurumBitPortal().sessions.close(closing.id)
      toast.success('Sessão encerrada. A partição permanece isolada para a próxima abertura.')
      await Promise.all([invalidate.sessions(), invalidate.services(), invalidate.audit()])
      setClosing(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Sessões"
        description="Cada janela tem contexto próprio de cliente, certificado e partição. Fechar uma sessão descarta os cookies e o storage daquela partição."
        eyebrow="Janelas isoladas"
        icon={<Bookmark className="h-5 w-5" />}
        actions={
          <Button variant="secondary" onClick={() => void refetch()}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-64 animate-pulse rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)]"
            />
          ))}
        </div>
      ) : !sessions || sessions.length === 0 ? (
        <EmptyState
          icon={<Bookmark className="h-5 w-5" />}
          title="Nenhuma sessão aberta"
          description="Abra um portal pela store. Popups de OAuth herdam a mesma partição e o mesmo contexto de certificado."
          action={
            <Button onClick={() => router.push('/')}>
              <Monitor className="h-4 w-4" />
              Ir para a store
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 pv-stagger">
          {sessions.map((session) => (
            <Card key={session.id} className="overflow-hidden pv-surface-hover">
              <div
                className="h-1 bg-gradient-to-r from-emerald-500 via-brand-500 to-brand-400"
                aria-hidden="true"
              />
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">
                    {initials(session.clientName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{session.clientName}</span>
                      <SessionStatusBadge status={session.status} />
                      {session.loading ? <Badge variant="outline">Carregando</Badge> : null}
                    </div>
                    <div className="truncate text-xs text-[var(--pv-muted)]">
                      {session.serviceName} •{' '}
                      {session.authMethod === 'certificate' ? 'Certificado' : 'Senha'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--pv-muted)]" />
                    <span className="truncate font-mono">{session.title || session.url}</span>
                  </div>
                  {session.certificate ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span className="truncate">
                        {session.certificate.label} • {session.certificate.holderName}
                      </span>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2">
                      <KeyRound className="h-3.5 w-3.5 shrink-0 text-[var(--pv-muted)]" />
                      <span className="truncate">Autenticação por senha</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-[var(--pv-muted)]">
                    <Timer className="h-3.5 w-3.5" />
                    Aberta {timeAgo(session.openedAt)} • {formatDateTime(session.openedAt)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-[var(--pv-muted)]">
                    partition: {session.partition}
                  </div>
                </div>

                {session.lastError || session.statusMessage ? (
                  <p className="rounded-md border border-[var(--pv-warning-border)] bg-[var(--pv-warning-soft)] p-2 text-xs text-[var(--pv-warning)] dark:border-[var(--pv-warning-border)] dark:bg-[var(--pv-warning-soft)] dark:text-[var(--pv-warning)]">
                    {session.lastError ?? session.statusMessage}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void focus(session)}>
                    <Monitor className="h-3.5 w-3.5" />
                    Focar janela
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setClosing(session)}>
                    <X className="h-4 w-4 text-[var(--pv-danger)]" />
                    Encerrar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(closing)}
        onOpenChange={(open) => {
          if (!open) setClosing(null)
        }}
        title="Encerrar sessão?"
        description={
          <>
            A janela de <strong>{closing?.clientName}</strong> em{' '}
            <strong>{closing?.serviceName}</strong> será fechada e os cookies da partição serão
            descartados. O histórico de auditoria é preservado.
          </>
        }
        confirmLabel="Encerrar sessão"
        busy={busy}
        onConfirm={() => void close()}
      />
    </AppShell>
  )
}
