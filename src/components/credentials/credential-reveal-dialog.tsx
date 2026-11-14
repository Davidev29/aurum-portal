'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Copy, Eye } from 'lucide-react'
import type { Credential, CredentialFieldReveal, CredentialRevealResult } from '@shared/types'
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

const kindLabel = (kind: CredentialFieldReveal['kind']): string =>
  kind === 'username' ? 'Usuário' : kind === 'password' ? 'Senha' : 'Campo'

/** Linhas quando a credencial não declara campos (legado): a senha
 * principal sempre existe; o usuário pode vir da coluna. */
const FALLBACK_ROWS: Pick<CredentialFieldReveal, 'name' | 'kind' | 'value'>[] = [
  { name: 'Usuário', kind: 'username', value: null },
  { name: 'Senha', kind: 'password', value: null },
]

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
  const [result, setResult] = React.useState<CredentialRevealResult | null>(null)
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null)
  const [totalSeconds, setTotalSeconds] = React.useState(1)
  const [remaining, setRemaining] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setResult(null)
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
        setResult(null)
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
      const revealed = await aurumBitPortal().credentials.reveal(credential.id)
      const expires = new Date(revealed.expiresAt).getTime()
      setResult(revealed)
      setExpiresAt(expires)
      setTotalSeconds(Math.max(1, Math.ceil((expires - Date.now()) / 1000)))
      await invalidate.audit()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const copyRow = async (row: Pick<CredentialFieldReveal, 'name' | 'kind'>) => {
    if (!credential) return
    try {
      if (row.kind === 'username') {
        // Público no contexto da credencial — não exige passo pelo main.
        await navigator.clipboard.writeText(credential.username)
        toast.success('Usuário copiado.')
        return
      }
      if (credential.fields?.length) {
        // O texto claro NÃO passa pelo renderer: o main resolve o campo.
        await aurumBitPortal().credentials.copy(credential.id, row.name)
      } else {
        // Credencial legada sem campos declarados: copia a senha principal.
        await aurumBitPortal().credentials.copy(credential.id)
      }
      await invalidate.audit()
      toast.success(`"${row.name}" copiado. A área de transferência será limpa automaticamente.`)
    } catch (caught) {
      toast.error(errorMessage(caught))
    }
  }

  const rows: CredentialFieldReveal[] = React.useMemo(() => {
    if (result) return result.fields
    const declared = credential?.fields
    const base = declared?.length
      ? declared.map((field) => ({ name: field.name, kind: field.kind, value: null }))
      : (FALLBACK_ROWS.map((row) => ({ ...row })) as CredentialFieldReveal[])
    return base.map((row) =>
      row.kind === 'username' ? { ...row, value: credential?.username ?? null } : row,
    )
  }, [result, credential])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revelar credencial</DialogTitle>
          <DialogDescription>
            {credential
              ? `${credential.label} — ${credential.clientName} / ${credential.serviceName}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--pv-muted)]">
            <Badge variant="outline">{credential?.usernameType.toUpperCase()}</Badge>
            {credential?.reused ? <Badge variant="warning">Senha reutilizada</Badge> : null}
            <span>{credential?.fields?.length ?? 0} campos salvos</span>
          </div>
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li
                key={`${row.kind}:${row.name}`}
                className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3 dark:bg-[var(--pv-panel)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--pv-muted)]">
                      {kindLabel(row.kind)} · {row.name}
                    </p>
                    <code className="mt-1 block break-all font-mono text-sm text-[var(--pv-text)]">
                      {row.value ?? (result ? 'Sem valor salvo' : '••••••••••••')}
                    </code>
                  </div>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    onClick={() => void copyRow(row)}
                    aria-label={`Copiar ${row.name}`}
                    title={`Copiar ${row.name}`}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {result && remaining > 0 ? (
            <div className="space-y-1">
              <Progress value={(remaining / totalSeconds) * 100} />
              <p className="text-xs text-[var(--pv-muted)]">
                Os valores serão ocultados em {remaining}s. Cada revelação é auditada.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3">
              <p className="text-xs leading-snug text-[var(--pv-muted)]">
                Os demais valores ficam ocultos. Cada revelação é auditada.
              </p>
              <Button size="sm" onClick={() => void reveal()} disabled={busy}>
                <Eye className="h-3.5 w-3.5" />
                {busy ? 'Abrindo…' : 'Revelar tudo'}
              </Button>
            </div>
          )}
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
