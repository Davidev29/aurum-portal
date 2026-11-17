'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Archive,
  Download,
  FileText,
  Pencil,
  Plus,
  Search,
  Users,
  RotateCcw,
  Upload,
  Building2,
  Loader2,
} from 'lucide-react'
import type {
  Client,
  ClientBrasilApiRefreshProgress,
  ClientBrasilApiRefreshReport,
  Certificate,
} from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useClients, useInvalidate, useCertificates } from '@/lib/queries'
import { useDebouncedValue as useDebounce } from '@/lib/hooks'
import { formatDocumentMasked, formatDate, initials } from '@/lib/utils'
import { AppShell } from '@/components/app-shell'
import { ClientTypeBadge } from '@/components/clients/client-type-badge'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Textarea } from '@/components/ui/input'
import { Select, Progress } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert } from '@/components/ui/alert'
import { ClientFormDialog } from '@/components/clients/client-form-dialog'
import { ClientsReportDialog } from '@/components/clients/clients-report-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * Resumo do pior caso dos certificados vinculados ao cliente, para a coluna
 * da lista. `undefined` = nenhum certificado vinculado (a célula mostra "—").
 */
function certSummaryFor(
  certificates: Certificate[],
): { variant: 'success' | 'warning' | 'danger'; label: string; title: string } | null {
  if (certificates.length === 0) return null
  const expiring = certificates
    .filter((certificate) => certificate.status === 'expiring')
    .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  if (expiring.length > 0) {
    const worst = expiring[0]!
    return {
      variant: 'warning',
      label: `A vencer ${Math.max(worst.daysUntilExpiry, 0)}d${expiring.length > 1 ? ` (+${expiring.length - 1})` : ''}`,
      title: expiring.map((certificate) => certificate.holderName).join(', '),
    }
  }
  const usable = certificates.filter(
    (certificate) => certificate.status === 'valid' || certificate.status === 'in_vault',
  )
  if (usable.length > 0) {
    return {
      variant: 'success',
      label: usable.length > 1 ? `${usable.length} A1 ok` : 'A1 ok',
      title: usable.map((certificate) => certificate.holderName).join(', '),
    }
  }
  const chain = certificates.filter((certificate) => certificate.status === 'chain_incomplete')
  if (chain.length > 0) {
    return {
      variant: 'warning',
      label: 'Cadeia incompleta',
      title: chain.map((certificate) => certificate.holderName).join(', '),
    }
  }
  const missing = certificates.filter((certificate) => certificate.status === 'missing_windows')
  if (missing.length > 0) {
    return {
      variant: 'danger',
      label: 'Ausente no Windows',
      title: missing.map((certificate) => certificate.holderName).join(', '),
    }
  }
  return {
    variant: 'danger',
    label: 'A1 vencido',
    title: certificates.map((certificate) => certificate.holderName).join(', '),
  }
}

export default function ClientsPage() {
  const invalidate = useInvalidate()
  const router = useRouter()
  const [search, setSearch] = React.useState('')
  const debouncedSearch = useDebounce(search)
  const [status, setStatus] = React.useState<'active' | 'archived' | 'all'>('active')
  const {
    data: clients,
    isLoading,
    isError,
    error: clientsError,
    refetch,
  } = useClients({ search: debouncedSearch || undefined, status })
  // Um certificado por linha da lista: consultas únicas, agrupadas por cliente.
  const { data: certificates } = useCertificates({ includeHistory: false })
  const certsByClient = React.useMemo(() => {
    const map = new Map<string, Certificate[]>()
    for (const certificate of certificates ?? []) {
      const clientIds = new Set<string>()
      if (certificate.clientId) clientIds.add(certificate.clientId)
      for (const client of certificate.clients) clientIds.add(client.id)
      for (const clientId of clientIds) {
        const list = map.get(clientId) ?? []
        list.push(certificate)
        map.set(clientId, list)
      }
    }
    return map
  }, [certificates])
  const [formOpen, setFormOpen] = React.useState(false)
  const [reportOpen, setReportOpen] = React.useState(false)
  const [archiving, setArchiving] = React.useState<Client | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [batchOpen, setBatchOpen] = React.useState(false)
  const [batchDocuments, setBatchDocuments] = React.useState('')
  const [batchBusy, setBatchBusy] = React.useState(false)
  const [refreshConfirmOpen, setRefreshConfirmOpen] = React.useState(false)
  const [refreshBusy, setRefreshBusy] = React.useState(false)
  const [refreshProgress, setRefreshProgress] =
    React.useState<ClientBrasilApiRefreshProgress | null>(null)
  const [refreshReport, setRefreshReport] = React.useState<ClientBrasilApiRefreshReport | null>(
    null,
  )

  React.useEffect(() => {
    const unsubscribe = aurumBitPortal().events.onClientsRefreshProgress((progress) => {
      setRefreshProgress(progress)
    })
    return unsubscribe
  }, [])

  const archive = async () => {
    if (!archiving) return
    setBusy(true)
    try {
      await aurumBitPortal().clients.archive(archiving.id)
      toast.success('Cliente arquivado. Credenciais desativadas e histórico preservado.')
      await Promise.all([invalidate.clients(), invalidate.audit(), invalidate.certificates()])
      setArchiving(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const restore = async (client: Client) => {
    try {
      await aurumBitPortal().clients.restore(client.id)
      toast.success('Cliente restaurado.')
      await Promise.all([invalidate.clients(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const filterDescription = React.useMemo(() => {
    const parts = [
      status === 'active'
        ? 'Status: Ativos'
        : status === 'archived'
          ? 'Status: Arquivados'
          : 'Status: Todos',
    ]
    const term = debouncedSearch.trim()
    if (term) parts.push(`Busca: "${term}"`)
    return parts.join(' • ')
  }, [status, debouncedSearch])

  const exportCsv = async () => {
    try {
      const result = await aurumBitPortal().clients.exportCsv()
      if (result.count > 0)
        toast.success(`${result.count} cliente(s) exportados.`, { description: result.path })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const submitBatch = async () => {
    const documents = batchDocuments
      .split(/[\n,;]+/)
      .map((item) => item.replace(/\D+/g, ''))
      .filter((item) => item.length === 11 || item.length === 14)
    if (documents.length === 0) {
      toast.error('Informe ao menos um CPF ou CNPJ valido.')
      return
    }
    setBatchBusy(true)
    let created = 0
    let skipped = 0
    try {
      for (const document of documents) {
        try {
          await aurumBitPortal().clients.create({ document, consent: true })
          created += 1
        } catch {
          skipped += 1
        }
      }
      await Promise.all([invalidate.clients(), invalidate.audit()])
      toast.success(`${created} cliente(s) cadastrado(s)`, {
        description: skipped > 0 ? `${skipped} ignorado(s) (duplicado ou erro).` : undefined,
      })
      setBatchOpen(false)
      setBatchDocuments('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBatchBusy(false)
    }
  }

  const refreshFromBrasilApi = async () => {
    setRefreshBusy(true)
    setRefreshProgress(null)
    setRefreshReport(null)
    setRefreshConfirmOpen(false)
    try {
      const report = await aurumBitPortal().clients.refreshFromBrasilApi()
      setRefreshReport(report)
      await Promise.all([invalidate.clients(), invalidate.audit()])
      toast.success(`${report.updated} cliente(s) atualizado(s)`, {
        description:
          report.skipped > 0 || report.errors > 0
            ? `${report.skipped} ignorado(s) • ${report.errors} com erro (CNPJ indisponível ou CPF sem certificado vinculado).`
            : 'Somente o cadastro (nome, e-mail, telefone) foi alterado.',
      })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRefreshBusy(false)
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Clientes"
        description="Titulares PF/PJ atendidos pelo escritório. Cada cliente pode ter vários certificados, credenciais e sessões simultâneas."
        eyebrow="Gestão de clientes"
        icon={<Users className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => void exportCsv()}>
              <Download className="h-4 w-4" />
              Exportar CSV
            </Button>
            <Button variant="secondary" onClick={() => setReportOpen(true)}>
              <FileText className="h-4 w-4" />
              Relatório
            </Button>
            <Button variant="secondary" onClick={() => setBatchOpen(true)}>
              <Upload className="h-4 w-4" />
              Cadastro em lote
            </Button>
            <Button
              variant="secondary"
              onClick={() => setRefreshConfirmOpen(true)}
              disabled={refreshBusy}
            >
              {refreshBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Building2 className="h-4 w-4" />
              )}
              Atualizar todos (Brasil API)
            </Button>
            <Button
              onClick={() => {
                setFormOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              Novo cliente
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, documento ou tag…"
            className="pl-10"
            aria-label="Buscar clientes"
          />
        </div>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as 'active' | 'archived' | 'all')}
          className="w-full sm:w-[190px]"
        >
          <option value="active">Ativos</option>
          <option value="archived">Arquivados</option>
          <option value="all">Todos</option>
        </Select>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)]" />
      ) : isError ? (
        <div
          className="rounded-2xl border border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] p-6 text-center"
          role="alert"
        >
          <p className="text-sm font-semibold">Não foi possível carregar os clientes</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--pv-muted)]">
            {clientsError ? errorMessage(clientsError) : 'Falha desconhecida.'} Tente novamente.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void refetch()}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </Button>
        </div>
      ) : !clients || clients.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title={search ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          description={
            search
              ? 'Ajuste a busca ou o filtro de status.'
              : 'Cadastre o primeiro titular para vincular certificados A1 e credenciais de portais.'
          }
          action={
            <Button
              onClick={() => {
                setFormOpen(true)
              }}
            >
              <Plus className="h-4 w-4" />
              Cadastrar cliente
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Documento</TableHead>
                <TableHead className="hidden lg:table-cell">Contato</TableHead>
                <TableHead className="hidden 2xl:table-cell">Tags</TableHead>
                <TableHead className="hidden lg:table-cell">Certificado</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden 2xl:table-cell">Criado</TableHead>
                <TableHead className="w-[104px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <Link
                      href={`/clients/detail?id=${encodeURIComponent(client.id)}`}
                      className="flex max-w-[210px] items-center gap-3 xl:max-w-[340px] 2xl:max-w-none"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">
                        {initials(client.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{client.name}</span>
                        <span className="mt-0.5 block">
                          <ClientTypeBadge type={client.type} />
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">
                    {formatDocumentMasked(client.document)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div
                      className="max-w-[240px] truncate text-xs"
                      title={client.email ?? undefined}
                    >
                      {client.email ?? '—'}
                    </div>
                    <div className="text-xs text-[var(--pv-muted)]">{client.phone ?? ''}</div>
                  </TableCell>
                  <TableCell className="hidden 2xl:table-cell">
                    <div className="flex max-w-[190px] flex-wrap gap-1">
                      {client.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                      {client.tags.length > 3 ? (
                        <Badge variant="outline">+{client.tags.length - 3}</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {(() => {
                      const summary = certSummaryFor(certsByClient.get(client.id) ?? [])
                      if (!summary) return <span className="text-xs text-[var(--pv-muted)]">—</span>
                      return (
                        <Badge variant={summary.variant} title={`Certificado: ${summary.title}`}>
                          {summary.label}
                        </Badge>
                      )
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={client.status === 'active' ? 'success' : 'secondary'}>
                      {client.status === 'active' ? 'Ativo' : 'Arquivado'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden 2xl:table-cell text-xs text-[var(--pv-muted)]">
                    {formatDate(client.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          router.push(`/clients/detail?id=${encodeURIComponent(client.id)}&edit=1`)
                        }
                        title="Editar"
                        aria-label="Editar cliente (abre a tela do cliente em modo de edicao)"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {client.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setArchiving(client)}
                          title="Arquivar"
                          aria-label="Arquivar cliente"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void restore(client)}
                          title="Restaurar"
                          aria-label="Restaurar cliente"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <ClientsReportDialog
        clients={clients ?? []}
        filterDescription={filterDescription}
        open={reportOpen}
        onOpenChange={setReportOpen}
      />

      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Cadastro em lote</DialogTitle>
            <DialogDescription>
              Cole CPFs ou CNPJs (um por linha, separados por vírgula ou ponto e vírgula). Os dados
              básicos serão consultados na Brasil API quando disponível.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={batchDocuments}
            onChange={(event) => setBatchDocuments(event.target.value)}
            rows={8}
            className="font-mono text-sm"
            placeholder={'12345678909\n00000000000191'}
            aria-label="Lista de documentos"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setBatchOpen(false)} disabled={batchBusy}>
              Cancelar
            </Button>
            <Button onClick={() => void submitBatch()} disabled={batchBusy}>
              {batchBusy ? 'Cadastrando…' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(archiving)}
        onOpenChange={(open) => {
          if (!open) setArchiving(null)
        }}
        title="Arquivar cliente?"
        description={
          <>
            <strong>{archiving?.name}</strong> será marcado como arquivado. Credenciais deixam de
            ser elegíveis, sessões existentes continuam até serem fechadas e o histórico de
            auditoria é preservado. A remoção do certificado do Windows exige ação separada em
            Certificados.
          </>
        }
        confirmLabel="Arquivar cliente"
        busy={busy}
        onConfirm={() => void archive()}
      />
      <ConfirmDialog
        open={refreshConfirmOpen}
        onOpenChange={(open) => {
          if (!refreshBusy) setRefreshConfirmOpen(open)
        }}
        title="Atualizar todos (Brasil API e certificados)"
        description={
          <>
            Clientes <strong>pessoa jurídica (CNPJ)</strong> são consultados na
            <strong>brasilapi.com.br</strong> usando apenas o CNPJ (nenhum nome, e-mail ou outro
            dado sai desta estação). Razão social, e-mail e telefone oficiais são gravados no
            cadastro.
            <br />
            Clientes <strong>pessoa física (CPF)</strong> têm o nome preenchido automaticamente a
            partir do <strong>titular do certificado digital</strong> vinculado ao cadastro (quando
            houver).
            <br />
            <br />
            <strong>Certificados, credenciais e sessões não são alterados</strong>— apenas os dados
            de cadastro. A operação é registrada na auditoria com o documento mascarado.
          </>
        }
        confirmLabel="Atualizar todos"
        variant="default"
        busy={refreshBusy}
        onConfirm={() => void refreshFromBrasilApi()}
      />
      <Dialog open={refreshBusy} onOpenChange={() => undefined} modal>
        <DialogContent
          className="h-[400px] max-h-[92vh] w-[calc(100vw-2rem)] max-w-md overflow-hidden"
          hideClose
          animate={false}
        >
          <DialogHeader>
            <DialogTitle>Atualizando clientes...</DialogTitle>
            <DialogDescription>
              Consultando CNPJ na Brasil API e preenchendo nome de CPF a partir do certificado
              vinculado. Não feche a janela.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
            <div className="flex min-h-[28px] items-center gap-3">
              <Loader2
                className="h-6 w-6 shrink-0 animate-spin text-[var(--pv-accent)]"
                aria-hidden="true"
              />
              <p
                className="truncate text-sm tabular-nums text-[var(--pv-muted)]"
                aria-live="polite"
              >
                {refreshProgress
                  ? `Processados ${refreshProgress.completed} de ${refreshProgress.total}` +
                    (refreshProgress.remaining > 0
                      ? ` • Faltam ${refreshProgress.remaining}`
                      : ' • Quase pronto…')
                  : 'Iniciando…'}
              </p>
            </div>

            <div className="min-h-[88px]">
              {refreshProgress && refreshProgress.total > 0 ? (
                <div className="space-y-3">
                  <Progress value={(refreshProgress.completed / refreshProgress.total) * 100} />
                  <div className="grid grid-cols-3 gap-2 text-center text-sm" aria-live="polite">
                    <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3">
                      <div className="text-xs text-[var(--pv-muted)]">Atualizados</div>
                      <div className="text-xl font-semibold tabular-nums text-[var(--pv-success)]">
                        {refreshProgress.updated}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3">
                      <div className="text-xs text-[var(--pv-muted)]">Ignorados</div>
                      <div className="text-xl font-semibold tabular-nums">
                        {refreshProgress.skipped}
                      </div>
                    </div>
                    <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3">
                      <div className="text-xs text-[var(--pv-muted)]">Erros</div>
                      <div className="text-xl font-semibold tabular-nums text-[var(--pv-danger)]">
                        {refreshProgress.errors}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[var(--pv-muted)]">Lendo a lista de clientes...</p>
              )}
            </div>

            <p className="min-h-[20px] truncate font-mono text-xs text-[var(--pv-muted)]">
              {refreshProgress?.currentDocument
                ? `Atual: ${refreshProgress.currentName ?? '—'} • ${formatDocumentMasked(refreshProgress.currentDocument)}`
                : ' '}
            </p>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(refreshReport)}
        onOpenChange={(open) => !open && setRefreshReport(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resultado da atualização</DialogTitle>
            <DialogDescription>
              {refreshReport
                ? `Total: ${refreshReport.total} • Atualizados: ${refreshReport.updated} • Ignorados: ${refreshReport.skipped} • Erros: ${refreshReport.errors}.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {refreshReport && refreshReport.errors > 0 ? (
            <Alert variant="warning">
              Alguns CNPJs não foram encontrados ou a Brasil API estava indisponível. Os demais
              clientes foram atualizados normalmente.
            </Alert>
          ) : null}
          <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--pv-border)] pv-scroll">
            <table className="w-full text-sm">
              <thead className="bg-[var(--pv-panel-2)] text-left text-xs uppercase tracking-wide text-[var(--pv-muted)] dark:bg-[var(--pv-panel-2)]">
                <tr>
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {refreshReport?.items.map((item) => (
                  <tr key={item.clientId} className="border-t border-[var(--pv-border)]">
                    <td className="px-3 py-2 font-mono text-xs">{item.document}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant={
                          item.status === 'updated'
                            ? 'success'
                            : item.status === 'skipped'
                              ? 'secondary'
                              : 'danger'
                        }
                      >
                        {item.status === 'updated'
                          ? 'Atualizado'
                          : item.status === 'skipped'
                            ? 'Ignorado'
                            : 'Erro'}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--pv-muted)]">
                      {item.message ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button onClick={() => setRefreshReport(null)}>Concluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}
