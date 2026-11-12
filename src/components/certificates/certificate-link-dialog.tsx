'use client'

import * as React from 'react'
import { toast } from 'sonner'
import type { Certificate } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useClients, useInvalidate } from '@/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/switch'

export function CertificateLinkDialog({
  open,
  onOpenChange,
  certificate,
  defaultClientId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  certificate: Certificate | null
  defaultClientId?: string
}) {
  const invalidate = useInvalidate()
  const { data: clients } = useClients({ status: 'active' })
  const [clientId, setClientId] = React.useState('')
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setClientId(defaultClientId ?? '')
    setConsent(false)
    setError(null)
  }, [open, defaultClientId])

  const submit = async () => {
    if (!certificate) return
    setBusy(true)
    setError(null)
    try {
      await aurumBitPortal().certificates.linkClient({
        id: certificate.id,
        clientId,
        consent,
      })
      toast.success('Certificado vinculado ao cliente.')
      await Promise.all([invalidate.certificates(), invalidate.clients(), invalidate.audit()])
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular certificado</DialogTitle>
          <DialogDescription>
            {certificate
              ? `${certificate.label} — ${certificate.holderName}. Um certificado pode atender varios clientes mediante autorizacao.`
              : 'Selecione o cliente que poderá usar este certificado.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Cliente" required>
            <Select value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">Selecione</option>
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} — {client.document}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--pv-border)] p-3.5 text-sm leading-relaxed transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]">
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
              className="mt-0.5"
            />
            Confirmo que há autorização do titular para este vínculo. O evento será auditado.
          </label>
          {error ? (
            <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !clientId || !consent}>
            {busy ? 'Vinculando...' : 'Vincular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
