'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Building2,
  ChevronDown,
  FolderOpen,
  ImagePlus,
  Info,
  Loader2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Save,
  ScanSearch,
  ScanBarcode,
  Settings,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { APP_DISPLAY_NAME } from '@shared/constants'
import type {
  AppSettings,
  LetterheadSettings,
  OfficeProfile,
  UpdateCheckResult,
} from '@shared/types'
import { formatDocumentPartial, isValidCNPJ, isValidCPF, onlyDigits } from '@shared/validation'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useAppInfo, useInvalidate, useSettings } from '@/lib/queries'
import { cn, formatBytes, formatDateTime } from '@/lib/utils'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/alert'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { LetterheadEditor } from '@/components/settings/letterhead-editor'
import { HolidaysCard } from '@/components/settings/holidays-card'
import { generateReportPdf } from '@/lib/pdf/report-document'
import { saveReportPdf } from '@/lib/pdf/save-report'

export default function SettingsPage() {
  const invalidate = useInvalidate()
  const { data: settings } = useSettings()
  const { data: info } = useAppInfo()
  const [draft, setDraft] = React.useState<AppSettings | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [resetOpen, setResetOpen] = React.useState(false)
  const [update, setUpdate] = React.useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = React.useState(false)
  const [lookupBusy, setLookupBusy] = React.useState(false)
  const [logoError, setLogoError] = React.useState<string | null>(null)
  const [testPdfBusy, setTestPdfBusy] = React.useState(false)
  const logoInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }

  const patchOffice = <K extends keyof OfficeProfile>(key: K, value: OfficeProfile[K]) => {
    setDraft((current) =>
      current ? { ...current, office: { ...current.office, [key]: value } } : current,
    )
  }

  const patchLetterhead = (next: LetterheadSettings) => {
    setDraft((current) => (current ? { ...current, letterhead: next } : current))
  }

  const generateTestPdf = async () => {
    if (!draft || testPdfBusy) return
    setTestPdfBusy(true)
    try {
      const result = await generateReportPdf({
        title: 'Relatorio de Teste do Timbrado',
        subtitle: 'Modelo de exemplo gerado a partir das Configuracoes',
        meta: [
          `Gerado em ${formatDateTime(new Date().toISOString())}`,
          'Este modelo demonstra margens, barra divisoria, titulo e rodapé com barcode.',
        ],
        office: draft.office,
        letterhead: draft.letterhead,
        sections: [
          {
            heading: 'Dados de exemplo',
            paragraphs: [
              'Este paragrafo demonstra o corpo editorial do documento. O timbrado acima identifica o escritorio emissor (logomarca a esquerda, dados da empresa e do gestor a direita), a barra divisoria separa o emissor do titulo do relatorio, e abaixo fica o conteudo. Todo documento possui codigo de rastreio unico com barcode Code128 no cabecalho da primeira pagina (ou representacao figurativa, se a geracao falhar) e codigo de rastreio no rodape de todas as paginas.',
            ],
          },
          {
            heading: 'Exemplo de tabela',
            table: {
              columns: ['Item', 'Descricao', 'Situacao'],
              widths: [1, 2.2, 1.1],
              rows: [
                ['01', 'Margens A4 de 18 mm com grade editorial', 'OK'],
                ['02', 'Barra divisoria na cor primaria', 'OK'],
                ['03', 'Codigo de rastreio + barcode Code128', 'OK'],
                ['04', 'Logomarca a esquerda e dados do emissor', 'OK'],
              ],
            },
          },
        ],
      })
      const saved = await saveReportPdf({
        filename: `relatorio-teste-${result.trackingCode}.pdf`,
        bytes: result.bytes,
        trackingCode: result.trackingCode,
        title: 'Relatorio de Teste do Timbrado',
      })
      if (saved.path) {
        toast.success('PDF de teste salvo.', {
          description: `Codigo de rastreio: ${result.trackingCode}`,
        })
        await invalidate.audit()
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setTestPdfBusy(false)
    }
  }

  const lookupOfficeCnpj = async () => {
    if (!draft || lookupBusy) return
    const digits = onlyDigits(draft.office.cnpj)
    if (digits.length !== 14) return
    setLookupBusy(true)
    try {
      const company = await aurumBitPortal().clients.cnpjLookup({
        document: draft.office.cnpj,
      })
      const nextOffice: OfficeProfile = { ...draft.office }
      const filled: string[] = []
      if (!nextOffice.legalName.trim() && company.name) {
        nextOffice.legalName = company.name
        filled.push('razão social')
      }
      if (!nextOffice.tradeName.trim() && company.tradeName) {
        nextOffice.tradeName = company.tradeName
        filled.push('nome fantasia')
      }
      if (!nextOffice.municipalRegistration.trim() && company.municipalRegistration) {
        nextOffice.municipalRegistration = company.municipalRegistration
        filled.push('inscrição municipal')
      }
      if (!nextOffice.stateRegistration.trim() && company.stateRegistration) {
        nextOffice.stateRegistration = company.stateRegistration
        filled.push('inscrição estadual')
      }
      if (filled.length > 0) {
        setDraft((current) => (current ? { ...current, office: nextOffice } : current))
        toast.success(`Dados do CNPJ preenchidos: ${filled.join(', ')}.`)
      } else {
        toast.info(
          'Nenhum campo vazio para preencher. Apague o dado que deseja atualizar e busque novamente.',
        )
      }
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setLookupBusy(false)
    }
  }

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return
    setLogoError(null)
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      setLogoError('Use uma imagem PNG, JPG ou WebP.')
      return
    }
    if (file.size > 1024 * 1024) {
      setLogoError('A imagem deve ter no máximo 1 MB.')
      return
    }
    if (file.size === 0) {
      setLogoError('O arquivo da logomarca está vazio.')
      return
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
        reader.readAsDataURL(file)
      })
      patchOffice('logoBase64', dataUrl)
      toast.success('Logomarca carregada. Salve as alterações para aplicar.')
    } catch {
      setLogoError('Não foi possível ler a imagem. Tente novamente.')
    }
  }

  const removeLogo = () => {
    patchOffice('logoBase64', null)
    setLogoError(null)
    if (logoInputRef.current) logoInputRef.current.value = ''
    toast.info('Logomarca removida. Salve as alterações para aplicar.')
  }

  const isDirty = React.useMemo(() => {
    if (!draft || !settings) return false
    return JSON.stringify(draft) !== JSON.stringify(settings)
  }, [draft, settings])

  const save = async () => {
    if (!draft) return
    const officeCnpjDigits = onlyDigits(draft.office.cnpj)
    if (officeCnpjDigits && !isValidCNPJ(officeCnpjDigits)) {
      toast.error('CNPJ do escritório inválido. Confira o número antes de salvar.')
      return
    }
    const managerCpfDigits = onlyDigits(draft.office.managerCpf)
    if (managerCpfDigits && !isValidCPF(managerCpfDigits)) {
      toast.error('CPF do gestor inválido. Confira o número antes de salvar.')
      return
    }
    if (
      draft.office.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.office.email.trim())
    ) {
      toast.error('E-mail do escritório inválido. Confira antes de salvar.')
      return
    }
    const hexFields: Array<
      'primaryColor' | 'accentColor' | 'inkColor' | 'mutedColor' | 'surfaceColor'
    > = ['primaryColor', 'accentColor', 'inkColor', 'mutedColor', 'surfaceColor']
    const badColor = hexFields.find((field) => !/^#[0-9a-fA-F]{6}$/.test(draft.letterhead[field]))
    if (badColor) {
      toast.error('Uma cor do timbrado está inválida. Use o formato #RRGGBB.')
      return
    }
    setSaving(true)
    try {
      await aurumBitPortal().settings.set(draft)
      toast.success('Configurações salvas.')
      await Promise.all([invalidate.settings(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    try {
      await aurumBitPortal().settings.reset()
      toast.success('Configurações restauradas para o padrão.')
      await Promise.all([invalidate.settings(), invalidate.audit()])
      setResetOpen(false)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const openLogs = async () => {
    try {
      await aurumBitPortal().app.openLogs()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const checkUpdates = async () => {
    setChecking(true)
    try {
      const result = await aurumBitPortal().app.checkUpdates()
      setUpdate(result)
      if (result.status === 'available') toast.info(result.message)
      else toast.success(result.message)
      await Promise.all([invalidate.appInfo(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  if (!draft) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[860px] space-y-4">
          <div className="h-24 animate-pulse rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)]" />
          <div className="h-72 animate-pulse rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)]" />
        </div>
      </AppShell>
    )
  }

  const officeCnpjDigits = onlyDigits(draft.office.cnpj)
  const officeCnpjError =
    officeCnpjDigits && !isValidCNPJ(officeCnpjDigits)
      ? 'CNPJ inválido. Confira os 14 dígitos.'
      : null
  const officeManagerCpfDigits = onlyDigits(draft.office.managerCpf)
  const officeManagerCpfError =
    officeManagerCpfDigits && !isValidCPF(officeManagerCpfDigits)
      ? 'CPF inválido. Confira os 11 dígitos.'
      : null
  const canLookupOfficeCnpj = officeCnpjDigits.length === 14 && !lookupBusy && !saving
  const logoApproxBytes = draft.office.logoBase64
    ? Math.round(draft.office.logoBase64.length * 0.75)
    : 0

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[980px]">
        {/* Cabeçalho enxuto e contido — sem cartão pesado */}
        <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--pv-accent-solid)] text-[var(--pv-on-accent)] shadow-md">
              <Settings className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="pv-eyebrow">Sistema</div>
              <h1 className="text-[22px] font-bold leading-tight tracking-[-0.02em]">
                Configurações
              </h1>
              <p className="mt-0.5 max-w-xl text-[13px] leading-relaxed text-[var(--pv-muted)]">
                Preferências locais do aplicativo. Nenhuma sincronização com a nuvem.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-1.5">
            {isDirty ? (
              <Badge variant="warning">Alterações não salvas</Badge>
            ) : (
              <Badge variant="success">Tudo salvo</Badge>
            )}
          </div>
        </header>

        <div className="space-y-8">
          {/* Escritório e responsável — primeira seção */}
          <Section
            icon={<Building2 className="h-4 w-4" aria-hidden="true" />}
            title="Escritório e responsável"
            subtitle="Identificação, responsável e contato usados nos relatórios. Clique no título para recolher."
          >
            <SubGroup title="Identificação">
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="CNPJ do escritório"
                  className="min-w-0 flex-1"
                  error={officeCnpjError}
                >
                  <Input
                    value={draft.office.cnpj ? formatDocumentPartial(draft.office.cnpj) : ''}
                    onChange={(event) => patchOffice('cnpj', onlyDigits(event.target.value))}
                    inputMode="numeric"
                    maxLength={18}
                    placeholder="00.000.000/0000-00"
                    aria-invalid={Boolean(officeCnpjError)}
                  />
                </Field>
                <Button
                  variant="secondary"
                  onClick={() => void lookupOfficeCnpj()}
                  disabled={!canLookupOfficeCnpj}
                  title={
                    officeCnpjDigits.length === 14
                      ? 'Buscar razão social, nome fantasia e inscrições na Brasil API'
                      : 'Digite os 14 dígitos do CNPJ para buscar'
                  }
                >
                  {lookupBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ScanSearch className="h-4 w-4" aria-hidden="true" />
                  )}
                  {lookupBusy ? 'Buscando…' : 'Buscar dados'}
                </Button>
              </div>
              {!officeCnpjError ? (
                <p className="text-xs text-[var(--pv-muted)]">
                  Digite os 14 dígitos e busque os dados públicos na Brasil API (consulta auditada).
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Razão social">
                  <Input
                    value={draft.office.legalName}
                    onChange={(event) => patchOffice('legalName', event.target.value)}
                    maxLength={200}
                    placeholder="Escritório de Contabilidade LTDA"
                  />
                </Field>
                <Field label="Nome fantasia">
                  <Input
                    value={draft.office.tradeName}
                    onChange={(event) => patchOffice('tradeName', event.target.value)}
                    maxLength={200}
                    placeholder="Nome do escritório"
                  />
                </Field>
              </div>
            </SubGroup>

            <SubGroup title="Responsável e inscrições">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Gestor do escritório">
                  <Input
                    value={draft.office.managerName}
                    onChange={(event) => patchOffice('managerName', event.target.value)}
                    maxLength={200}
                    placeholder="Responsável pelo escritório"
                  />
                </Field>
                <Field label="CPF do gestor" error={officeManagerCpfError}>
                  <Input
                    value={
                      draft.office.managerCpf ? formatDocumentPartial(draft.office.managerCpf) : ''
                    }
                    onChange={(event) => patchOffice('managerCpf', onlyDigits(event.target.value))}
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="000.000.000-00"
                    aria-invalid={Boolean(officeManagerCpfError)}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Inscrição municipal">
                  <Input
                    value={draft.office.municipalRegistration}
                    onChange={(event) => patchOffice('municipalRegistration', event.target.value)}
                    maxLength={30}
                    placeholder="IM do escritório"
                  />
                </Field>
                <Field label="Inscrição estadual">
                  <Input
                    value={draft.office.stateRegistration}
                    onChange={(event) => patchOffice('stateRegistration', event.target.value)}
                    maxLength={30}
                    placeholder="IE do escritório"
                  />
                </Field>
              </div>
            </SubGroup>

            <SubGroup title="Endereço e contato">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
                <Field label="Endereço">
                  <Input
                    value={draft.office.address}
                    onChange={(event) => patchOffice('address', event.target.value)}
                    maxLength={255}
                    placeholder="Rua, número, bairro"
                  />
                </Field>
                <div className="grid grid-cols-[1fr_72px] gap-3">
                  <Field label="Cidade">
                    <Input
                      value={draft.office.city}
                      onChange={(event) => patchOffice('city', event.target.value)}
                      maxLength={120}
                      placeholder="São Paulo"
                    />
                  </Field>
                  <Field label="UF">
                    <Input
                      value={draft.office.state}
                      onChange={(event) =>
                        patchOffice('state', event.target.value.toUpperCase().slice(0, 2))
                      }
                      maxLength={2}
                      placeholder="SP"
                    />
                  </Field>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Telefone">
                  <Input
                    value={draft.office.phone}
                    onChange={(event) => patchOffice('phone', event.target.value)}
                    maxLength={30}
                    placeholder="(11) 3000-0000"
                  />
                </Field>
                <Field label="E-mail">
                  <Input
                    type="email"
                    value={draft.office.email}
                    onChange={(event) => patchOffice('email', event.target.value)}
                    maxLength={254}
                    placeholder="contato@escritorio.com.br"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Site">
                  <Input
                    value={draft.office.website}
                    onChange={(event) => patchOffice('website', event.target.value)}
                    maxLength={200}
                    placeholder="www.escritorio.com.br"
                  />
                </Field>
                <Field label="Registro profissional">
                  <Input
                    value={draft.office.registration}
                    onChange={(event) => patchOffice('registration', event.target.value)}
                    maxLength={30}
                    placeholder="CRC / Nº de registro"
                  />
                </Field>
              </div>
            </SubGroup>

            <div className="rounded-2xl bg-[var(--pv-panel-2)] p-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-20 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)]">
                  {draft.office.logoBase64 ? (
                    <img
                      src={draft.office.logoBase64}
                      alt="Logomarca do escritório"
                      className="max-h-full max-w-full object-contain p-1"
                    />
                  ) : (
                    <span className="px-2 text-center text-xs text-[var(--pv-muted)]">
                      Sem logomarca
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-snug">Logomarca</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--pv-muted)]">
                    PNG, JPG ou WebP (até 1 MB), convertido e salvo em Base64. Usada no cabeçalho de
                    relatórios customizados.
                    {draft.office.logoBase64
                      ? ` Tamanho atual: ${formatBytes(logoApproxBytes)}.`
                      : null}
                  </p>
                  {logoError ? (
                    <p role="alert" className="mt-1 text-xs font-medium text-[var(--pv-danger)]">
                      {logoError}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      aria-label="Selecionar logomarca do escritório"
                      onChange={(event) => {
                        void handleLogoFile(event.target.files?.[0])
                        event.target.value = ''
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={saving}
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      {draft.office.logoBase64 ? 'Trocar logomarca' : 'Enviar logomarca'}
                    </Button>
                    {draft.office.logoBase64 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={removeLogo}
                        disabled={saving}
                        className="text-[var(--pv-danger)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remover
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </Section>

          {/* Timbrado e relatórios */}
          <Section
            icon={<ScanBarcode className="h-4 w-4" aria-hidden="true" />}
            title="Timbrado e relatórios"
            subtitle="Identidade padrão de todos os PDFs — tema, barra e barcode."
          >
            <LetterheadEditor
              office={draft.office}
              value={draft.letterhead}
              onChange={patchLetterhead}
              generating={testPdfBusy}
              onGenerateTest={() => void generateTestPdf()}
            />
          </Section>

          <div className="grid items-start gap-8 lg:grid-cols-2">
            {/* Aparência */}
            <Section
              icon={<Monitor className="h-4 w-4" aria-hidden="true" />}
              title="Aparência e idioma"
              subtitle="Tema da interface e cópia de senhas."
            >
              <Field label="Tema">
                <Select
                  value={draft.theme}
                  onChange={(event) => patch('theme', event.target.value as AppSettings['theme'])}
                >
                  <option value="system">Seguir o Windows</option>
                  <option value="light">Claro</option>
                  <option value="dark">Escuro</option>
                </Select>
              </Field>

              <ToggleRow
                title="Mascarar senhas"
                description="Exibe marcadores até a revelação explícita."
                checked={draft.maskPasswords}
                onCheckedChange={(checked) => patch('maskPasswords', checked)}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Ocultar senha revelada em (s)">
                  <Input
                    type="number"
                    min={3}
                    max={120}
                    value={draft.passwordRevealSeconds}
                    onChange={(event) => patch('passwordRevealSeconds', Number(event.target.value))}
                  />
                </Field>
                <Field label="Limpar área de transferência em (s)">
                  <Input
                    type="number"
                    min={5}
                    max={300}
                    value={draft.clipboardClearSeconds}
                    onChange={(event) => patch('clipboardClearSeconds', Number(event.target.value))}
                  />
                </Field>
              </div>

              <p className="text-xs text-[var(--pv-muted)]">
                Idioma fixo em português do Brasil (pt-BR) nesta versão.
              </p>
            </Section>

            {/* Segurança */}
            <Section
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              title="Segurança e sessões"
              subtitle="Limites de sessão e bloqueio por inatividade."
            >
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Limite de sessões simultâneas" hint="Mínimo 2, máximo 40">
                  <Input
                    type="number"
                    min={2}
                    max={40}
                    value={draft.sessionLimit}
                    onChange={(event) => patch('sessionLimit', Number(event.target.value))}
                  />
                </Field>
                <Field label="Bloquear após inatividade (min)" hint="0 desativa o bloqueio">
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    value={draft.idleLockMinutes}
                    onChange={(event) => patch('idleLockMinutes', Number(event.target.value))}
                  />
                </Field>
              </div>

              <ToggleRow
                title="Confirmar abertura de link externo"
                description="Links saem da sessão isolada e abrem no navegador padrão."
                checked={draft.confirmOpenExternal}
                onCheckedChange={(checked) => patch('confirmOpenExternal', checked)}
              />

              <ToggleRow
                title="Consultar dados públicos de CNPJ (automático)"
                description="Preenche a razão social via Brasil API na importação ou cadastro. Apenas o CNPJ é enviado; consultas são auditadas."
                checked={draft.externalCnpjLookup}
                onCheckedChange={(checked) => patch('externalCnpjLookup', checked)}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Ao fechar a última janela">
                  <Select
                    value={draft.closeBehavior}
                    onChange={(event) =>
                      patch('closeBehavior', event.target.value as AppSettings['closeBehavior'])
                    }
                  >
                    <option value="ask">Perguntar</option>
                    <option value="quit">Encerrar o aplicativo</option>
                  </Select>
                </Field>
                <Field label="Retenção da auditoria (dias)" hint="Entre 30 e 3650 dias">
                  <Input
                    type="number"
                    min={30}
                    max={3650}
                    value={draft.retainAuditDays}
                    onChange={(event) => patch('retainAuditDays', Number(event.target.value))}
                  />
                </Field>
              </div>
            </Section>
          </div>

          {/* Atualizações */}
          <Section
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            title="Atualizações"
            subtitle="A verificação consulta metadados públicos, sem enviar dados do cofre."
          >
            <ToggleRow
              title="Verificar automaticamente"
              description="Recomendado apenas em máquinas com política de atualização."
              checked={draft.autoCheckUpdates}
              onCheckedChange={(checked) => patch('autoCheckUpdates', checked)}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Canal" className="flex-1">
                <Select
                  value={draft.autoUpdateChannel}
                  onChange={(event) =>
                    patch(
                      'autoUpdateChannel',
                      event.target.value as AppSettings['autoUpdateChannel'],
                    )
                  }
                >
                  <option value="stable">Estável</option>
                  <option value="beta">Beta</option>
                </Select>
              </Field>
              <Button variant="secondary" onClick={() => void checkUpdates()} disabled={checking}>
                <RefreshCw
                  className={checking ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
                  aria-hidden="true"
                />
                {checking ? 'Verificando…' : 'Verificar agora'}
              </Button>
            </div>

            {update ? (
              <Alert
                variant={
                  update.status === 'available'
                    ? 'info'
                    : update.status === 'error'
                      ? 'danger'
                      : 'success'
                }
                title={update.message}
              >
                {update.version ? `Versão disponível: ${update.version}` : null}
              </Alert>
            ) : null}
          </Section>

          {/* Assinaturas digitais (PAdES-B-T / TSA) — oculto da UI; valores (signTsaUrl, signStampReason) preservados no draft. */}
          {/* Sobre */}
          <Section
            icon={<Info className="h-4 w-4" aria-hidden="true" />}
            title="Sobre e diagnóstico"
            subtitle="Versões, caminhos locais e integridade do cofre."
          >
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Diag label="Versão" value={info ? `v${info.version}` : '—'} />
              <Diag label="Electron" value={info?.electronVersion ?? '—'} />
              <Diag label="Chromium" value={info?.chromeVersion ?? '—'} />
              <Diag label="Node" value={info?.nodeVersion ?? '—'} />
              <Diag label="Plataforma" value={info ? `${info.platform} ${info.arch}` : '—'} />
              <div className="grid content-start gap-0.5">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pv-faint)]">
                  safeStorage/DPAPI
                </dt>
                <dd className="text-[13px] font-medium">
                  {info ? (
                    <Badge variant={info.safeStorageAvailable ? 'success' : 'danger'}>
                      {info.safeStorageAvailable ? 'Disponível' : 'Indisponível'}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <Diag label="Eventos de auditoria" value={String(info?.auditCount ?? 0)} />
              <div className="grid content-start gap-0.5">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pv-faint)]">
                  Atualizações
                </dt>
                <dd className="text-[13px] font-medium">
                  <Badge variant="outline">{info?.updateStatus ?? 'idle'}</Badge>
                </dd>
              </div>
              <Diag
                label="Banco de dados"
                wide
                value={
                  <>
                    {info?.databasePath ?? '—'}{' '}
                    <span className="text-[var(--pv-muted)]">
                      ({formatBytes(info?.databaseSizeBytes ?? 0)})
                    </span>
                  </>
                }
              />
              <Diag label="Pasta de dados" wide value={info?.userDataPath ?? '—'} mono />
              <Diag label="Logs" wide value={info?.logsPath ?? '—'} mono />
            </dl>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => void openLogs()}>
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Abrir logs
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void invalidate.appInfo()}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Atualizar diagnóstico
              </Button>
            </div>

            <p className="border-t border-[var(--pv-border-subtle)] pt-3 text-xs leading-relaxed text-[var(--pv-muted)]">
              Banco SQLite, logs e cofre ficam na pasta de dados do Windows. Backup do banco com o
              aplicativo fechado.
              {' • '}Última leitura: {formatDateTime(new Date().toISOString())}
              {info && !info.isDev
                ? ` • Build de produção. Nenhum servidor remoto do ${APP_DISPLAY_NAME} é usado.`
                : ''}
            </p>
          </Section>

          <HolidaysCard />

          {/* Zona de perigo — compacta, discreta */}
          <Card className="flex flex-col gap-3 border-dashed bg-transparent p-5 shadow-none sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <RotateCcw className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
                Restaurar padrões
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[var(--pv-muted)]">
                Restaura apenas preferências. Clientes, certificados, credenciais e auditoria são
                mantidos.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 text-[var(--pv-danger)] hover:border-[var(--pv-danger-border)] hover:bg-[var(--pv-danger-soft)]"
              onClick={() => setResetOpen(true)}
            >
              Restaurar configurações padrão
            </Button>
          </Card>

          {/* Barra de ações fixa — fácil de alcançar na rolagem */}
          <div className="sticky bottom-4 z-10 pb-1 pt-1">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)]/90 px-4 py-3 shadow-[var(--pv-shadow-lg)] backdrop-blur">
              <p className="flex min-w-0 items-center gap-2 text-xs text-[var(--pv-muted)]">
                <span
                  aria-hidden="true"
                  className={
                    isDirty
                      ? 'h-2 w-2 shrink-0 rounded-full bg-[var(--pv-warning)]'
                      : 'h-2 w-2 shrink-0 rounded-full bg-[var(--pv-success)]'
                  }
                />
                <span className="truncate">
                  {isDirty ? 'Alterações não salvas' : 'Nenhuma alteração pendente'}
                </span>
              </p>
              <Button onClick={() => void save()} disabled={!isDirty || saving} size="sm">
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Restaurar configurações?"
        description="Tema, dados do escritório e responsável, limites de sessão, retenção de auditoria e demais preferências voltam ao padrão. Nenhum dado de cliente, certificado ou credencial é apagado."
        confirmLabel="Restaurar padrões"
        onConfirm={() => void reset()}
      />
    </AppShell>
  )
}

/* ---------- Componentes locais de seção ---------- */

function Section({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-6 py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/40"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] ring-1 ring-[var(--pv-accent-soft-border)]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight">{title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--pv-muted)]">
            {subtitle}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[var(--pv-faint)] transition-transform duration-200',
            !open && '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className={cn('overflow-hidden', !open && 'invisible')}>
          <div className="space-y-6 px-6 pb-6">{children}</div>
        </div>
      </div>
    </Card>
  )
}

/** Subgrupo dentro de uma seção: rótulo discreto + respiro, sem novo card. */
function SubGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="pv-eyebrow">{title}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--pv-border-subtle)]" />
      </div>
      {children}
    </div>
  )
}

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--pv-border-subtle)] py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-medium leading-snug">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--pv-muted)]">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
    </div>
  )
}

function Diag({
  label,
  value,
  wide = false,
  mono = false,
}: {
  label: string
  value: React.ReactNode
  wide?: boolean
  mono?: boolean
}) {
  return (
    <div
      className={wide ? 'grid content-start gap-0.5 sm:col-span-2' : 'grid content-start gap-0.5'}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--pv-faint)]">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'break-all font-mono text-xs font-normal text-[var(--pv-muted)]'
            : 'break-words text-[13px] font-medium'
        }
      >
        {value}
      </dd>
    </div>
  )
}
