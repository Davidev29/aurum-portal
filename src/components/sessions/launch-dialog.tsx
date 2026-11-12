'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { ArrowRight, KeyRound, Search, ShieldCheck, Sparkles } from 'lucide-react'
import type { AuthMethod } from '@shared/constants'
import type { Certificate, Credential, Service } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import {
  useCertificates,
  useClients,
  useCredentials,
  useInvalidate,
  useSessions,
} from '@/lib/queries'
import { cn, clientTypeLabel, formatDate, initials } from '@/lib/utils'
import { certificateEffectiveValidToOf } from '@shared/certificate-renewal'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { AuthMethodBadges } from '@/components/status-badges'

function lastChoiceKey(serviceId: string): string {
  return `aurumbit:launch:${serviceId}`
}

/**
 * Normaliza para busca: minúsculas, sem acentos/diacríticos, sem espaços nas
 * bordas. Permite correspondência parcial (substring) e total (string exata)
 * independentemente de pontuação e acentuação.
 */
function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Apenas dígitos — documentos, CPF/CNPJ e documentos de certificados. */
function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '')
}

interface LastChoice {
  clientId?: string
  method?: AuthMethod
  certificateId?: string
  credentialId?: string
}

function readLastChoice(serviceId: string): LastChoice {
  try {
    return JSON.parse(localStorage.getItem(lastChoiceKey(serviceId)) ?? '{}') as LastChoice
  } catch {
    return {}
  }
}

function eligibleCertificates(certificates: Certificate[], clientId: string): Certificate[] {
  return certificates.filter(
    (certificate) =>
      certificate.status !== 'expired' &&
      certificate.status !== 'missing_windows' &&
      certificate.status !== 'chain_incomplete' &&
      (certificate.clientId === clientId ||
        certificate.clients.some((client) => client.id === clientId)),
  )
}

export function LaunchDialog({
  open,
  onOpenChange,
  service,
  presetClientId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  service: Service | null
  presetClientId?: string
}) {
  const invalidate = useInvalidate()
  const { data: clients } = useClients({ status: 'active' })
  const { data: certificates } = useCertificates()
  const { data: credentials } = useCredentials(service ? { serviceId: service.id } : undefined)
  const { data: sessions } = useSessions()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [clientId, setClientId] = React.useState('')
  const [method, setMethod] = React.useState<AuthMethod>('certificate')
  const [certificateId, setCertificateId] = React.useState('')
  const [credentialId, setCredentialId] = React.useState('')
  const [forceNew, setForceNew] = React.useState(false)

  React.useEffect(() => {
    if (!open || !service) return
    const last = readLastChoice(service.id)
    const nextMethod =
      presetClientId && last.method && service.authMethods.includes(last.method)
        ? last.method
        : service.defaultAuth
    setMethod(nextMethod)
    setSearch('')
    setError(null)
    setForceNew(false)
    const preferredClient = presetClientId ?? last.clientId ?? ''
    setClientId(preferredClient)
    setCertificateId(last.certificateId ?? '')
    setCredentialId(last.credentialId ?? '')
  }, [open, service, presetClientId])

  const allCertificates = React.useMemo(() => certificates ?? [], [certificates])
  const allCredentials = React.useMemo(() => credentials ?? [], [credentials])
  const activeClients = React.useMemo(() => clients ?? [], [clients])

  const eligibleClientIds = React.useMemo(() => {
    const ids = new Set<string>()
    if (!service) return ids
    for (const client of activeClients) {
      if (method === 'certificate') {
        if (eligibleCertificates(allCertificates, client.id).length > 0) ids.add(client.id)
      } else if (allCredentials.some((credential) => credential.clientId === client.id)) {
        ids.add(client.id)
      }
    }
    return ids
  }, [activeClients, allCertificates, allCredentials, method, service])

  const filteredClients = React.useMemo(() => {
    const query = normalizeSearch(search)
    const queryDigits = digitsOnly(query)
    return activeClients
      .filter((client) => eligibleClientIds.has(client.id))
      .filter((client) => {
        if (!query) return true
        if (normalizeSearch(client.name).includes(query)) return true
        if (queryDigits && digitsOnly(client.document).includes(queryDigits)) return true
        if (client.tags.some((tag) => normalizeSearch(tag).includes(query))) return true
        // Permite achar o cliente pelos dados do certificado exibido na tela.
        const linkedCertificates = eligibleCertificates(allCertificates, client.id)
        if (
          linkedCertificates.some(
            (certificate) =>
              normalizeSearch(certificate.label).includes(query) ||
              normalizeSearch(certificate.holderName).includes(query) ||
              (queryDigits && digitsOnly(certificate.document ?? '').includes(queryDigits)),
          )
        ) {
          return true
        }
        // Credenciais (método senha): rótulo e usuário.
        return allCredentials.some(
          (credential) =>
            credential.clientId === client.id &&
            (normalizeSearch(credential.label).includes(query) ||
              normalizeSearch(credential.username).includes(query)),
        )
      })
  }, [activeClients, allCertificates, allCredentials, eligibleClientIds, search])

  const clientCertificates = React.useMemo(
    () => (clientId ? eligibleCertificates(allCertificates, clientId) : []),
    [clientId, allCertificates],
  )
  const clientCredentials = React.useMemo(
    () => (clientId ? allCredentials.filter((credential) => credential.clientId === clientId) : []),
    [clientId, allCredentials],
  )

  React.useEffect(() => {
    if (!open || !clientId) return
    if (method !== 'certificate') return
    if (clientCertificates.some((certificate) => certificate.id === certificateId)) return
    const last = service ? readLastChoice(service.id) : {}
    const remembered = clientCertificates.find(
      (certificate) => certificate.id === last.certificateId,
    )
    setCertificateId(remembered?.id ?? clientCertificates[0]?.id ?? '')
  }, [open, clientId, method, clientCertificates, certificateId, service])

  React.useEffect(() => {
    if (!open || !clientId) return
    if (method !== 'password') return
    if (clientCredentials.some((credential) => credential.id === credentialId)) return
    const remembered = clientCredentials.find((credential) => credential.id === credentialId)
    const preferred =
      remembered ??
      clientCredentials.find((credential) => credential.isDefault) ??
      clientCredentials[0]
    setCredentialId(preferred?.id ?? '')
  }, [open, clientId, method, clientCredentials, credentialId])

  const selectedClient = activeClients.find((client) => client.id === clientId) ?? null
  const selectedCertificate = clientCertificates.find((cert) => cert.id === certificateId) ?? null
  const selectedCredential = clientCredentials.find((cred) => cred.id === credentialId) ?? null
  const openSession = sessions?.find(
    (session) =>
      session.serviceId === service?.id &&
      session.clientId === clientId &&
      session.authMethod === method &&
      (!certificateId || session.certificateId === certificateId),
  )

  const canOpen =
    Boolean(service && selectedClient) &&
    (method === 'certificate' ? Boolean(selectedCertificate) : Boolean(selectedCredential))

  const submit = async () => {
    if (!service || !selectedClient) return
    setBusy(true)
    setError(null)
    try {
      const result = await aurumBitPortal().sessions.open({
        serviceId: service.id,
        clientId: selectedClient.id,
        authMethod: method,
        certificateId: method === 'certificate' ? certificateId : null,
        credentialId: method === 'password' ? credentialId : null,
        forceNew,
      })
      try {
        localStorage.setItem(
          lastChoiceKey(service.id),
          JSON.stringify({
            clientId: selectedClient.id,
            method,
            certificateId,
            credentialId,
          } satisfies LastChoice),
        )
      } catch {
        // Preferencia local e opcional.
      }
      toast.success(result.reused ? 'Sessão existente focada.' : 'Sessão aberta em janela isolada.')
      await Promise.all([invalidate.sessions(), invalidate.services()])
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Abrir {service?.name ?? 'portal'}</DialogTitle>
          <DialogDescription>
            Escolha o cliente. Cada sessão usa uma partição isolada e o certificado vinculado ao
            contexto — não existe cliente atual global.
          </DialogDescription>
        </DialogHeader>

        {!service ? null : (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3 text-sm">
              <span className="text-[var(--pv-muted)]">Autenticação aceita:</span>
              <AuthMethodBadges methods={service.authMethods} />
            </div>

            {service.authMethods.length === 2 ? (
              <div
                role="radiogroup"
                aria-label="Método de autenticação"
                className="grid grid-cols-2 gap-2"
              >
                {(
                  [
                    { value: 'certificate', label: 'Certificado A1', icon: ShieldCheck },
                    { value: 'password', label: 'Login e senha', icon: KeyRound },
                  ] as const
                ).map(({ value, label, icon: Icon }) => {
                  const selected = method === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setMethod(value)
                        setClientId('')
                        setCertificateId('')
                        setCredentialId('')
                      }}
                      className={cn(
                        'pv-pressable flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-medium',
                        selected
                          ? 'border-brand-600 bg-[var(--pv-accent-soft)] text-brand-700 shadow-sm ring-2 ring-brand-500/40 dark:text-brand-200'
                          : 'border-[var(--pv-border)] text-[var(--pv-muted)] hover:border-brand-300 hover:text-[var(--pv-text)]',
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {label}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="relative">
              <Search
                className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar cliente por nome, CPF/CNPJ, tag ou certificado"
                className="pl-10"
                autoFocus
                aria-label="Buscar cliente por nome, documento, tag ou certificado"
              />
            </div>

            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-[var(--pv-border)] p-2 pv-scroll">
              {filteredClients.length === 0 ? (
                <div className="p-6 text-center text-sm text-[var(--pv-muted)]">
                  {method === 'certificate'
                    ? 'Nenhum cliente ativo possui certificado valido vinculado.'
                    : 'Nenhum cliente ativo possui credencial para este serviço.'}{' '}
                  {method === 'certificate'
                    ? 'Importe um certificado A1 e vincule ao cliente.'
                    : 'Cadastre uma credencial.'}
                </div>
              ) : (
                filteredClients.map((client) => {
                  const selected = client.id === clientId
                  const certCount =
                    method === 'certificate'
                      ? eligibleCertificates(allCertificates, client.id).length
                      : 0
                  const credCount =
                    method === 'password'
                      ? allCredentials.filter((credential) => credential.clientId === client.id)
                          .length
                      : 0
                  return (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setClientId(client.id)
                        setCertificateId('')
                        setCredentialId('')
                      }}
                      className={cn(
                        'pv-pressable flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left',
                        selected
                          ? 'border-brand-600 bg-[var(--pv-accent-soft)] ring-2 ring-brand-500/40'
                          : 'border-transparent hover:border-[var(--pv-border)] hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]',
                      )}
                      aria-pressed={selected}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--pv-panel-2)] text-xs font-semibold text-[var(--pv-muted)] dark:bg-[var(--pv-panel-2)] dark:text-[var(--pv-text)]">
                        {initials(client.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{client.name}</div>
                        <div className="text-xs text-[var(--pv-muted)]">
                          {clientTypeLabel(client.type)} • {client.document}
                        </div>
                      </div>
                      <Badge variant="outline">
                        {method === 'certificate' ? `${certCount} cert.` : `${credCount} cred.`}
                      </Badge>
                    </button>
                  )
                })
              )}
            </div>

            {selectedClient && method === 'certificate' && clientCertificates.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-[var(--pv-accent)]" />
                  Certificado para {selectedClient.name}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {clientCertificates.map((certificate) => (
                    <button
                      key={certificate.id}
                      type="button"
                      onClick={() => setCertificateId(certificate.id)}
                      className={cn(
                        'pv-pressable rounded-xl border p-3.5 text-left',
                        certificateId === certificate.id
                          ? 'border-brand-600 bg-[var(--pv-accent-soft)] ring-2 ring-brand-500/40'
                          : 'border-[var(--pv-border)] hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]',
                      )}
                      aria-pressed={certificateId === certificate.id}
                    >
                      <div className="truncate text-sm font-medium">{certificate.label}</div>
                      <div className="mt-0.5 truncate text-xs text-[var(--pv-muted)]">
                        {certificate.holderName}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant={certificate.installed ? 'success' : 'secondary'}>
                          {certificate.installed ? 'Instalado' : 'No cofre'}
                        </Badge>
                        <span className="text-[11px] text-[var(--pv-muted)]">
                          até {formatDate(certificateEffectiveValidToOf(certificate))}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedClient && method === 'password' ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-[var(--pv-accent)]" />
                  Credencial para {selectedClient.name}
                </div>
                {clientCredentials.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[var(--pv-border)] p-4 text-sm text-[var(--pv-muted)]">
                    Nenhuma credencial cadastrada para este cliente neste serviço.
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {clientCredentials.map((credential: Credential) => (
                      <button
                        key={credential.id}
                        type="button"
                        onClick={() => setCredentialId(credential.id)}
                        className={cn(
                          'pv-pressable rounded-xl border p-3.5 text-left',
                          credentialId === credential.id
                            ? 'border-brand-600 bg-[var(--pv-accent-soft)] ring-2 ring-brand-500/40'
                            : 'border-[var(--pv-border)] hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]',
                        )}
                        aria-pressed={credentialId === credential.id}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{credential.label}</span>
                          {credential.isDefault ? <Badge variant="success">Padrao</Badge> : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-[var(--pv-muted)]">
                          {credential.username}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--pv-border)] p-3 text-sm transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]">
              <Checkbox
                checked={forceNew}
                onCheckedChange={(checked) => setForceNew(checked === true)}
              />
              Abrir nova sessão mesmo que já exista uma igual
            </label>

            {openSession && !forceNew ? (
              <div className="flex items-center gap-2 rounded-lg border border-[var(--pv-success-border)] bg-[var(--pv-success-soft)] p-3 text-xs text-[var(--pv-success)] dark:border-[var(--pv-success-border)] dark:bg-[var(--pv-success-soft)] dark:text-[var(--pv-success)]">
                <Sparkles className="h-4 w-4" />
                Já existe uma sessão deste cliente neste serviço. Abrir irá focar a janela
                existente.
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="sm:items-center sm:justify-between">
          <p className="text-xs text-[var(--pv-muted)]">
            O certificado e sempre selecionado explicitamente no handshake TLS.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !canOpen}>
              {busy ? 'Abrindo...' : 'Abrir portal'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
