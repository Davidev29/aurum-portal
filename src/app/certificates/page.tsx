'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  FolderInput,
  Link2,
  MonitorCheck,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  TestTube2,
  X,
  XCircle,
  UserPlus,
} from 'lucide-react'
import type { Certificate, CertificateTestResult } from '@shared/types'
import { CERTIFICATE_STATUSES } from '@shared/constants'
import { certificateEffectiveValidToOf } from '@shared/certificate-renewal'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useCertificates, useCertificateStats, useInvalidate, useSettings } from '@/lib/queries'
import { generateReportPdf } from '@/lib/pdf/report-document'
import { saveReportPdf } from '@/lib/pdf/save-report'
import { useDebouncedValue, useSearchParam } from '@/lib/hooks'
import { cn, formatDate, formatDateTime, initials } from '@/lib/utils'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Input, Field } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'
import { CertificateDetailsDialog } from '@/components/certificates/certificate-details-dialog'
import { CertificateImportWizard } from '@/components/certificates/certificate-import-wizard'
import { WindowsCertificateDialog } from '@/components/certificates/windows-certificate-dialog'
import { CertificateLinkDialog } from '@/components/certificates/certificate-link-dialog'

const statusLabels: Record<string, string> = {
  all: 'Todos os status',
  valid: 'Validos',
  expiring: 'A vencer',
  expired: 'Vencidos',
  in_vault: 'Somente no cofre',
  missing_windows: 'Ausentes no Windows',
  chain_incomplete: 'Cadeia incompleta',
}

/** Itens de paginação com reticências: 1 … 4 5 6 … 12 (sem listas gigantes). */
function getPageItems(
  current: number,
  total: number,
): Array<number | 'ellipsis-start' | 'ellipsis-end'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis-end', total]
  if (current >= total - 3)
    return [1, 'ellipsis-start', total - 4, total - 3, total - 2, total - 1, total]
  return [1, 'ellipsis-start', current - 1, current, current + 1, 'ellipsis-end', total]
}

function formatCertificateDocument(certificate: Certificate): string | null {
  if (!certificate.document) return null
  const digits = certificate.document.replace(/\D+/g, '')
  if (certificate.documentType === 'CPF' && digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  }
  if (certificate.documentType === 'CNPJ' && digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  }
  return certificate.document
}

const certificateStatusText: Record<string, { label: string; className: string }> = {
  valid: { label: 'Válido', className: 'text-[var(--pv-success)]' },
  expiring: { label: 'A vencer', className: 'text-[var(--pv-warning)]' },
  expired: { label: 'Vencido', className: 'text-[var(--pv-danger)]' },
  in_vault: { label: 'No cofre', className: 'text-[var(--pv-muted)]' },
  missing_windows: { label: 'Ausente no Windows', className: 'text-[var(--pv-danger)]' },
  chain_incomplete: { label: 'Cadeia incompleta', className: 'text-[var(--pv-warning)]' },
}

function renewalText(certificate: Certificate): { text: string; className: string } {
  const renewed = certificate.isRenewed === true || certificate.hasNewerValid === true
  const expired = certificate.status === 'expired' || certificate.daysUntilExpiry < 0
  const expiring = certificate.status === 'expiring'
  if (renewed) {
    return {
      text: `Renovado — válido até ${formatDate(certificateEffectiveValidToOf(certificate))}`,
      className: 'text-[var(--pv-success)]',
    }
  }
  if (expired) return { text: 'Aguardando renovação', className: 'text-[var(--pv-danger)]' }
  if (expiring) return { text: 'A vencer — renovar', className: 'text-[var(--pv-warning)]' }
  if (certificate.hasOlderCertificate)
    return { text: 'Atual (renovação de anterior)', className: 'text-[var(--pv-muted)]' }
  return { text: 'Em vigor, sem renovação pendente', className: 'text-[var(--pv-muted)]' }
}

export default function CertificatesPage() {
  const invalidate = useInvalidate()
  const importParam = useSearchParam('import')
  const certificateDetailParam = useSearchParam('certificateId')
  const [search, setSearch] = React.useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [status, setStatus] = React.useState<string>('all')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const {
    data: certificates,
    isLoading,
    isFetching,
    isError: certificatesError,
    error: certificatesLoadError,
    refetch: refetchCertificates,
  } = useCertificates({
    search: debouncedSearch || undefined,
    status: (status === 'all' ? undefined : status) as
      | 'valid'
      | 'expiring'
      | 'expired'
      | 'in_vault'
      | 'missing_windows'
      | 'chain_incomplete'
      | undefined,
  })
  // Universo completo (sem filtro e com certificados históricos já renovados)
  // para o histórico de renovação do modal: a listagem principal mostra apenas
  // o certificado atual de cada CNPJ/CPF, mas o modal exibe também os outros.
  const { data: allCertificates } = useCertificates({ includeHistory: true })
  const { data: stats } = useCertificateStats()

  // Revarredura completa: atualiza a presença no Windows e recalcula o status
  // de vencimento/renovação de todos os certificados sobre o universo completo.
  const refreshAllCertificates = React.useCallback(async () => {
    try {
      await aurumBitPortal().certificates.refreshAll()
      await Promise.all([invalidate.certificates(), invalidate.certificateStats()])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }, [invalidate])

  // Paginação client-side sobre o resultado já filtrado (busca/status no servidor).
  const total = certificates?.length ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const paginatedCertificates = React.useMemo(() => {
    const start = (page - 1) * pageSize
    return (certificates ?? []).slice(start, start + pageSize)
  }, [certificates, page, pageSize])
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(total, page * pageSize)
  const pageItems = React.useMemo(
    () => getPageItems(Math.min(page, totalPages), totalPages),
    [page, totalPages],
  )
  const hasActiveFilters = search.trim() !== '' || status !== 'all'
  const clearFilters = React.useCallback(() => {
    setSearch('')
    setStatus('all')
  }, [])
  // Cards de resumo: clicar aplica (ou, se já ativo, remove) o filtro de status.
  const toggleStatusFilter = React.useCallback((value: string) => {
    setStatus((current) => (value === 'all' ? 'all' : current === value ? 'all' : value))
  }, [])

  // Volta para a primeira página quando busca, filtro ou tamanho mudam;
  // corrige a página se o resultado encolher abaixo dela.
  React.useEffect(() => {
    setPage(1)
  }, [debouncedSearch, status, pageSize])
  React.useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [renewalCertificate, setRenewalCertificate] = React.useState<Certificate | null>(null)
  const [windowsOpen, setWindowsOpen] = React.useState(false)
  const [detailCertificate, setDetailCertificate] = React.useState<Certificate | null>(null)
  const [linkCertificate, setLinkCertificate] = React.useState<Certificate | null>(null)
  const [testResult, setTestResult] = React.useState<CertificateTestResult | null>(null)
  const [testCertificate, setTestCertificate] = React.useState<Certificate | null>(null)
  const [testing, setTesting] = React.useState<string | null>(null)
  const [backupCertificate, setBackupCertificate] = React.useState<Certificate | null>(null)
  const [passphrase, setPassphrase] = React.useState('')
  const [uninstallCertificate, setUninstallCertificate] = React.useState<Certificate | null>(null)
  const [uninstallConfirm, setUninstallConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // Modal de geracao de relatorio de certificados.
  const [reportModalOpen, setReportModalOpen] = React.useState(false)
  const [pdfBusy, setPdfBusy] = React.useState(false)

  const { data: settings } = useSettings()

  React.useEffect(() => {
    if (importParam === '1') setWizardOpen(true)
  }, [importParam])

  // Deep-link a partir da tela do cliente: /certificates?certificateId=<id> abre o olhinho.
  React.useEffect(() => {
    if (!certificateDetailParam) return
    const found =
      allCertificates?.find((certificate) => certificate.id === certificateDetailParam) ??
      certificates?.find((certificate) => certificate.id === certificateDetailParam)
    if (found) setDetailCertificate(found)
  }, [certificateDetailParam, allCertificates, certificates])

  const openRenewal = React.useCallback((certificate: Certificate) => {
    setDetailCertificate(null)
    setRenewalCertificate(certificate)
    setWizardOpen(true)
  }, [])

  const runTest = async (certificate: Certificate) => {
    setTesting(certificate.id)
    setTestCertificate(certificate)
    setTestResult(null)
    try {
      const result = await aurumBitPortal().certificates.test(certificate.id)
      setTestResult(result)
      await Promise.all([invalidate.certificates(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
      setTestCertificate(null)
    } finally {
      setTesting(null)
    }
  }

  const install = async (certificate: Certificate) => {
    try {
      await aurumBitPortal().certificates.install(certificate.id)
      toast.success('Certificado instalado no repositório do Windows.')
      await Promise.all([
        invalidate.certificates(),
        invalidate.certificateStats(),
        invalidate.audit(),
      ])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const createClientFromCertificate = async (certificate: Certificate) => {
    if (!certificate.document) {
      toast.error('Documento não identificado no certificado.')
      return
    }
    try {
      const client = await aurumBitPortal().clients.create({
        document: certificate.document,
        name: certificate.holderName?.trim(),
        consent: true,
      })
      await aurumBitPortal().certificates.linkClient({
        id: certificate.id,
        clientId: client.id,
        consent: true,
      })
      toast.success('Cliente cadastrado e vinculado ao certificado.')
      await Promise.all([invalidate.clients(), invalidate.certificates(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const backup = async () => {
    if (!backupCertificate) return
    setBusy(true)
    try {
      const result = await aurumBitPortal().certificates.exportBackup({
        id: backupCertificate.id,
        passphrase,
      })
      toast.success('Backup criptografado criado.', { description: result.path })
      await invalidate.audit()
      setBackupCertificate(null)
      setPassphrase('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const uninstall = async () => {
    if (!uninstallCertificate) return
    setBusy(true)
    try {
      await aurumBitPortal().certificates.uninstall({
        id: uninstallCertificate.id,
        confirmation: 'REMOVER',
      })
      toast.success('Certificado removido do repositório do Windows.')
      await Promise.all([
        invalidate.certificates(),
        invalidate.certificateStats(),
        invalidate.audit(),
      ])
      setUninstallCertificate(null)
      setUninstallConfirm('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const reportFilterLabels: Record<string, string> = {
    valid: 'Certificados Validos',
    expiring: 'Certificados a vencer',
    expired: 'Certificados vencidos',
  }

  const exportCertificatesPdf = async (filter: 'valid' | 'expiring' | 'expired') => {
    if (!settings || pdfBusy) return
    setPdfBusy(true)
    setReportModalOpen(false)
    try {
      const certificates = await aurumBitPortal().certificates.list({ status: filter })
      if (certificates.length === 0) {
        toast.info(
          'Nenhum certificado corresponde ao filtro selecionado; nenhum arquivo foi criado.',
        )
        return
      }
      const result = await generateReportPdf({
        title: 'Relatorio de Certificados',
        subtitle: reportFilterLabels[filter],
        meta: [
          `Gerado em ${formatDateTime(new Date().toISOString())}`,
          `Filtro: ${reportFilterLabels[filter]}`,
          `${certificates.length} certificado(s) no relatorio.`,
        ],
        office: settings.office,
        letterhead: settings.letterhead,
        sections: [
          {
            heading: 'Certificados',
            table: {
              columns: [
                'Titular',
                'Documento',
                'Validade ate',
                'Status',
                'Origem',
                'Clientes vinculados',
              ],
              widths: [2.2, 1.4, 1.1, 1.0, 0.9, 1.4],
              rows: certificates.map((certificate) => [
                certificate.holderName || certificate.label,
                formatCertificateDocument(certificate) ?? '-',
                formatDate(certificateEffectiveValidToOf(certificate)),
                certificateStatusText[certificate.status]?.label ?? certificate.status,
                certificate.source === 'windows' ? 'Windows' : 'PFX',
                certificate.clients.length === 0
                  ? '-'
                  : certificate.clients.map((client) => client.name).join(', '),
              ]),
            },
          },
        ],
      })
      const saved = await saveReportPdf({
        filename: `certificados-${filter}-${result.trackingCode}.pdf`,
        bytes: result.bytes,
        trackingCode: result.trackingCode,
        title: 'Relatorio de Certificados',
      })
      if (saved.path) {
        toast.success(`${result.pageCount} pagina(s) exportadas em PDF.`, {
          description: `Codigo de rastreio: ${result.trackingCode}`,
        })
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Certificados A1"
        description="Importe PFX/P12, leia certificados do Windows e acompanhe vencimentos. A instalação usa Cert:\\CurrentUser\\My sem administrador."
        eyebrow="Identidades digitais"
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => setWindowsOpen(true)}>
              <MonitorCheck className="h-4 w-4" />
              Importar do Windows
            </Button>
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4" />
              Importar PFX
            </Button>
            <Button
              variant="secondary"
              onClick={() => setReportModalOpen(true)}
              disabled={pdfBusy || !settings}
            >
              <FileText className="h-4 w-4" />
              {pdfBusy ? 'Gerando…' : 'Gerar relatorio'}
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total no cofre"
          value={stats?.total ?? 0}
          icon={<ShieldCheck className="h-4 w-4" />}
          active={status === 'all'}
          onClick={() => toggleStatusFilter('all')}
        />
        <StatCard
          label="A vencer"
          value={stats?.expiring ?? 0}
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          active={status === 'expiring'}
          onClick={() => toggleStatusFilter('expiring')}
        />
        <StatCard
          label="Vencidos"
          value={stats?.expired ?? 0}
          tone="danger"
          icon={<XCircle className="h-4 w-4" />}
          active={status === 'expired'}
          onClick={() => toggleStatusFilter('expired')}
        />
        <StatCard
          label="Ausentes no Windows"
          value={stats?.missingWindows ?? 0}
          tone="danger"
          icon={<ShieldOff className="h-4 w-4" />}
          active={status === 'missing_windows'}
          onClick={() => toggleStatusFilter('missing_windows')}
        />
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por titular ou documento…"
            className="pl-10 pr-10"
            aria-label="Buscar certificados"
            type="search"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Limpar busca"
              title="Limpar busca"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--pv-muted)] transition hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="w-full sm:w-[220px]"
          aria-label="Filtrar por status"
        >
          <option value="all">Todos os status</option>
          {CERTIFICATE_STATUSES.map((item) => (
            <option key={item} value={item}>
              {statusLabels[item] ?? item}
            </option>
          ))}
        </Select>
        {hasActiveFilters ? (
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="icon"
          onClick={() => void refreshAllCertificates()}
          disabled={isFetching}
          title="Revarrer certificados (atualiza presença no Windows e recalcula vencimentos)"
          aria-label="Revarrer certificados"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)]" />
      ) : certificatesError ? (
        <div
          className="rounded-2xl border border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] p-6 text-center"
          role="alert"
        >
          <p className="text-sm font-semibold">Não foi possível carregar os certificados</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--pv-muted)]">
            {certificatesLoadError ? errorMessage(certificatesLoadError) : 'Falha desconhecida.'}{' '}
            Tente novamente.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void refetchCertificates()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar novamente
          </Button>
        </div>
      ) : !certificates || certificates.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-5 w-5" />}
          title={
            hasActiveFilters ? 'Nenhum certificado encontrado' : 'Nenhum certificado cadastrado'
          }
          description={
            hasActiveFilters
              ? 'Ajuste a busca ou o filtro de status para ver mais resultados.'
              : 'Importe um arquivo PFX/P12 ou leia os certificados já instalados no Windows.'
          }
          action={
            hasActiveFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => setWizardOpen(true)}>Importar PFX</Button>
                <Button variant="secondary" onClick={() => setWindowsOpen(true)}>
                  Importar do Windows
                </Button>
              </div>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)]">
          <Table className="min-w-[840px]">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[280px]">Titular</TableHead>
                <TableHead className="w-[180px]">Validade</TableHead>
                <TableHead className="w-[160px]">Status</TableHead>
                <TableHead className="hidden w-[150px] xl:table-cell">Origem</TableHead>
                <TableHead className="hidden w-[190px] 2xl:table-cell">Clientes</TableHead>
                <TableHead className="w-[220px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedCertificates.map((certificate) => (
                <TableRow key={certificate.id}>
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200"
                      >
                        {initials(certificate.holderName || certificate.label)}
                      </span>
                      <span className="min-w-0">
                        <span
                          className="block truncate font-medium text-[var(--pv-text)]"
                          title={certificate.label}
                        >
                          {certificate.label}
                        </span>
                        <span
                          className="block truncate text-xs text-[var(--pv-muted)]"
                          title={certificate.holderName}
                        >
                          {certificate.holderName}
                          {formatCertificateDocument(certificate)
                            ? ` • ${formatCertificateDocument(certificate)}`
                            : ''}
                        </span>
                        <span
                          className="mt-0.5 block max-w-[260px] truncate font-mono text-[10px] text-[var(--pv-muted)]"
                          title={certificate.thumbprintSha256}
                        >
                          {certificate.thumbprintSha256.slice(0, 24)}…
                        </span>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold tabular-nums text-[var(--pv-text)]">
                        {formatDate(certificateEffectiveValidToOf(certificate))}
                      </span>
                      <span className="text-xs text-[var(--pv-muted)]">
                        Início {formatDate(certificate.validFrom)}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          certificate.status === 'expired'
                            ? 'text-[var(--pv-danger)]'
                            : certificate.status === 'expiring'
                              ? 'text-[var(--pv-warning)]'
                              : 'text-[var(--pv-success)]'
                        }`}
                      >
                        {certificate.daysUntilExpiry >= 0
                          ? `Vence em ${certificate.daysUntilExpiry} dia(s)`
                          : `Vencido há ${Math.abs(certificate.daysUntilExpiry)} dia(s)`}
                      </span>
                      <span className={`text-xs ${renewalText(certificate).className}`}>
                        {renewalText(certificate).text}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-0.5">
                      <span
                        className={`text-xs font-semibold ${certificateStatusText[certificate.status]?.className ?? 'text-[var(--pv-muted)]'}`}
                      >
                        {certificateStatusText[certificate.status]?.label ?? certificate.status}
                      </span>
                      {certificate.isRenewed || certificate.hasNewerValid ? (
                        <span className="text-xs text-[var(--pv-success)]">
                          Renovado até {formatDate(certificateEffectiveValidToOf(certificate))}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-xs font-medium text-[var(--pv-text)]">
                        {certificate.source === 'windows' ? 'Windows' : 'PFX'}
                      </span>
                      <span
                        className={`text-xs ${
                          certificate.installed
                            ? 'text-[var(--pv-success)]'
                            : 'text-[var(--pv-muted)]'
                        }`}
                      >
                        {certificate.installed ? 'Instalado' : 'Não instalado'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden 2xl:table-cell">
                    <div className="flex max-w-[190px] flex-col gap-0.5">
                      {certificate.clients.length === 0 ? (
                        <span className="text-xs text-[var(--pv-muted)]">Sem vínculo</span>
                      ) : (
                        <>
                          {certificate.clients.slice(0, 2).map((client) => (
                            <Link
                              key={client.id}
                              href={`/clients/detail?id=${encodeURIComponent(client.id)}`}
                              title={client.name}
                              className="max-w-[190px] truncate text-xs font-medium text-[var(--pv-accent)] underline-offset-2 hover:underline"
                            >
                              {client.name}
                            </Link>
                          ))}
                          {certificate.clients.length > 2 ? (
                            <span
                              title={certificate.clients
                                .slice(2)
                                .map((client) => client.name)
                                .join(', ')}
                              className="text-xs text-[var(--pv-muted)]"
                            >
                              +{certificate.clients.length - 2} cliente(s)
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-nowrap items-center justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Ver dados e histórico de renovação"
                        aria-label="Ver dados e histórico de renovação"
                        onClick={() => setDetailCertificate(certificate)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Testar injeção mTLS"
                        aria-label="Testar injeção mTLS"
                        onClick={() => void runTest(certificate)}
                        disabled={testing === certificate.id}
                      >
                        <TestTube2
                          className={`h-4 w-4 ${testing === certificate.id ? 'animate-pulse' : ''}`}
                        />
                      </Button>
                      {!certificate.installed ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Instalar no Windows"
                          aria-label="Instalar no Windows"
                          onClick={() => void install(certificate)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Remover do Windows"
                          aria-label="Remover do Windows"
                          onClick={() => setUninstallCertificate(certificate)}
                        >
                          <ShieldOff className="h-4 w-4 text-[var(--pv-warning)]" />
                        </Button>
                      )}
                      {certificate.clients.length === 0 ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Cadastrar cliente a partir do certificado"
                          aria-label="Cadastrar cliente a partir do certificado"
                          onClick={() => void createClientFromCertificate(certificate)}
                        >
                          <UserPlus className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Vincular cliente"
                        aria-label="Vincular cliente"
                        onClick={() => setLinkCertificate(certificate)}
                      >
                        <Link2 className="h-4 w-4" />
                      </Button>
                      {!(certificate.isRenewed || certificate.hasNewerValid) &&
                      (certificate.status === 'expired' || certificate.status === 'expiring') ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Renovar — importar novo certificado"
                          aria-label="Renovar — importar novo certificado"
                          onClick={() => openRenewal(certificate)}
                        >
                          <RefreshCw className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Backup criptografado do PFX"
                        aria-label="Backup criptografado do PFX"
                        disabled={!certificate.hasPfx}
                        onClick={() => {
                          setBackupCertificate(certificate)
                          setPassphrase('')
                        }}
                      >
                        <FolderInput className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-3 border-t border-[var(--pv-border)] bg-[var(--pv-panel-2)]/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs tabular-nums text-[var(--pv-muted)]" aria-live="polite">
                Mostrando{' '}
                <strong className="font-semibold text-[var(--pv-text)]">
                  {rangeStart}–{rangeEnd}
                </strong>{' '}
                de <strong className="font-semibold text-[var(--pv-text)]">{total}</strong>{' '}
                certificado(s)
              </p>
              <label className="flex items-center gap-2 text-xs text-[var(--pv-muted)]">
                <Select
                  value={String(pageSize)}
                  onChange={(event) => setPageSize(Number(event.target.value))}
                  className="w-[130px]"
                  aria-label="Certificados por página"
                >
                  <option value="10">10 por página</option>
                  <option value="25">25 por página</option>
                  <option value="50">50 por página</option>
                </Select>
              </label>
            </div>
            {totalPages > 1 ? (
              <nav className="flex items-center gap-1" aria-label="Paginação de certificados">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label="Página anterior"
                  className="px-2"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {pageItems.map((item, index) =>
                  item === 'ellipsis-start' || item === 'ellipsis-end' ? (
                    <span
                      key={`${item}-${index}`}
                      className="px-1 text-[var(--pv-muted)]"
                      aria-hidden="true"
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      size="sm"
                      variant={item === page ? 'default' : 'secondary'}
                      onClick={() => setPage(item)}
                      className="min-w-9 px-2 tabular-nums"
                      aria-current={item === page ? 'page' : undefined}
                    >
                      {item}
                    </Button>
                  ),
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  aria-label="Próxima página"
                  className="px-2"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </nav>
            ) : null}
          </div>
        </div>
      )}

      <CertificateImportWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open)
          if (!open) setRenewalCertificate(null)
        }}
        defaultClientId={renewalCertificate?.clientId ?? undefined}
        renewalCertificate={renewalCertificate}
      />
      <CertificateDetailsDialog
        open={Boolean(detailCertificate)}
        onOpenChange={(open) => {
          if (!open) setDetailCertificate(null)
        }}
        certificate={detailCertificate}
        allCertificates={allCertificates ?? certificates ?? []}
        onRenew={openRenewal}
        onSelectCertificate={setDetailCertificate}
      />
      <WindowsCertificateDialog open={windowsOpen} onOpenChange={setWindowsOpen} />
      <CertificateLinkDialog
        open={Boolean(linkCertificate)}
        onOpenChange={(open) => {
          if (!open) setLinkCertificate(null)
        }}
        certificate={linkCertificate}
      />

      <Dialog
        open={Boolean(testCertificate)}
        onOpenChange={(open) => {
          if (!open) {
            setTestCertificate(null)
            setTestResult(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Diagnostico de injecao</DialogTitle>
            <DialogDescription>
              Servidor mTLS local efemero que verifica qual certificado o Chromium apresentou no
              handshake.
            </DialogDescription>
          </DialogHeader>
          {!testResult ? (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--pv-border)] p-4 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin text-[var(--pv-accent)]" />
              Executando teste com {testCertificate?.label}...
            </div>
          ) : (
            <div className="space-y-3">
              <Alert
                variant={testResult.ok ? 'success' : 'danger'}
                title={testResult.ok ? 'Certificado correto' : 'Falha no teste'}
              >
                {testResult.message}
              </Alert>
              <div className="space-y-2 text-xs">
                <div>
                  <div className="text-[var(--pv-muted)]">Esperado (SHA-256)</div>
                  <div className="break-all font-mono">{testResult.expectedThumbprintSha256}</div>
                </div>
                <div>
                  <div className="text-[var(--pv-muted)]">Apresentado</div>
                  <div className="break-all font-mono">
                    {testResult.presentedThumbprintSha256 ?? 'Nenhum certificado apresentado'}
                  </div>
                </div>
                <div className="text-[var(--pv-muted)]">
                  Executado em {formatDateTime(testResult.testedAt)}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTestCertificate(null)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(backupCertificate)}
        onOpenChange={(open) => {
          if (!open) {
            setBackupCertificate(null)
            setPassphrase('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backup criptografado do PFX</DialogTitle>
            <DialogDescription>
              O backup usa Argon2id + AES-256-GCM. Guarde a frase-senha em local separado; sem ela o
              arquivo não pode ser restaurado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Frase-senha do backup" required hint="Minimo de 12 caracteres">
              <Input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Alert variant="warning">
              O arquivo .pvbackup poderá ser restaurado apenas com esta frase-senha. Não há
              recuperação pelo suporte.
            </Alert>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setBackupCertificate(null)
                setPassphrase('')
              }}
            >
              Cancelar
            </Button>
            <Button onClick={() => void backup()} disabled={busy || passphrase.length < 12}>
              {busy ? 'Gerando…' : 'Exportar backup'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(uninstallCertificate)}
        onOpenChange={(open) => {
          if (!open) {
            setUninstallCertificate(null)
            setUninstallConfirm('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover certificado do Windows</DialogTitle>
            <DialogDescription>
              Esta ação remove o certificado de Cert:\CurrentUser\My. Outros aplicativos do Windows
              (Chrome, Edge, etc.) deixarão de vê-lo. A cópia no cofre é preservada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Alert variant="warning">
              Sessões abertas com este certificado serão bloqueadas. Feche-as antes de remover.
            </Alert>
            <Field label="Digite REMOVER para confirmar" required>
              <Input
                value={uninstallConfirm}
                onChange={(event) => setUninstallConfirm(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setUninstallCertificate(null)
                setUninstallConfirm('')
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void uninstall()}
              disabled={busy || uninstallConfirm !== 'REMOVER'}
            >
              {busy ? 'Removendo…' : 'Remover do Windows'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reportModalOpen} onOpenChange={setReportModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar relatorio de certificados</DialogTitle>
            <DialogDescription>
              Escolha o filtro a aplicar aos certificados no relatorio PDF timbrado do sistema.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Button
              onClick={() => void exportCertificatesPdf('valid')}
              disabled={pdfBusy || !settings}
              className="w-full justify-start"
            >
              <ShieldCheck className="h-4 w-4 mr-2" />
              Certificados Validos
            </Button>
            <Button
              onClick={() => void exportCertificatesPdf('expiring')}
              disabled={pdfBusy || !settings}
              className="w-full justify-start"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              Certificados a vencer
            </Button>
            <Button
              onClick={() => void exportCertificatesPdf('expired')}
              disabled={pdfBusy || !settings}
              className="w-full justify-start"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Certificados vencidos
            </Button>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReportModalOpen(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  )
}

function StatCard({
  label,
  value,
  icon,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone?: 'warning' | 'danger'
  active?: boolean
  onClick?: () => void
}) {
  const color =
    tone === 'warning'
      ? 'text-[var(--pv-warning)]'
      : tone === 'danger'
        ? 'text-[var(--pv-danger)]'
        : 'text-[var(--pv-text)]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? 'Clique para limpar o filtro de status' : `Filtrar por: ${label}`}
      className={cn(
        'pv-lift rounded-[var(--pv-radius)] border bg-[var(--pv-panel)] text-left shadow-[var(--pv-shadow)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pv-accent)]',
        active
          ? 'border-[var(--pv-accent)] ring-2 ring-[var(--pv-accent)]'
          : 'border-[var(--pv-border)] hover:border-[var(--pv-accent)]',
      )}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          {icon}
        </div>
        <div>
          <div className="text-xs text-[var(--pv-muted)]">{label}</div>
          <div className={`text-xl font-semibold ${color}`}>{value}</div>
        </div>
      </CardContent>
    </button>
  )
}
