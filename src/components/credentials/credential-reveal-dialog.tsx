'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Copy, Eye } from 'lucide-react'
import type { Credential } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useInvalidate } from '@/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

export function CredentialRevealDialog({
  open,
  onOpenChange,
  credential,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  credential: Credential | null
}) {
  const invalidate = useInvalidate()
  const [password, setPassword] = React.useState<string | null>(null)
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null)
  const [totalSeconds, setTotalSeconds] = React.useState(1)
  const [remaining, setRemaining] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setPassword(null)
      setExpiresAt(null)
      setTotalSeconds(1)
      setRemaining(0)
      setError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0) {
        setPassword(null)
        setExpiresAt(null)
      }
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [expiresAt])

  const reveal = async () => {
    if (!credential) return
    setBusy(true)
    setError(null)
    try {
      const result = await aurumBitPortal().credentials.reveal(credential.id)
      const expires = new Date(result.expiresAt).getTime()
      setPassword(result.password)
      setExpiresAt(expires)
      setTotalSeconds(Math.max(1, Math.ceil((expires - Date.now()) / 1000)))
      await invalidate.audit()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!credential) return
    try {
      await aurumBitPortal().credentials.copy(credential.id)
      await invalidate.audit()
      toast.success('Senha copiada. A área de transferência será limpa automaticamente.')
    } catch (caught) {
      toast.error(errorMessage(caught))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Senha da credencial</DialogTitle>
          <DialogDescription>
            {credential
              ? `${credential.label} — ${credential.clientName} / ${credential.serviceName}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-4 dark:bg-[var(--pv-panel)]">
            <div className="flex items-center justify-between gap-3">
              <code className="min-w-0 flex-1 break-all font-mono text-sm">
                {password ?? '••••••••••••'}
              </code>
              {password ? (
                <Button
                  variant="secondary"
                  size="icon-sm"
                  onClick={() => void copy()}
                  aria-label="Copiar senha"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button size="sm" onClick={() => void reveal()} disabled={busy}>
                  <Eye className="h-3.5 w-3.5" />
                  {busy ? 'Abrindo…' : 'Revelar'}
                </Button>
              )}
            </div>
            {password && remaining > 0 ? (
              <div className="mt-3 space-y-1">
                <Progress value={(remaining / totalSeconds) * 100} />
                <p className="text-xs text-[var(--pv-muted)]">
                  A senha será ocultada em {remaining}s. Cada revelação é auditada.
                </p>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--pv-muted)]">
            <Badge variant="outline">{credential?.usernameType.toUpperCase()}</Badge>
            <span>{credential?.username}</span>
            {credential?.reused ? <Badge variant="warning">Senha reutilizada</Badge> : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
