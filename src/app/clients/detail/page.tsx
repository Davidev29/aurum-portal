'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Copy,
  Eye,
  FileText,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlink,
  Users,
  FileClock,
  Sparkles,
} from 'lucide-react'
import type { Certificate, Credential, Service } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import {
  useAudit,
  useCertificates,
  useClient,
  useCredentials,
  useInvalidate,
  useServices,
} from '@/lib/queries'
import { useSearchParam } from '@/lib/hooks'
import { formatDate, formatDateTime, formatDocumentMasked, initials, clientTypeLabel } from '@/lib/utils'
import { formatCentsToBRL } from '@shared/currency'
import { certificateEffectiveValidToOf } from '@shared/certificate-renewal'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { CertificateStatusBadge } from '@/components/status-badges'
import {
  CertificateDetailsDialog,
  CertificateRenewalBadge,
} from '@/components/certificates/certificate-details-dialog'
import { ClientTypeBadge } from '@/components/clients/client-type-badge'
import { ClientForm } from '@/components/clients/client-form'
import { ClientNotesManager } from '@/components/clients/client-notes-manager'
import { ClientReportDialog } from '@/components/clients/client-report-dialog'
import { CredentialFormDialog } from '@/components/credentials/credential-form-dialog'
import { CredentialRevealDialog } from '@/components/credentials/credential-reveal-dialog'
import { CertificateImportWizard } from '@/components/certificates/certificate-import-wizard'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { LaunchDialog } from '@/components/sessions/launch-dialog'

export default function ClientDetailPage() {
  const id = useSearchParam('id')
  const editParam = useSearchParam('edit')
  const [tab, setTab] = React.useState('overview')
  const invalidate = useInvalidate()
  const { data: client, isLoading } = useClient(id)
  const { data: certificates } = useCertificates(id ? { clientId: id } : undefined)
  const validCertificates = (certificates ?? []).filter(
    (certificate) => certificate.status !== 'expired',
  )
  const expiredCertificates = (certificates ?? []).filter(
    (certificate) => certificate.status === 'expired',
  )
  const { data: credentials } = useCredentials(id ? { clientId: id } : undefined)
  const { data: services } = useServices({ enabledOnly: true })
  const { data: auditPage } = useAudit({ limit: 500 })

  const [editingBasics, setEditingBasics] = React.useState(false)
  const [reportOpen, setReportOpen] = React.useState(false)
  const [credentialOpen, setCredentialOpen] = React.useState(false)
  const [editingCredential, setEditingCredential] = React.useState<Credential | null>(null)
  const [revealCredential, setRevealCredential] = React.useState<Credential | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [renewalCertificate, setRenewalCertificate] = React.useState<Certificate | null>(null)
  const [detailCertificate, setDetailCertificate] = React.useState<Certificate | null>(null)
  const [unlinkCertificate, setUnlinkCertificate] = React.useState<Certificate | null>(null)
  const [deletingCredential, setDeletingCredential] = React.useState<Credential | null>(null)
  const [launchService, setLaunchService] = React.useState<Service | null>(null)
  const [busy, setBusy] = React.useState(false)

  const events = (auditPage?.events ?? []).filter(
    (event) => event.entityId === client?.id || event.metadata.clientId === client?.id,
  )

  React.useEffect(() => {
    if (editParam === '1') setEditingBasics(true)
  }, [editParam])

  const startEdit = () => {
    setTab('overview')
    setEditingBasics(true)
  }

  const copyCredential = async (credential: Credential) => {
    try {
      await aurumBitPortal().credentials.copy(credential.id)
      toast.success('Senha copiada com limpeza automatica.')
      await invalidate.audit()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const unlink = async () => {
    if (!client || !unlinkCertificate) return
    setBusy(true)
    try {
      await aurumBitPortal().certificates.unlinkClient({
        id: unlinkCertificate.id,
        clientId: client.id,
      })
      toast.success('Vínculo removido. O certificado permanece no cofre.')
      await Promise.all([invalidate.certificates(), invalidate.audit()])
      setUnlinkCertificate(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const deleteCredential = async () => {
    if (!deletingCredential) return
    setBusy(true)
    try {
      await aurumBitPortal().credentials.delete(deletingCredential.id)
      toast.success('Credencial removida do cofre.')
      await Promise.all([invalidate.credentials(), invalidate.audit()])
      setDeletingCredential(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!id) {
    return (
      <AppShell>
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Cliente não informado"
          description="Abra o cliente pela lista de clientes."
          action={
            <Button variant="secondary" onClick={() => window.history.back()}>
              Voltar
            </Button>
          }
        />
      </AppShell>
    )
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="h-72 animate-pulse rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)]" />
      </AppShell>
    )
  }

  if (!client) {
    return (
      <AppShell>
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="Cliente não encontrado"
          description="Ele pode ter sido removido ou o link está incorreto."
          action={
            <Link href="/clients" className="text-sm font-medium text-brand-600 hover:underline">
              Voltar para clientes
            </Link>
          }
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--pv-muted)] hover:text-[var(--pv-text)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Clientes
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[var(--pv-radius)] bg-[var(--pv-accent-solid)] text-lg font-bold text-[var(--pv-on-accent)] shadow-lg">
            {initials(client.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{client.name}</h1>
              <ClientTypeBadge type={client.type} />
              <Badge variant={client.status === 'active' ? 'success' : 'secondary'}>
                {client.status === 'active' ? 'Ativo' : 'Arquivado'}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[var(--pv-muted)]">
              <span className="font-mono">{formatDocumentMasked(client.document)}</span>
              {client.email ? (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {client.email}
                </span>
              ) : null}
              {client.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" /> {client.phone}
                </span>
              ) : null}
            </div>
            {client.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {client.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!editingBasics ? (
            <Button variant="secondary" onClick={startEdit}>
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setReportOpen(true)}>
            <FileText className="h-4 w-4" />
            Relatório
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <ShieldCheck className="h-4 w-4" />
            Importar certificado
          </Button>
          <Button
            onClick={() => {
              setEditingCredential(null)
              setCredentialOpen(true)
            }}
          >
            <KeyRound className="h-4 w-4" />
            Nova credencial
          </Button>
        </div>
      </div>

      {client.status === 'archived' ? (
        <Alert variant="warning" className="mb-5" title="Cliente arquivado">
          Novas sessões estão bloqueadas. Restaure o cliente na lista de clientes para voltar a usar
          certificados e credenciais.
        </Alert>
      ) : null}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric
          label="Certificados vinculados"
          value={certificates?.length ?? 0}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <Metric
          label="Credenciais no cofre"
          value={credentials?.length ?? 0}
          icon={<KeyRound className="h-4 w-4" />}
        />
        <Metric
          label="Consentimento LGPD"
          value={client.consentAt ? formatDate(client.consentAt) : 'Pendente'}
          icon={<FileClock className="h-4 w-4" />}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Visao geral</TabsTrigger>
          <TabsTrigger value="certificates">Certificados ({certificates?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="credentials">Credenciais ({credentials?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="services">Serviços</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {editingBasics ? (
            <Card>
              <CardHeader>
                <CardTitle>Editar dados do cliente</CardTitle>
              </CardHeader>
              <CardContent>
                <ClientForm
                  client={client}
                  onSaved={() => setEditingBasics(false)}
                  onCancel={() => setEditingBasics(false)}
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Dados do cliente</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Tipo" value={clientTypeLabel(client.type)} />
                  <Row label="Documento" value={formatDocumentMasked(client.document)} />
                  <Row label="E-mail" value={client.email ?? '—'} />
                  <Row label="Telefone" value={client.phone ?? '—'} />
                  <Row label="Honorários" value={formatCentsToBRL(client.honorariosCents)} />
                  <Row label="Criado em" value={formatDateTime(client.createdAt)} />
                  <Row label="Atualizado em" value={formatDateTime(client.updatedAt)} />
                  <Row
                    label="Consentimento"
                    value={client.consentAt ? formatDateTime(client.consentAt) : 'Não registrado'}
                  />
                </CardContent>
              </Card>
              <ClientNotesManager clientId={client.id} clientName={client.name} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="certificates">
          {!certificates || certificates.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="h-5 w-5" />}
              title="Nenhum certificado vinculado"
              description="Importe um A1 ou vincule um certificado existente a este cliente."
              action={<Button onClick={() => setImportOpen(true)}>Importar certificado</Button>}
            />
          ) : (
            <div className="space-y-4">
              {validCertificates.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {validCertificates.map((certificate) => (
                    <Card key={certificate.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{certificate.label}</div>
                            <div className="truncate text-xs text-[var(--pv-muted)]">
                              {certificate.holderName}
                            </div>
                          </div>
                          <CertificateStatusBadge status={certificate.status} />
                        </div>
                        <div className="mt-3 space-y-1 text-xs">
                          <div className="font-medium">
                            {certificate.daysUntilExpiry >= 0
                              ? `Vence em ${certificate.daysUntilExpiry} dia(s) — ${formatDate(certificateEffectiveValidToOf(certificate))}`
                              : `Vencido há ${Math.abs(certificate.daysUntilExpiry)} dia(s)`}
                          </div>
                          <div className="text-[var(--pv-muted)]">
                            Início {formatDate(certificate.validFrom)} •{' '}
                            {certificate.installed ? 'Instalado no Windows' : 'Somente no cofre'}
                          </div>
                          <div className="pt-1">
                            <CertificateRenewalBadge certificate={certificate} />
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {certificate.clients.map((linked) => (
                            <Badge
                              key={linked.id}
                              variant={linked.id === client.id ? 'default' : 'outline'}
                            >
                              {linked.name}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDetailCertificate(certificate)}
                            title="Ver dados e histórico de renovação"
                            aria-label="Ver dados e histórico de renovação"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!(certificate.isRenewed || certificate.hasNewerValid) &&
                          (certificate.status === 'expired' || certificate.status === 'expiring') ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRenewalCertificate(certificate)
                                setImportOpen(true)
                              }}
                              title="Renovar — importar novo certificado"
                            >
                              <RefreshCw className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                              Renovar
                            </Button>
                          ) : null}
                          <Link
                            href={`/certificates?certificateId=${encodeURIComponent(certificate.id)}`}
                            className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-brand-600 transition-colors hover:bg-[var(--pv-accent-soft)] dark:text-brand-300"
                          >
                            Abrir certificado
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setUnlinkCertificate(certificate)}
                            title="Desvincular"
                            aria-label="Desvincular certificado"
                          >
                            <Unlink className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : null}

              {expiredCertificates.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-[var(--pv-muted)]">
                    Histórico (certificados vencidos)
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2">
                    {expiredCertificates.map((certificate) => (
                      <Card key={certificate.id} className="opacity-75">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{certificate.label}</div>
                              <div className="truncate text-xs text-[var(--pv-muted)]">
                                {certificate.holderName}
                              </div>
                            </div>
                            <CertificateStatusBadge status={certificate.status} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <CertificateRenewalBadge certificate={certificate} />
                          </div>
                          <div className="mt-3 text-xs text-[var(--pv-muted)]">
                            {certificate.isRenewed
                              ? `Renovado — válido até ${formatDate(certificateEffectiveValidToOf(certificate))}`
                              : `Vencido há ${Math.abs(certificate.daysUntilExpiry)} dia(s) — ${formatDate(certificateEffectiveValidToOf(certificate))}`}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setDetailCertificate(certificate)}
                              title="Ver dados e histórico de renovação"
                              aria-label="Ver dados e histórico de renovação"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {!(certificate.isRenewed || certificate.hasNewerValid) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setRenewalCertificate(certificate)
                                  setImportOpen(true)
                                }}
                                title="Renovar — importar novo certificado"
                              >
                                <RefreshCw className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                                Renovar
                              </Button>
                            ) : null}
                            <Link
                              href={`/certificates?certificateId=${encodeURIComponent(certificate.id)}`}
                              className="inline-flex h-9 items-center rounded-lg px-3 text-xs font-medium text-brand-600 transition-colors hover:bg-[var(--pv-accent-soft)] dark:text-brand-300"
                            >
                              Abrir certificado
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setUnlinkCertificate(certificate)}
                              title="Desvincular"
                              aria-label="Desvincular certificado"
                            >
                              <Unlink className="h-4 w-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </TabsContent>

        <TabsContent value="credentials">
          {!credentials || credentials.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="h-5 w-5" />}
              title="Nenhuma credencial"
              description="Cadastre logins por serviço. As senhas são cifradas e nunca aparecem em listagens."
              action={
                <Button
                  onClick={() => {
                    setEditingCredential(null)
                    setCredentialOpen(true)
                  }}
                >
                  Nova credencial
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rotulo</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Último uso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {credentials.map((credential) => (
                    <TableRow key={credential.id}>
                      <TableCell>
                        <div className="font-medium">{credential.label}</div>
                        {credential.isDefault ? (
                          <Badge variant="success" className="mt-1">
                            Padrao
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{credential.serviceName}</TableCell>
                      <TableCell className="font-mono text-xs">{credential.username}</TableCell>
                      <TableCell>
                        {credential.reused ? (
                          <Badge variant="warning">Reutilizada</Badge>
                        ) : (
                          <Badge variant="outline">Única</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-[var(--pv-muted)]">
                        {credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : 'Nunca'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setRevealCredential(credential)}
                            title="Revelar"
                            aria-label="Revelar senha"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void copyCredential(credential)}
                            title="Copiar"
                            aria-label="Copiar senha"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => {
                              setEditingCredential(credential)
                              setCredentialOpen(true)
                            }}
                            title="Editar"
                            aria-label="Editar credencial"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeletingCredential(credential)}
                            title="Excluir"
                            aria-label="Excluir credencial"
                          >
                            <Trash2 className="h-4 w-4 text-[var(--pv-danger)]" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="services">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {services?.map((service) => (
              <Card key={service.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">
                    {initials(service.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{service.name}</div>
                    <div className="truncate text-xs text-[var(--pv-muted)]">
                      {service.category}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setLaunchService(service)}>
                    <Sparkles className="h-3.5 w-3.5" />
                    Abrir
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          {events.length === 0 ? (
            <EmptyState
              icon={<FileClock className="h-5 w-5" />}
              title="Nenhum evento registrado"
              description="Aberturas de sessão, certificados, credenciais e alterações aparecem aqui."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Entidade</TableHead>
                    <TableHead>Detalhes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.slice(0, 100).map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="whitespace-nowrap text-xs text-[var(--pv-muted)]">
                        {formatDateTime(event.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{event.type}</TableCell>
                      <TableCell className="text-xs">{event.entity}</TableCell>
                      <TableCell className="max-w-[420px] truncate text-xs text-[var(--pv-muted)]">
                        {JSON.stringify(event.metadata)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ClientReportDialog client={client} open={reportOpen} onOpenChange={setReportOpen} />
      <CredentialFormDialog
        open={credentialOpen}
        onOpenChange={(open) => {
          setCredentialOpen(open)
          if (!open) setEditingCredential(null)
        }}
        credential={editingCredential}
        defaultClientId={client.id}
      />
      <CredentialRevealDialog
        open={Boolean(revealCredential)}
        onOpenChange={(open) => {
          if (!open) setRevealCredential(null)
        }}
        credential={revealCredential}
      />
      <CertificateImportWizard
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setRenewalCertificate(null)
        }}
        defaultClientId={client.id}
        renewalCertificate={renewalCertificate}
      />
      <CertificateDetailsDialog
        open={Boolean(detailCertificate)}
        onOpenChange={(open) => {
          if (!open) setDetailCertificate(null)
        }}
        certificate={detailCertificate}
        allCertificates={certificates ?? []}
        onRenew={(certificate) => {
          setDetailCertificate(null)
          setRenewalCertificate(certificate)
          setImportOpen(true)
        }}
        onSelectCertificate={setDetailCertificate}
      />
      <LaunchDialog
        open={Boolean(launchService)}
        onOpenChange={(open) => {
          if (!open) setLaunchService(null)
        }}
        service={launchService}
        presetClientId={client.id}
      />
      <ConfirmDialog
        open={Boolean(unlinkCertificate)}
        onOpenChange={(open) => {
          if (!open) setUnlinkCertificate(null)
        }}
        title="Desvincular certificado?"
        description={
          <>
            O certificado <strong>{unlinkCertificate?.label}</strong> deixará de poder ser usado por{' '}
            <strong>{client.name}</strong>. Ele permanece no cofre e no repositorio do Windows, e
            pode ser vinculado novamente depois.
          </>
        }
        confirmLabel="Desvincular"
        busy={busy}
        onConfirm={() => void unlink()}
      />
      <ConfirmDialog
        open={Boolean(deletingCredential)}
        onOpenChange={(open) => {
          if (!open) setDeletingCredential(null)
        }}
        title="Excluir credencial?"
        description={
          <>
            A credencial <strong>{deletingCredential?.label}</strong> será removida definitivamente
            do cofre. Sessões abertas continuam funcionando até serem fechadas.
          </>
        }
        confirmLabel="Excluir"
        busy={busy}
        onConfirm={() => void deleteCredential()}
      />
    </AppShell>
  )
}

function Metric({
  label,
  value,
  icon,
}: {
  label: string
  value: string | number
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
          {icon}
        </div>
        <div>
          <div className="text-xs text-[var(--pv-muted)]">{label}</div>
          <div className="text-lg font-semibold">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--pv-border)] pb-2 last:border-0 last:pb-0">
      <span className="text-[var(--pv-muted)]">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}
