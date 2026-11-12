'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { FileText, Loader2 } from 'lucide-react'
import type { Client } from '@shared/types'
import { errorMessage } from '@/lib/api'
import {
  useCertificates,
  useClientNotes,
  useCredentials,
  useInvalidate,
  useSettings,
} from '@/lib/queries'
import { formatCentsToBRL } from '@shared/currency'
import { generateClientReport } from '@/lib/pdf/client-reports'
import { saveReportPdf } from '@/lib/pdf/save-report'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Relatório específico por cliente (Modelo Timbrado do sistema).
 * Pergunta ao operador o que imprimir: dados, honorários, observações,
 * credenciais (sem senhas) e certificados.
 */
export function ClientReportDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const invalidate = useInvalidate()
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const { data: notes = [] } = useClientNotes(open ? client.id : null)
  const { data: credentials = [] } = useCredentials({ clientId: client.id })
  const { data: certificates = [] } = useCertificates({ clientId: client.id })

  const [basics, setBasics] = React.useState(true)
  const [honorarios, setHonorarios] = React.useState(true)
  const [includeNotes, setIncludeNotes] = React.useState(true)
  const [includeCredentials, setIncludeCredentials] = React.useState(false)
  const [includeCertificates, setIncludeCertificates] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setBasics(true)
    setHonorarios(true)
    setIncludeNotes(true)
    setIncludeCredentials(false)
    setIncludeCertificates(false)
  }, [open])

  const selectedCount =
    Number(basics) +
    Number(honorarios) +
    Number(includeNotes) +
    Number(includeCredentials) +
    Number(includeCertificates)

  const generate = async () => {
    if (!settings) {
      toast.error('Configurações ainda não carregadas. Tente novamente em instantes.')
      return
    }
    if (selectedCount === 0) {
      toast.error('Selecione ao menos uma seção para imprimir.')
      return
    }
    setBusy(true)
    try {
      const result = await generateClientReport({
        client,
        sections: {
          basics,
          honorarios,
          notes: includeNotes,
          credentials: includeCredentials,
          certificates: includeCertificates,
        },
        notes,
        credentials,
        certificates,
        settings,
      })
      const saved = await saveReportPdf({
        filename: `relatorio-cliente-${result.trackingCode}.pdf`,
        bytes: result.bytes,
        trackingCode: result.trackingCode,
        title: 'Relatorio do Cliente',
      })
      if (saved.path) {
        toast.success(`${result.pageCount} página(s) exportadas em PDF.`, {
          description: `Código de rastreio: ${result.trackingCode}`,
        })
        await invalidate.audit()
        onOpenChange(false)
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Relatório do cliente</DialogTitle>
          <DialogDescription>
            {client.name} — escolha o que imprimir. Senhas nunca são incluídas no documento.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-[var(--pv-text)]">
            O que você quer imprimir?
          </legend>
          <SectionToggle
            checked={basics}
            onCheckedChange={setBasics}
            label="Dados cadastrais"
            description="Tipo, documento, contato, tags, consentimento LGPD e datas."
          />
          <SectionToggle
            checked={honorarios}
            onCheckedChange={setHonorarios}
            label="Honorários"
            description={
              client.honorariosCents === null
                ? 'Honorários não informados para este cliente.'
                : `Honorários: ${formatCentsToBRL(client.honorariosCents)}`
            }
          />
          <SectionToggle
            checked={includeNotes}
            onCheckedChange={setIncludeNotes}
            label={`Observações (${notes.length})`}
            description="Anotações registradas no cadastro do cliente."
          />
          <SectionToggle
            checked={includeCredentials}
            onCheckedChange={setIncludeCredentials}
            label={`Credenciais (${credentials.length})`}
            description="Rótulo, serviço, usuário e último uso. Sem senhas."
          />
          <SectionToggle
            checked={includeCertificates}
            onCheckedChange={setIncludeCertificates}
            label={`Certificados vinculados (${certificates.length})`}
            description="Certificado, titular, validade e situação."
          />
        </fieldset>

        <p className="text-xs text-[var(--pv-muted)]">
          O documento usa o Modelo Timbrado configurado nas Configurações e recebe um código de
          rastreio único no cabeçalho.
        </p>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={busy || settingsLoading || selectedCount === 0}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            {busy ? 'Gerando…' : 'Gerar PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SectionToggle({
  checked,
  onCheckedChange,
  label,
  description,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  description: string
}) {
  const id = React.useId()
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--pv-border)] p-3 text-sm transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)]"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-[var(--pv-muted)]">{description}</span>
      </span>
    </label>
  )
}
