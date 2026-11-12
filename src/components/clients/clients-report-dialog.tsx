'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { FileText, Loader2 } from 'lucide-react'
import type { Client } from '@shared/types'
import { errorMessage } from '@/lib/api'
import { useInvalidate, useSettings } from '@/lib/queries'
import { generateClientsListReport } from '@/lib/pdf/client-reports'
import { saveReportPdf } from '@/lib/pdf/save-report'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type ListReportMode = 'names' | 'honorarios'

/**
 * Relatório da lista de clientes (Modelo Timbrado do sistema).
 * Pergunta ao operador se quer honorários no PDF ou somente os nomes.
 * Usa os clientes atualmente filtrados na tela (status/busca).
 */
export function ClientsReportDialog({
  clients,
  filterDescription,
  open,
  onOpenChange,
}: {
  clients: Client[]
  filterDescription: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const invalidate = useInvalidate()
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const [mode, setMode] = React.useState<ListReportMode>('names')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setMode('names')
  }, [open])

  const generate = async () => {
    if (!settings) {
      toast.error('Configurações ainda não carregadas. Tente novamente em instantes.')
      return
    }
    if (clients.length === 0) {
      toast.info('Nenhum cliente no filtro atual; nenhum arquivo foi criado.')
      return
    }
    setBusy(true)
    try {
      const result = await generateClientsListReport({
        clients,
        includeHonorarios: mode === 'honorarios',
        filterDescription,
        settings,
      })
      const saved = await saveReportPdf({
        filename: `relatorio-clientes-${result.trackingCode}.pdf`,
        bytes: result.bytes,
        trackingCode: result.trackingCode,
        title: 'Relatorio de Clientes',
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

  const options: Array<{ value: ListReportMode; label: string; description: string }> = [
    {
      value: 'names',
      label: 'Somente nomes dos clientes',
      description: 'Tabela com numeração e nome — nada mais.',
    },
    {
      value: 'honorarios',
      label: 'Nomes + honorários',
      description: 'Adiciona a coluna de honorários e um resumo com a soma dos valores informados.',
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Relatório de clientes</DialogTitle>
          <DialogDescription>
            {clients.length} cliente(s) no filtro atual ({filterDescription}). Escolha o conteúdo do
            PDF.
          </DialogDescription>
        </DialogHeader>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-[var(--pv-text)]">
            O que você quer listar?
          </legend>
          <div role="radiogroup" aria-label="Conteúdo do relatório" className="grid gap-2">
            {options.map((option) => {
              const selected = mode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setMode(option.value)}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors',
                    selected
                      ? 'border-brand-600 bg-[var(--pv-accent-soft)] ring-2 ring-brand-500/40'
                      : 'border-[var(--pv-border)] hover:border-brand-300',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-brand-600' : 'border-[var(--pv-border-strong)]',
                    )}
                  >
                    {selected ? (
                      <span className="h-2 w-2 rounded-full bg-[var(--pv-accent-solid)]" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-[var(--pv-muted)]">
                      {option.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <p className="text-xs text-[var(--pv-muted)]">
          O documento usa o Modelo Timbrado configurado nas Configurações. O relatório reflete
          apenas os clientes visíveis com o filtro atual.
        </p>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => void generate()}
            disabled={busy || settingsLoading || clients.length === 0}
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
