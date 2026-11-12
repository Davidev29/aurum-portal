'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Copy,
  Eye,
  History,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import type { Certificate, CertificateRenewalEntry } from '@shared/types'
import {
  computeRenewalInfo,
  getExpiryInfo,
  daysBetweenUtc,
  toRenewalEntry,
  certificateEffectiveValidToOf,
} from '@shared/certificate-renewal'
import { formatDate, formatDateTime, formatDocumentMasked } from '@/lib/utils'
import { useCertificateDetails } from '@/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CertificateStatusBadge } from '@/components/status-badges'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

/** Badge de renovação: "Renovado" quando já há sucessor válido, "Aguardando renovação" quando vencido sem sucessor. */
export function CertificateRenewalBadge({ certificate }: { certificate: Certificate }) {
  const renewed = certificate.isRenewed === true || certificate.hasNewerValid === true
  const expired = certificate.status === 'expired' || certificate.daysUntilExpiry < 0
  const expiring = certificate.status === 'expiring'
  if (renewed) {
    return (
      <Badge variant="success">
        Renovado — válido até {formatDate(certificateEffectiveValidToOf(certificate))}
      </Badge>
    )
  }
  if (expired) return <Badge variant="danger">Aguardando renovação</Badge>
  if (expiring) return <Badge variant="warning">A vencer — renovar</Badge>
  if (certificate.hasOlderCertificate)
    return <Badge variant="info">Atual (renovação de anterior)</Badge>
  return <Badge variant="outline">Em vigor, sem renovação pendente</Badge>
}

export function CertificateDetailsDialog({
  open,
  onOpenChange,
  certificate,
  allCertificates,
  onRenew,
  onSelectCertificate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  certificate: Certificate | null
  /** Universo local para exibir o histórico imediatamente enquanto o detalhe carrega. */
  allCertificates?: Certificate[]
  onRenew?: (certificate: Certificate) => void
  onSelectCertificate?: (certificate: Certificate) => void
}) {
  const certificateId = open && certificate ? certificate.id : null
  const detailsQuery = useCertificateDetails(certificateId)
  const details = detailsQuery.data ?? null

  // Fallback local (listagem) enquanto o detalhe via IPC carrega ou se ele falhar.
  const localInfo = React.useMemo(() => {
    if (!certificate) return null
    const universe = allCertificates && allCertificates.length > 0 ? allCertificates : [certificate]
    const info = computeRenewalInfo(certificate, universe)
    const history = info.history.map((entry) =>
      toRenewalEntry(entry as Certificate, certificate.id),
    )
    return { info, history }
  }, [certificate, allCertificates])

  const current: Certificate | null = details?.certificate ?? certificate
  const history: CertificateRenewalEntry[] = details?.history ?? localInfo?.history ?? []
  const isRenewed: boolean =
    details?.isRenewed ?? localInfo?.info.isRenewed ?? current?.isRenewed ?? false
  const renewedBy: CertificateRenewalEntry | null = details?.renewedBy ?? null

  // Vencimento exibido = fim efetivo da cadeia de renovação (último certificado válido),
  // coerente com daysUntilExpiry/status enriquecidos no main process.
  const effectiveValidTo = current ? certificateEffectiveValidToOf(current) : null

  const expiry = React.useMemo(
    () =>
      current && effectiveValidTo ? getExpiryInfo({ ...current, validTo: effectiveValidTo }) : null,
    [current, effectiveValidTo],
  )

  const validityPercent = React.useMemo(() => {
    if (!current || !effectiveValidTo) return 0
    // Dias civis (UTC) para evitar distorção por fuso horário / relógio.
    const totalDays = daysBetweenUtc(current.validFrom, effectiveValidTo)
    if (totalDays <= 0) return 0
    if (current.daysUntilExpiry < 0) return 100
    const elapsedDays = totalDays - current.daysUntilExpiry
    return Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100))
  }, [current, effectiveValidTo])

  const canRenew = Boolean(
    current && !isRenewed && (current.status === 'expired' || current.status === 'expiring'),
  )

  const toneText = expiry?.expired
    ? 'text-[var(--pv-danger)]'
    : expiry?.expiring
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-emerald-700 dark:text-emerald-300'
  const toneBar = expiry?.expired
    ? 'bg-[var(--pv-danger-solid)]'
    : expiry?.expiring
      ? 'bg-[var(--pv-warning)]'
      : 'bg-[var(--pv-success-solid)]'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-4 p-5">
        {/* ---------- Cabeçalho compacto ---------- */}
        <DialogHeader className="gap-1">
          <DialogTitle className="flex items-center gap-2 text-lg pr-10">
            <span className="truncate">{current?.label ?? 'Certificado'}</span>
            {current ? <CertificateStatusBadge status={current.status} /> : null}
          </DialogTitle>
          {current ? (
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="truncate">{current.holderName}</span>
              {current.document ? <span>• {formatDocumentMasked(current.document)}</span> : null}
              <span>• {current.source === 'windows' ? 'Windows' : 'PFX'}</span>
              <span>• {current.installed ? 'Instalado' : 'No cofre'}</span>
            </DialogDescription>
          ) : (
            <DialogDescription>
              Dados completos do certificado e histórico de renovação.
            </DialogDescription>
          )}
        </DialogHeader>

        {!current ? (
          <p className="text-sm text-[var(--pv-muted)]">Selecione um certificado.</p>
        ) : (
          <div className="space-y-3">
            {/* ---------- Clientes vinculados (compacto) ---------- */}
            {current.clients.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="text-[var(--pv-muted)]">Clientes:</span>
                {current.clients.map((client) => (
                  <Link
                    key={client.id}
                    href={`/clients/detail?id=${encodeURIComponent(client.id)}`}
                    className="rounded-full border border-[var(--pv-border)] px-2 py-0.5 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]"
                  >
                    {client.name}
                  </Link>
                ))}
              </div>
            ) : null}

            {/* ---------- Validade (painel único) ---------- */}
            <section
              aria-label="Validade do certificado"
              className="rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--pv-muted)]">
                    <CalendarClock className="h-3.5 w-3.5" /> Vencimento
                  </div>
                  <div className="mt-0.5 truncate text-xl font-bold tabular-nums leading-tight">
                    {formatDate(effectiveValidTo)}
                  </div>
                  <div className="text-[11px] text-[var(--pv-muted)]">
                    emissão em {formatDate(current.validFrom)}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-2xl font-extrabold tabular-nums leading-none ${toneText}`}>
                    {expiry?.expired ? Math.abs(expiry.daysUntilExpiry) : expiry?.daysUntilExpiry}
                  </div>
                  <div
                    className={`mt-1 text-[10px] font-semibold uppercase tracking-wide ${toneText}`}
                  >
                    {expiry?.expired ? 'dias vencido' : 'dias restantes'}
                  </div>
                </div>
              </div>

              <div
                className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--pv-panel-3)] dark:bg-[var(--pv-panel-2)]"
                role="progressbar"
                aria-valuenow={Math.round(validityPercent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progresso da validade: ${Math.round(validityPercent)}%`}
              >
                <div
                  className={`h-full rounded-full transition-all ${toneBar}`}
                  style={{ width: `${validityPercent}%` }}
                />
              </div>

              {/* Linha de renovação: uma única linha, quando aplicável */}
              {isRenewed ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  {renewedBy ? (
                    <>
                      Renovado em{' '}
                      <span className="font-semibold" title={formatDateTime(renewedBy.createdAt)}>
                        {formatDate(renewedBy.createdAt)}
                      </span>{' '}
                      — válido até {formatDate(effectiveValidTo)}
                    </>
                  ) : (
                    <>Renovado — válido até {formatDate(effectiveValidTo)}</>
                  )}
                </p>
              ) : current.status === 'expired' ? (
                <p className="mt-2 text-[11px] font-medium text-[var(--pv-danger)]">
                  Vencido sem sucessor importado — importe o novo PFX para renovar.
                </p>
              ) : null}

              {detailsQuery.isError ? (
                <p className="mt-1 text-[10px] text-[var(--pv-muted)]">
                  Histórico indisponível nesta sessão; exibindo a partir da lista carregada.
                </p>
              ) : null}
            </section>

            {/* ---------- Histórico (tabela densa) ---------- */}
            <section aria-label="Histórico de renovação">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[var(--pv-text)]">
                  <History className="h-3.5 w-3.5 text-brand-600 dark:text-brand-300" /> Histórico
                  de renovação
                  <span className="text-[var(--pv-muted)]">({history.length})</span>
                </h3>
                {detailsQuery.isLoading ? (
                  <span className="text-[10px] text-[var(--pv-muted)]">Carregando…</span>
                ) : null}
              </div>

              {history.length <= 1 ? (
                <p className="rounded-xl border border-dashed border-[var(--pv-border)] p-3 text-[11px] text-[var(--pv-muted)]">
                  Nenhuma renovação registrada para este documento ainda.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[var(--pv-border)]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-[var(--pv-panel-2)]">
                        <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">
                          Certificado
                        </TableHead>
                        <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">
                          Emissão
                        </TableHead>
                        <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">
                          Vencimento
                        </TableHead>
                        <TableHead className="h-8 px-3 text-[10px] uppercase tracking-wide">
                          Situação
                        </TableHead>
                        <TableHead className="h-8 w-10 px-1" aria-label="Ações" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((entry) => {
                        const expired = entry.status === 'expired'
                        const isCurrent = entry.isCurrent
                        const isRenewedBy = renewedBy?.id === entry.id
                        return (
                          <TableRow
                            key={entry.id}
                            className={
                              isCurrent ? 'bg-brand-50/60 dark:bg-brand-500/10' : undefined
                            }
                          >
                            <TableCell className="px-3 py-1.5">
                              <div className="flex items-center gap-1.5">
                                <span
                                  aria-hidden="true"
                                  className={`h-2 w-2 shrink-0 rounded-full ${isCurrent ? 'bg-brand-600' : expired ? 'bg-[var(--pv-danger-solid)]' : 'bg-[var(--pv-success-solid)]'}`}
                                />
                                <span
                                  className="max-w-[140px] truncate text-xs font-medium"
                                  title={entry.label}
                                >
                                  {entry.label}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-xs tabular-nums text-[var(--pv-muted)]">
                              {formatDate(entry.validFrom)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-xs tabular-nums text-[var(--pv-muted)]">
                              {formatDate(entry.validTo)}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {isCurrent ? (
                                <Badge variant="default" className="px-1.5 py-0 text-[10px]">
                                  Este certificado
                                </Badge>
                              ) : isRenewedBy ? (
                                <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                                  Renovou o atual
                                </Badge>
                              ) : expired ? (
                                <Badge variant="danger" className="px-1.5 py-0 text-[10px]">
                                  Vencido
                                </Badge>
                              ) : (
                                <Badge variant="success" className="px-1.5 py-0 text-[10px]">
                                  Válido
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="px-1 py-1.5 text-center">
                              {!isCurrent && onSelectCertificate && allCertificates ? (
                                <button
                                  type="button"
                                  className="rounded-lg p-1.5 text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)]"
                                  title={`Ver ${entry.label}`}
                                  aria-label={`Ver ${entry.label}`}
                                  onClick={() => {
                                    const next = allCertificates.find(
                                      (item) => item.id === entry.id,
                                    )
                                    if (next) onSelectCertificate(next)
                                  }}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {/* ---------- Dados técnicos (recolhidos por padrão) ---------- */}
            <details className="group rounded-xl border border-[var(--pv-border)]">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold text-[var(--pv-muted)] outline-none transition-colors hover:text-[var(--pv-text)] focus-visible:ring-2 focus-visible:ring-brand-500 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                <ShieldCheck className="h-3.5 w-3.5" /> Dados técnicos
                <span className="font-normal">— serial, emissor, thumbprints, importação</span>
              </summary>
              <div className="border-t border-[var(--pv-border)] p-3">
                <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  <Data
                    label="Serial (hex)"
                    value={current.serialHex || '—'}
                    copyValue={current.serialHex || undefined}
                    mono
                  />
                  <Data label="Cadeia" value={current.chainStatus ?? 'Não registrada'} />
                  <Data label="Importado em" value={formatDateTime(current.createdAt)} />
                  <Data
                    label="Instalado em"
                    value={current.installedAt ? formatDateTime(current.installedAt) : '—'}
                  />
                  <Data
                    label="Última presença no Windows"
                    value={current.lastSeenAt ? formatDateTime(current.lastSeenAt) : '—'}
                  />
                  <Data label="Atualizado em" value={formatDateTime(current.updatedAt)} />
                  <div className="sm:col-span-2">
                    <Data
                      label="Assunto (Subject DN)"
                      value={current.subjectDn || '—'}
                      copyValue={current.subjectDn || undefined}
                      mono
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Data
                      label="Emissor (Issuer DN)"
                      value={current.issuerDn || '—'}
                      copyValue={current.issuerDn || undefined}
                      mono
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Data
                      label="Thumbprint SHA-256"
                      value={current.thumbprintSha256 || '—'}
                      copyValue={current.thumbprintSha256 || undefined}
                      mono
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Data
                      label="Thumbprint SHA-1"
                      value={current.thumbprintSha1 || '—'}
                      copyValue={current.thumbprintSha1 || undefined}
                      mono
                    />
                  </div>
                </dl>
              </div>
            </details>
          </div>
        )}

        <DialogFooter className="gap-2 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {canRenew && onRenew && current ? (
            <Button size="sm" onClick={() => onRenew(current)}>
              <RefreshCw className="h-4 w-4" /> Renovar — importar novo
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Data({
  label,
  value,
  copyValue,
  mono,
}: {
  label: string
  value: string
  copyValue?: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-[var(--pv-muted)]">{label}</dt>
      <dd
        className={`mt-0.5 flex items-start gap-1.5 text-xs ${mono ? 'break-all font-mono text-[10px]' : ''}`}
      >
        <span className="min-w-0 flex-1 break-words">{value}</span>
        {copyValue ? (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-[var(--pv-muted)] hover:text-[var(--pv-text)]"
            title={`Copiar ${label}`}
            aria-label={`Copiar ${label}`}
            onClick={() => void navigator.clipboard.writeText(copyValue)}
          >
            <Copy className="h-3 w-3" />
          </button>
        ) : null}
      </dd>
    </div>
  )
}
