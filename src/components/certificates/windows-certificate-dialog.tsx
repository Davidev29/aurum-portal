'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import type { WindowsCertificate, WindowsImportSummary } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useClients, useInvalidate } from '@/lib/queries'
import { formatDate } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'

export function WindowsCertificateDialog({
  open,
  onOpenChange,
  defaultClientId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultClientId?: string
}) {
  const invalidate = useInvalidate()
  const { data: clients } = useClients({ status: 'active' })
  const [items, setItems] = React.useState<WindowsCertificate[]>([])
  const [selected, setSelected] = React.useState<string[]>([])
  const [clientId, setClientId] = React.useState('')
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [report, setReport] = React.useState<WindowsImportSummary | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const records = await aurumBitPortal().certificates.listWindows()
      setItems(records)
      // Importação em lote sem clicar um por um: já deixa marcados todos os
      // certificados que ainda não foram cadastrados.
      setSelected(
        records.filter((record) => !record.alreadyImported).map((record) => record.thumbprintSha1),
      )
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setSelected([])
    setClientId(defaultClientId ?? '')
    setConsent(false)
    setError(null)
    setSearch('')
    setReport(null)
    void load()
  }, [open, defaultClientId, load])

  const importable = React.useMemo(() => items.filter((item) => !item.alreadyImported), [items])
  const alreadyImportedCount = items.length - importable.length
  const expiredImportable = React.useMemo(
    () => importable.filter((item) => new Date(item.notAfter).getTime() <= Date.now()).length,
    [importable],
  )

  const filteredItems = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) =>
      [item.holderName, item.document ?? '', item.issuer, item.subject, item.thumbprintSha1]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [items, search])

  const runImport = async (payload: { thumbprints?: string[]; importAll?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const result = await aurumBitPortal().certificates.importFromWindows({
        thumbprints: payload.thumbprints ?? [],
        importAll: payload.importAll ?? false,
        clientId: clientId || null,
        consent,
      })
      setReport(result)
      setSelected([])
      toast.success(
        `${result.imported} certificado(s) importado(s) do Windows` +
          (result.duplicates > 0 ? ` • ${result.duplicates} já cadastrado(s)` : '') +
          (result.errors > 0 ? ` • ${result.errors} com erro` : ''),
      )
      await Promise.all([
        invalidate.certificates(),
        invalidate.certificateStats(),
        invalidate.clients(),
        invalidate.audit(),
      ])
      // Recarrega a lista para refletir os recém-importados (badge "Já cadastrado").
      await load()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const selectAllImportable = () => {
    setSelected(importable.map((item) => item.thumbprintSha1))
  }

  const clearSelection = () => {
    setSelected([])
  }

  const cannotSubmit = busy || loading || (Boolean(clientId) && !consent)
  const selectedCount = selected.length

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar do Windows</DialogTitle>
          <DialogDescription>
            Lista os certificados com chave privada em Cert:\CurrentUser\My. Use “Importar todos”
            para registrar todos de uma vez, sem selecionar um por um — o PFX não é copiado: o app
            guarda apenas a referencia pelo thumbprint.
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <WindowsImportReport report={report} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[var(--pv-muted)]">
                {loading
                  ? 'Lendo repositorio…'
                  : `${items.length} certificado(s) encontrado(s)` +
                    (importable.length > 0
                      ? ` • ${importable.length} novo(s) • ${alreadyImportedCount} já cadastrado(s)`
                      : alreadyImportedCount > 0
                        ? ` • todos já cadastrados`
                        : '')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--pv-muted)]"
                    aria-hidden="true"
                  />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar titular ou documento…"
                    aria-label="Buscar certificado do Windows"
                    className="w-52 pl-8"
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void load()}
                  disabled={loading || busy}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Atualizar
                </Button>
              </div>
            </div>

            {importable.length > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-3 py-2">
                <div className="text-xs">
                  <span className="font-medium">{selectedCount} selecionado(s)</span>
                  {expiredImportable > 0 ? (
                    <span className="text-[var(--pv-muted)]">
                      {' '}
                      • {expiredImportable} vencido(s) serão importados apenas como registro
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={selectAllImportable}
                    disabled={busy || loading}
                  >
                    Selecionar todos os novos
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    disabled={busy || loading || selectedCount === 0}
                  >
                    Limpar
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--pv-border)] pv-scroll">
              {filteredItems.length === 0 && !loading ? (
                <div className="p-6 text-center text-sm text-[var(--pv-muted)]">
                  {search
                    ? 'Nenhum certificado encontrado para essa busca.'
                    : 'Nenhum certificado com chave privada encontrado no repositorio do usuario.'}
                </div>
              ) : (
                filteredItems.map((item) => {
                  const key = item.thumbprintSha1
                  const checked = selected.includes(key)
                  const disabled = item.alreadyImported || busy || loading
                  const expired = new Date(item.notAfter).getTime() <= Date.now()
                  return (
                    <label
                      key={key}
                      className={`flex items-start gap-3 border-b border-[var(--pv-border)] p-3 text-sm last:border-0 ${
                        disabled
                          ? 'opacity-60'
                          : 'cursor-pointer hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(value) =>
                          setSelected((current) =>
                            value === true
                              ? [...current, key]
                              : current.filter((itemKey) => itemKey !== key),
                          )
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{item.holderName}</span>
                          {item.alreadyImported ? (
                            <Badge variant="secondary">Já cadastrado</Badge>
                          ) : null}
                          {expired ? <Badge variant="danger">Vencido</Badge> : null}
                          {!item.hasPrivateKey ? (
                            <Badge variant="danger">Sem chave privada</Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-[var(--pv-muted)]">
                          {item.document ?? 'Documento não identificado'} • {item.issuer}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[var(--pv-muted)]">
                          <span>Válido até {formatDate(item.notAfter)}</span>
                          <span className="font-mono">{item.thumbprintSha1.slice(0, 20)}...</span>
                        </div>
                      </div>
                      <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                    </label>
                  )
                })
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Vincular a um cliente"
                hint="Opcional; sem cliente, tenta casar automaticamente pelo CPF/CNPJ quando autorizado."
              >
                <Select
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Detectar automaticamente</option>
                  {clients?.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex cursor-pointer items-start gap-2.5 self-end rounded-xl border border-[var(--pv-border)] p-3 text-xs leading-relaxed transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]">
                <Checkbox
                  checked={consent}
                  disabled={busy}
                  onCheckedChange={(checked) => setConsent(checked === true)}
                />
                <span>
                  Tenho autorização do titular. Para CNPJ, autorizo consultar a Brasil API (apenas o
                  CNPJ) para gravar razão social, e-mail e telefone no cadastro do cliente.
                </span>
              </label>
            </div>

            {clientId && !consent ? (
              <Alert variant="warning">
                O vínculo exige confirmação de autorização do titular.
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="danger" title="Falha ao ler o repositorio">
                {error}
              </Alert>
            ) : null}

            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button
                variant="secondary"
                onClick={() => void runImport({ thumbprints: selected })}
                disabled={cannotSubmit || selectedCount === 0}
              >
                {busy ? 'Importando…' : `Importar ${selectedCount} selecionado(s)`}
              </Button>
              <Button
                onClick={() => void runImport({ importAll: true, thumbprints: [] })}
                disabled={cannotSubmit || (importable.length === 0 && selectedCount === 0)}
              >
                <Plus className="h-4 w-4" />
                {busy ? 'Importando…' : `Importar todos (${importable.length} novo(s))`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function WindowsImportReport({
  report,
  onClose,
}: {
  report: WindowsImportSummary
  onClose: () => void
}) {
  return (
    <div className="space-y-4">
      <Alert
        variant={report.errors > 0 ? 'warning' : 'success'}
        title={
          report.imported > 0
            ? `${report.imported} certificado(s) importado(s)`
            : report.errors > 0
              ? 'Nenhum certificado foi importado'
              : 'Nada novo a importar'
        }
      >
        {`Total processado: ${report.total} • Novos: ${report.imported} • Já existiam: ${report.duplicates} • Erros: ${report.errors}.`}
        {report.errors > 0
          ? ' Um certificado inválido não interrompeu os demais — verifique a lista abaixo.'
          : ''}
      </Alert>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--pv-border)] pv-scroll">
        <table className="w-full text-sm">
          <thead className="bg-[var(--pv-panel-2)] text-left text-xs uppercase tracking-wide text-[var(--pv-muted)] dark:bg-[var(--pv-panel-2)]">
            <tr>
              <th className="px-3 py-2">Titular</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Mensagem</th>
            </tr>
          </thead>
          <tbody>
            {report.items.map((item) => (
              <tr key={item.thumbprintSha1} className="border-t border-[var(--pv-border)]">
                <td className="px-3 py-2">
                  <span className="font-medium">{item.holderName ?? '—'}</span>
                  {item.document ? (
                    <span className="block text-xs text-[var(--pv-muted)]">{item.document}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant={
                      item.status === 'imported'
                        ? 'success'
                        : item.status === 'duplicate'
                          ? 'secondary'
                          : item.status === 'expired'
                            ? 'warning'
                            : 'danger'
                    }
                  >
                    {item.status === 'imported' ? (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Importado
                      </span>
                    ) : item.status === 'duplicate' ? (
                      'Já existia'
                    ) : item.status === 'expired' ? (
                      <span className="inline-flex items-center gap-1">
                        <TriangleAlert className="h-3 w-3" /> Vencido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <XCircle className="h-3 w-3" /> Erro
                      </span>
                    )}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--pv-muted)]">{item.message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DialogFooter>
        <Button onClick={onClose}>Concluir</Button>
      </DialogFooter>
    </div>
  )
}
