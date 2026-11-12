'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { FileKey2, FolderOpen, RefreshCw } from 'lucide-react'
import type { Certificate, ImportReport } from '@shared/types'
import { formatDate, formatDocumentMasked } from '@/lib/utils'
import { certificateEffectiveValidToOf } from '@shared/certificate-renewal'
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
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/switch'
import { Progress } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'

type Step = 'files' | 'passwords' | 'options' | 'report'

export function CertificateImportWizard({
  open,
  onOpenChange,
  defaultClientId,
  renewalCertificate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultClientId?: string
  /** Quando informado, o fluxo é de renovação deste certificado (mesmo documento). */
  renewalCertificate?: Certificate | null
}) {
  const invalidate = useInvalidate()
  const { data: clients } = useClients({ status: 'active' })
  const [step, setStep] = React.useState<Step>('files')
  const [files, setFiles] = React.useState<string[]>([])
  const [sharedPassword, setSharedPassword] = React.useState('')
  const [useShared, setUseShared] = React.useState(true)
  const [passwords, setPasswords] = React.useState<Record<string, string>>({})
  const [clientId, setClientId] = React.useState('')
  const [install, setInstall] = React.useState(true)
  const [consent, setConsent] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [report, setReport] = React.useState<ImportReport | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setStep('files')
    setFiles([])
    setSharedPassword('')
    setUseShared(true)
    setPasswords({})
    setClientId(defaultClientId ?? renewalCertificate?.clientId ?? '')
    // Em renovação já há vínculo conhecido (cliente do certificado anterior
    // ou do documento); marco o consentimento para não travar por falta de
    // confirmação, mas mantenho o checkbox visível para revisão.
    setConsent(Boolean(defaultClientId ?? renewalCertificate?.clientId))
    setInstall(true)
    setBusy(false)
    setProgress(0)
    setReport(null)
    setError(null)
  }, [open, defaultClientId, renewalCertificate])

  const pickFiles = async () => {
    try {
      const picked = await aurumBitPortal().certificates.pickPfxFiles()
      if (picked.length > 0) setFiles(picked)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    setProgress(15)
    try {
      const selected = files.map((filePath) => ({
        filePath,
        password: useShared ? sharedPassword : (passwords[filePath] ?? ''),
      }))
      const interval = setInterval(() => setProgress((current) => Math.min(90, current + 7)), 400)
      const result = await aurumBitPortal()
        .certificates.importBatch({
          files: selected,
          sharedPassword: useShared ? sharedPassword : undefined,
          clientId: clientId || null,
          install,
          consent: clientId ? consent : undefined,
        })
        .finally(() => clearInterval(interval))
      setReport(result)
      setProgress(100)
      setStep('report')
      await Promise.all([
        invalidate.certificates(),
        invalidate.certificateStats(),
        invalidate.clients(),
        invalidate.audit(),
      ])
      toast.success(`Importação finalizada: ${result.success} certificado(s) importado(s).`)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const canContinueFromFiles = files.length > 0

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {renewalCertificate ? 'Renovar certificado' : 'Importar certificados A1'}
          </DialogTitle>
          <DialogDescription>
            {renewalCertificate
              ? 'Importe o novo PFX/P12 com data válida. Ele será vinculado pelo mesmo documento e este certificado passará a “Renovado”, ficando no histórico de renovação.'
              : 'Arquivos PFX/P12 sao lidos em segundo plano, cifrados no cofre e instalados no repositorio do Windows quando solicitado. Um arquivo inválido não interrompe os demais.'}
          </DialogDescription>
        </DialogHeader>

        {renewalCertificate ? (
          <Alert variant="info" title="Renovação em andamento">
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              {renewalCertificate.holderName}
              {renewalCertificate.document
                ? ` • ${formatDocumentMasked(renewalCertificate.document)}`
                : ''}{' '}
              — válido até {formatDate(certificateEffectiveValidToOf(renewalCertificate))}.
              {renewalCertificate.isRenewed
                ? ' Este já está renovado; importe apenas se for uma nova emissão.'
                : ' Ao importar um novo com data válida, este ficará como “Renovado”.'}
            </span>
          </Alert>
        ) : null}

        <ol
          className="flex flex-wrap items-center gap-1.5 text-xs font-medium"
          aria-label="Etapas da importação"
        >
          {(
            [
              ['files', '1. Arquivos'],
              ['passwords', '2. Senhas'],
              ['options', '3. Vínculos'],
              ['report', '4. Resultado'],
            ] as const satisfies ReadonlyArray<readonly [Step, string]>
          ).map(([key, label]) => {
            const order: Step[] = ['files', 'passwords', 'options', 'report']
            const done = order.indexOf(step) > order.indexOf(key)
            const current = step === key
            return (
              <li
                key={key}
                aria-current={current ? 'step' : undefined}
                className={
                  current
                    ? 'rounded-full bg-brand-600 px-3 py-1.5 text-brand-50 shadow-sm'
                    : done
                      ? 'rounded-full bg-brand-100 px-3 py-1.5 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200'
                      : 'rounded-full border border-[var(--pv-border)] px-3 py-1.5 text-[var(--pv-muted)]'
                }
              >
                {label}
              </li>
            )
          })}
        </ol>

        {step === 'files' ? (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => void pickFiles()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--pv-border)] p-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/50 dark:hover:bg-brand-500/5"
            >
              <FolderOpen className="h-7 w-7 text-[var(--pv-accent)]" />
              <span className="text-sm font-medium">Selecionar arquivos .pfx ou .p12</span>
              <span className="text-xs text-[var(--pv-muted)]">
                O seletor nativo permite multiplos arquivos. Limite de 20 MB por arquivo.
              </span>
            </button>
            {files.length > 0 ? (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-[var(--pv-border)] p-2 pv-scroll">
                {files.map((file) => (
                  <div
                    key={file}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]"
                  >
                    <FileKey2 className="h-4 w-4 text-[var(--pv-muted)]" />
                    <span className="min-w-0 flex-1 truncate">{file.split(/[\\/]/).pop()}</span>
                    <span className="text-xs text-[var(--pv-muted)]">{file}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'passwords' ? (
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={useShared}
                onCheckedChange={(checked) => setUseShared(checked === true)}
              />
              Usar a mesma senha para todos os arquivos
            </label>
            {useShared ? (
              <Field label="Senha dos PFX" required>
                <Input
                  type="password"
                  value={sharedPassword}
                  onChange={(event) => setSharedPassword(event.target.value)}
                  autoComplete="off"
                />
              </Field>
            ) : (
              <div className="max-h-72 space-y-3 overflow-y-auto pv-scroll">
                {files.map((file) => (
                  <Field key={file} label={file.split(/[\\/]/).pop() ?? file}>
                    <Input
                      type="password"
                      value={passwords[file] ?? ''}
                      onChange={(event) =>
                        setPasswords((current) => ({ ...current, [file]: event.target.value }))
                      }
                      autoComplete="off"
                    />
                  </Field>
                ))}
              </div>
            )}
            <Alert variant="info">
              A senha e enviada apenas para o processo principal, usada para abrir o PFX e cifrada
              junto ao arquivo. Ela nunca aparece em logs.
            </Alert>
          </div>
        ) : null}

        {step === 'options' ? (
          <div className="space-y-4">
            <Field
              label="Vincular a um cliente"
              hint="Opcional. Sem cliente, o app tenta casar automaticamente pelo CPF/CNPJ do titular."
            >
              <Select value={clientId} onChange={(event) => setClientId(event.target.value)}>
                <option value="">Detectar automaticamente pelo documento</option>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name} — {client.document}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox
                checked={install}
                onCheckedChange={(checked) => setInstall(checked === true)}
              />
              Instalar no repositório do Windows (Cert:\CurrentUser\My) com chave não exportável
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--pv-border)] p-3.5 text-sm leading-relaxed transition-colors hover:border-brand-300 hover:bg-[var(--pv-accent-soft)] dark:hover:bg-[var(--pv-accent-soft)]">
              <Checkbox
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
                className="mt-0.5"
              />
              <span>
                Confirmo que o escritorio tem autorizacao do titular para importar e usar este
                certificado. Para CNPJ, autorizo consultar a Brasil API (apenas o CNPJ) para gravar
                razão social, e-mail e telefone no cadastro. O consentimento será registrado na
                auditoria no primeiro vínculo.
              </span>
            </label>
            {clientId && !consent ? (
              <Alert variant="warning">
                O vínculo com um cliente exige confirmação de autorização (LGPD).
              </Alert>
            ) : null}
          </div>
        ) : null}

        {step === 'report' && report ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Summary label="Total" value={report.total} />
              <Summary label="Sucesso" value={report.success} tone="success" />
              <Summary label="Duplicados" value={report.duplicates} tone="warning" />
              <Summary label="Erros" value={report.errors + report.expired} tone="danger" />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--pv-border)] pv-scroll">
              <table className="w-full text-sm">
                <thead className="bg-[var(--pv-panel-2)] text-left text-xs uppercase tracking-wide text-[var(--pv-muted)] dark:bg-[var(--pv-panel-2)]">
                  <tr>
                    <th className="px-3 py-2">Arquivo</th>
                    <th className="px-3 py-2">Titular</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item, index) => (
                    <tr
                      key={`${item.filePath}-${index}`}
                      className="border-t border-[var(--pv-border)]"
                    >
                      <td className="px-3 py-2">{item.fileName}</td>
                      <td className="px-3 py-2">{item.holderName ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            item.status === 'success'
                              ? 'success'
                              : item.status === 'duplicate'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {item.status === 'success'
                            ? 'Importado'
                            : item.status === 'duplicate'
                              ? 'Duplicado'
                              : item.status === 'expired'
                                ? 'Vencido'
                                : 'Erro'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-[var(--pv-muted)]">
                        {item.message ??
                          (item.installed ? 'Instalado no Windows' : 'Somente cofre')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {busy ? (
          <div className="space-y-1">
            <Progress value={progress} />
            <p className="text-xs text-[var(--pv-muted)]">
              Processando arquivos em segundo plano...
            </p>
          </div>
        ) : null}

        {error ? (
          <Alert variant="danger" title="Falha na importação">
            {error}
          </Alert>
        ) : null}

        <DialogFooter>
          {step === 'report' ? (
            <Button onClick={() => onOpenChange(false)}>Concluir</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              {step !== 'files' ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    setStep(
                      step === 'options' ? 'passwords' : step === 'passwords' ? 'files' : 'files',
                    )
                  }
                >
                  Voltar
                </Button>
              ) : null}
              {step === 'files' ? (
                <Button disabled={!canContinueFromFiles} onClick={() => setStep('passwords')}>
                  Continuar
                </Button>
              ) : step === 'passwords' ? (
                <Button
                  disabled={
                    busy ||
                    (useShared
                      ? sharedPassword.length === 0
                      : files.some((file) => !(passwords[file] ?? '')))
                  }
                  onClick={() => setStep('options')}
                >
                  Continuar
                </Button>
              ) : (
                <Button
                  disabled={busy || (Boolean(clientId) && !consent)}
                  onClick={() => void run()}
                >
                  {busy ? 'Importando...' : `Importar ${files.length} arquivo(s)`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'success' | 'warning' | 'danger'
}) {
  const color =
    tone === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'danger'
          ? 'text-[var(--pv-danger)]'
          : 'text-[var(--pv-text)]'
  return (
    <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3">
      <div className="text-xs text-[var(--pv-muted)]">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  )
}
