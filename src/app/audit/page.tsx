'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileClock,
  FileJson,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react'
import type { AuditFilter } from '@shared/types'
import { AUDIT_TYPES } from '@shared/constants'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useAudit, useInvalidate, useSettings } from '@/lib/queries'
import { useDebouncedValue } from '@/lib/hooks'
import { formatDateTime } from '@/lib/utils'
import { generateReportPdf } from '@/lib/pdf/report-document'
import { saveReportPdf } from '@/lib/pdf/save-report'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const PAGE_SIZE = 50

export default function AuditPage() {
  const invalidate = useInvalidate()
  const [type, setType] = React.useState('')
  const [entity, setEntity] = React.useState('')
  const debouncedEntity = useDebouncedValue(entity)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [detail, setDetail] = React.useState<{
    type: string
    entity: string
    createdAt: string
    metadata: Record<string, unknown>
  } | null>(null)

  const filter = React.useMemo<AuditFilter>(
    () => ({
      types: type ? [type] : undefined,
      entity: debouncedEntity || undefined,
      from: from || undefined,
      to: to ? `${to}T23:59:59.999Z` : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [type, debouncedEntity, from, to, page],
  )

  const { data, isLoading, isFetching, refetch } = useAudit(filter)
  const { data: settings } = useSettings()
  const [pdfBusy, setPdfBusy] = React.useState(false)

  React.useEffect(() => {
    setPage(0)
  }, [type, debouncedEntity, from, to])

  const exportAudit = async (format: 'csv' | 'json') => {
    try {
      const result = await aurumBitPortal().audit.export(format, {
        types: type ? [type] : undefined,
        entity: debouncedEntity || undefined,
        from: from || undefined,
        to: to ? `${to}T23:59:59.999Z` : undefined,
      })
      if (result.count === 0) {
        toast.info('Nenhum evento corresponde ao filtro; nenhum arquivo foi criado.')
        return
      }
      toast.success(`${result.count} evento(s) exportados.`, { description: result.path })
      await invalidate.audit()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const exportAuditPdf = async () => {
    if (!settings || pdfBusy) return
    setPdfBusy(true)
    try {
      const events = await aurumBitPortal().audit.list({
        types: type ? [type] : undefined,
        entity: debouncedEntity || undefined,
        from: from || undefined,
        to: to ? `${to}T23:59:59.999Z` : undefined,
        limit: 500,
        offset: 0,
      })
      if (events.events.length === 0) {
        toast.info('Nenhum evento corresponde ao filtro; nenhum arquivo foi criado.')
        return
      }
      const result = await generateReportPdf({
        title: 'Relatorio de Auditoria',
        subtitle: 'Trilha local de operacoes sensiveis (metadados redigidos)',
        meta: [
          `Gerado em ${formatDateTime(new Date().toISOString())}`,
          `Filtros: ${type ? `tipo=${type}` : 'todos os tipos'}${debouncedEntity ? ` - entidade=${debouncedEntity}` : ''}${from || to ? ` - periodo=${from || 'inicio'} a ${to || 'fim'}` : ''}`,
          `${events.total} evento(s) no total; exibindo os primeiros ${events.events.length}.`,
        ],
        office: settings.office,
        letterhead: settings.letterhead,
        sections: [
          {
            heading: 'Eventos',
            table: {
              columns: ['Data', 'Tipo', 'Entidade', 'ID', 'Metadados'],
              widths: [1.1, 1.4, 0.9, 0.9, 2.7],
              rows: events.events.map((event) => [
                formatDateTime(event.createdAt),
                event.type,
                event.entity,
                (event.entityId ?? '-').slice(0, 24),
                JSON.stringify(event.metadata).slice(0, 220),
              ]),
            },
          },
        ],
      })
      const saved = await saveReportPdf({
        filename: `auditoria-${result.trackingCode}.pdf`,
        bytes: result.bytes,
        trackingCode: result.trackingCode,
        title: 'Relatorio de Auditoria',
      })
      if (saved.path) {
        toast.success(`${result.pageCount} pagina(s) exportadas em PDF.`, {
          description: `Codigo de rastreio: ${result.trackingCode}`,
        })
        await invalidate.audit()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPdfBusy(false)
    }
  }

  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <AppShell>
      <PageHeader
        title="Auditoria"
        description="Trilha local de operações sensíveis. Senhas, tokens e conteúdo de PFX nunca são registrados; apenas metadados redigidos."
        eyebrow="Rastreabilidade"
        icon={<FileClock className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => void exportAudit('csv')}>
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
            <Button variant="secondary" onClick={() => void exportAudit('json')}>
              <FileJson className="h-4 w-4" />
              Exportar JSON
            </Button>
            <Button
              variant="secondary"
              onClick={() => void exportAuditPdf()}
              disabled={pdfBusy || !settings}
            >
              {pdfBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {pdfBusy ? 'Gerando…' : 'Exportar PDF timbrado'}
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
            aria-hidden="true"
          />
          <Input
            value={entity}
            onChange={(event) => setEntity(event.target.value)}
            placeholder="Filtrar por entidade (cliente, credencial, certificado...)"
            className="pl-10"
            aria-label="Filtrar por entidade"
          />
        </div>
        <Select
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="w-[260px]"
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos os tipos</option>
          {AUDIT_TYPES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <Field label="De">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="Até">
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => void refetch()}
          title="Atualizar"
          aria-label="Atualizar auditoria"
        >
          <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)]" />
      ) : !data || data.events.length === 0 ? (
        <EmptyState
          icon={<FileClock className="h-5 w-5" />}
          title="Nenhum evento encontrado"
          description="Ajuste os filtros. A auditoria e criada automaticamente pelo aplicativo e nunca e editavel pela interface."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Entidade</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>Metadados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.events.map((event) => (
                  <TableRow
                    key={event.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setDetail({
                        type: event.type,
                        entity: event.entity,
                        createdAt: event.createdAt,
                        metadata: event.metadata,
                      })
                    }
                  >
                    <TableCell className="whitespace-nowrap text-xs text-[var(--pv-muted)]">
                      {formatDateTime(event.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {event.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{event.entity}</TableCell>
                    <TableCell className="max-w-[160px] truncate font-mono text-[10px] text-[var(--pv-muted)]">
                      {event.entityId ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[420px] truncate text-xs text-[var(--pv-muted)]">
                      {JSON.stringify(event.metadata)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-[var(--pv-muted)]">
            <span>
              {total} evento(s) • pagina {page + 1} de {pageCount}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.type}</DialogTitle>
            <DialogDescription>
              {detail?.entity} • {detail ? formatDateTime(detail.createdAt) : ''}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[420px] overflow-auto rounded-lg border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-4 text-xs dark:bg-[var(--pv-panel)] pv-scroll">
            {JSON.stringify(detail?.metadata ?? {}, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
