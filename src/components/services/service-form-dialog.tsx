'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Braces,
  ChevronDown,
  CircleAlert,
  Copy,
  CornerDownLeft,
  Globe,
  GraduationCap,
  Hourglass,
  BadgeCheck,
  ImagePlus,
  KeyRound,
  Landmark,
  Layers,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Timer,
  Trash2,
} from 'lucide-react'
import { SERVICE_CATEGORIES, type AuthMethod, type ServiceCategory } from '@shared/constants'
import {
  deriveServiceDefaults,
  normalizeBaseUrlInput,
  slugifyServiceName,
  volatileQueryParamsIn,
  type LoginFlow,
} from '@shared/custom-service'
import { isGovernmentHost, parseHttpUrl } from '@shared/network'
import type { Service, ServiceInput, WizardState, WizardWarning } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useClients, useCredentials, useCertificates, useInvalidate } from '@/lib/queries'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/switch'
import { Switch } from '@/components/ui/switch'

const LOGIN_FLOW_OPTIONS: Array<{
  value: LoginFlow
  label: string
  description: string
  icon: typeof ShieldCheck
}> = [
  {
    value: 'certificate',
    label: 'Certificado digital',
    description: 'A1 / e-CNPJ ou e-CPF via Windows',
    icon: ShieldCheck,
  },
  {
    value: 'password',
    label: 'Login e senha',
    description: 'Preenchemos os campos; você clica em Entrar',
    icon: KeyRound,
  },
  {
    value: 'both',
    label: 'Os dois',
    description: 'Escolha na hora de abrir o portal',
    icon: Layers,
  },
]

function loginFlowOf(service: Service | null | undefined): LoginFlow {
  if (!service) return 'both'
  const methods = service.authMethods
  if (methods.includes('certificate') && methods.includes('password')) return 'both'
  return methods.includes('password') ? 'password' : 'certificate'
}

const STEP_GLYPHS: Record<string, typeof MousePointerClick> = {
  click: MousePointerClick,
  fill: KeyRound,
  press: CornerDownLeft,
  waitForURL: Hourglass,
  waitFor: Hourglass,
  goto: Globe,
  sleep: Timer,
  evaluate: Braces,
  assert: Braces,
}

function ConfidenceChip({ confidence }: { confidence?: 'high' | 'medium' | 'low' | undefined }) {
  if (!confidence) return null
  const tone =
    confidence === 'high'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : confidence === 'medium'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tone,
      )}
    >
      {confidence === 'high' ? 'firme' : confidence === 'medium' ? 'ok' : 'frágil'}
    </span>
  )
}

function WarningBanner({ warning }: { warning: WizardWarning }) {
  const critical =
    warning.code === 'credential-mismatch' ||
    warning.code === 'step-cap-reached' ||
    warning.code === 'recording-max-duration'
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-snug',
        critical
          ? 'border-[var(--pv-danger)]/40 bg-[var(--pv-danger)]/10 text-[var(--pv-danger)]'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
      )}
    >
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{warning.detail}</span>
    </p>
  )
}

export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
  onOpenRecipe,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  service?: Service | null
  /** Abre o editor técnico de receita (apenas modo avançado de edição). */
  onOpenRecipe?: (service: Service) => void
}) {
  const invalidate = useInvalidate()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [name, setName] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [loginFlow, setLoginFlow] = React.useState<LoginFlow>('both')
  // Avançado
  const [slug, setSlug] = React.useState('')
  const [category, setCategory] = React.useState<ServiceCategory>('Outros')
  const [categoryTouched, setCategoryTouched] = React.useState(false)
  const [domains, setDomains] = React.useState('')
  const [defaultAuth, setDefaultAuth] = React.useState<AuthMethod>('certificate')
  const [notes, setNotes] = React.useState('')
  const [enabled, setEnabled] = React.useState(true)
  const [favorite, setFavorite] = React.useState(false)
  const [recipeActionBusy, setRecipeActionBusy] = React.useState(false)
  const [testMessage, setTestMessage] = React.useState<string | null>(null)
  const [autoSubmit, setAutoSubmit] = React.useState(false)
  // ------------------------------------------------------------------
  // Assistente de gravação (Fase 1, apenas no fluxo de CRIAÇÃO)
  // ------------------------------------------------------------------
  const [stage, setStage] = React.useState<'form' | 'teach' | 'recording' | 'review' | 'saved'>(
    'form',
  )
  const [createdService, setCreatedService] = React.useState<Service | null>(null)
  const [teachClientId, setTeachClientId] = React.useState('')
  const [teachCredentialId, setTeachCredentialId] = React.useState('')
  const [teachCertificateId, setTeachCertificateId] = React.useState('')
  const [teachAuthMethod, setTeachAuthMethod] = React.useState<AuthMethod>('password')
  const [wizardId, setWizardId] = React.useState<string | null>(null)
  const [wizardState, setWizardState] = React.useState<WizardState | null>(null)
  const [wizardBusy, setWizardBusy] = React.useState(false)
  const [reviewRemoved, setReviewRemoved] = React.useState<number[]>([])
  const [reviewAutoSubmit, setReviewAutoSubmit] = React.useState(true)
  const [cancelConfirm, setCancelConfirm] = React.useState(false)
  const clientsQuery = useClients()
  const credentialsQuery = useCredentials(
    teachClientId && createdService
      ? { clientId: teachClientId, serviceId: createdService.id }
      : undefined,
    { enabled: Boolean(teachClientId && createdService) },
  )
  const certificatesQuery = useCertificates(teachClientId ? { clientId: teachClientId } : undefined)
  const usableCertificates = (certificatesQuery.data ?? []).filter(
    (certificate) =>
      certificate.installed &&
      (certificate.status === 'valid' || certificate.status === 'expiring'),
  )

  const normalizedUrl = React.useMemo(() => normalizeBaseUrlInput(baseUrl), [baseUrl])
  const strippedParams = React.useMemo(() => volatileQueryParamsIn(baseUrl), [baseUrl])
  const parsedUrl = React.useMemo(
    () => (normalizedUrl ? parseHttpUrl(normalizedUrl) : null),
    [normalizedUrl],
  )
  const isGovernment = parsedUrl ? isGovernmentHost(parsedUrl.hostname) : false

  const defaults = React.useMemo(() => {
    if (!normalizedUrl) return null
    return deriveServiceDefaults({ name: name || 'servico', baseUrl: normalizedUrl, loginFlow })
  }, [name, normalizedUrl, loginFlow])

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setAdvancedOpen(false)
    setTestMessage(null)
    setStage('form')
    setCreatedService(null)
    setTeachClientId('')
    setTeachCredentialId('')
    setTeachCertificateId('')
    setTeachAuthMethod(service?.defaultAuth ?? 'password')
    setWizardId(null)
    setWizardState(null)
    setWizardBusy(false)
    setReviewRemoved([])
    setReviewAutoSubmit(true)
    setCancelConfirm(false)
    setName(service?.name ?? '')
    setBaseUrl(service?.baseUrl ?? '')
    setLoginFlow(loginFlowOf(service))
    setSlug(service?.slug ?? '')
    setCategory(service?.category ?? 'Outros')
    setCategoryTouched(false)
    setDomains(service?.allowedDomains.join('\n') ?? '')
    setDefaultAuth(service?.defaultAuth ?? 'certificate')
    setNotes(service?.notes ?? '')
    setEnabled(service?.enabled ?? true)
    setFavorite(service?.favorite ?? false)
    setAutoSubmit(service?.recipe?.autoSubmit ?? false)
  }, [open, service])

  const derived = defaults ?? {
    slug: slugifyServiceName(name) || 'servico',
    allowedDomains: [] as string[],
    category,
    defaultAuth,
  }

  const flowMethods: AuthMethod[] = loginFlow === 'both' ? ['certificate', 'password'] : [loginFlow]
  const effectiveDefaultAuth: AuthMethod = flowMethods.includes(defaultAuth)
    ? defaultAuth
    : (flowMethods[0] as AuthMethod)
  // Em serviços novos, a categoria acompanha a derivação (gov.br → Governo
  // Federal) até o usuário mudar manualmente o seletor.
  const effectiveCategory: ServiceCategory =
    service || categoryTouched ? category : (defaults?.category ?? 'Outros')

  const urlHint = React.useMemo(() => {
    if (!baseUrl.trim()) return null
    if (!normalizedUrl) {
      return {
        tone: 'danger' as const,
        text: 'Endereço inválido. Use o endereço completo, por exemplo https://portal.sefaz.gov.br',
      }
    }
    if (isGovernment) {
      return {
        tone: 'good' as const,
        text: 'Site do governo: acesso via certificado gov.br configurado automaticamente.',
      }
    }
    if (loginFlow !== 'password') {
      return {
        tone: 'warn' as const,
        text: 'Certificado digital só funciona em sites que aceitam certificado ICP-Brasil (o próprio governo ou o domínio liberado).',
      }
    }
    return {
      tone: 'good' as const,
      text: 'Preenchimento automático de usuário e senha; você clica em Entrar.',
    }
  }, [baseUrl, normalizedUrl, isGovernment, loginFlow])

  // Poll do estado da gravação (etapa "Gravando…") — 1s; contador ao vivo
  // via onWizardProgress (throttled 1/s no processo principal).
  React.useEffect(() => {
    if (stage !== 'recording' || !wizardId) return
    let alive = true
    const refresh = async (): Promise<void> => {
      try {
        const state = await aurumBitPortal().wizard.state(wizardId)
        if (alive) {
          setWizardState(state)
          // Se a gravação foi concluída no chrome do portal (ou pelo teto), o
          // modal acompanha: vai para a revisão sozinho.
          if (state.status === 'review') {
            setReviewAutoSubmit(state.definition?.autoSubmit ?? true)
            setReviewRemoved([])
            setCancelConfirm(false)
            setStage('review')
          }
        }
      } catch (caught) {
        if (!alive) return
        toast.error(errorMessage(caught))
        setWizardId(null)
        setWizardState(null)
        setCancelConfirm(false)
        setStage('teach')
      }
    }
    const timer = window.setInterval(() => void refresh(), 1000)
    void refresh()
    const unsubscribe = aurumBitPortal().events.onWizardProgress((progress) => {
      if (progress.wizardId !== wizardId) return
      setWizardState((current) =>
        current
          ? {
              ...current,
              stepCount: progress.stepCount,
              screenCount: Math.max(1, progress.screen),
              gaps: progress.gaps,
            }
          : current,
      )
    })
    return () => {
      alive = false
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [stage, wizardId])

  const startRecording = async (): Promise<void> => {
    if (!createdService) return
    setWizardBusy(true)
    setError(null)
    try {
      const input = {
        serviceId: createdService.id,
        clientId: teachClientId,
        authMethod: teachAuthMethod,
        credentialId: teachCredentialId || null,
        certificateId: teachAuthMethod === 'certificate' ? teachCertificateId || null : null,
      }
      // Em acessos existentes, passa pelo guarda do reRecord (nativos nunca regravam).
      const result = service
        ? await aurumBitPortal().recipes.reRecord(input)
        : await aurumBitPortal().wizard.startRecord(input)
      setWizardId(result.wizardId)
      setWizardState({
        wizardId: result.wizardId,
        status: 'recording',
        stepCount: 0,
        screenCount: 1,
        gaps: 0,
        warnings: [],
        loggedInHint: false,
        durationWarning: false,
      })
      setStage('recording')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setWizardBusy(false)
    }
  }

  const finishRecording = async (): Promise<void> => {
    if (!wizardId) return
    setWizardBusy(true)
    setError(null)
    try {
      const state = await aurumBitPortal().wizard.finish(wizardId)
      setWizardState(state)
      setReviewAutoSubmit(state.definition?.autoSubmit ?? true)
      setReviewRemoved([])
      setCancelConfirm(false)
      setStage('review')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setWizardBusy(false)
    }
  }

  const cancelRecording = async (): Promise<void> => {
    if (!wizardId) return
    setWizardBusy(true)
    setError(null)
    try {
      await aurumBitPortal().wizard.cancel(wizardId)
      setWizardId(null)
      setWizardState(null)
      setCancelConfirm(false)
      setStage('teach')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setWizardBusy(false)
    }
  }

  const saveRecorded = async (): Promise<void> => {
    if (!wizardId) return
    setWizardBusy(true)
    setError(null)
    try {
      await aurumBitPortal().wizard.save({
        wizardId,
        autoSubmit: reviewAutoSubmit,
        removedStepIndexes: reviewRemoved.length > 0 ? reviewRemoved : undefined,
      })
      setStage('saved')
      await invalidate.services()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setWizardBusy(false)
    }
  }

  const verifyRobotTest = async (): Promise<void> => {
    if (!createdService) return
    try {
      await aurumBitPortal().sessions.open({
        serviceId: createdService.id,
        clientId: teachClientId,
        authMethod: teachAuthMethod,
        credentialId: teachAuthMethod === 'password' ? teachCredentialId || undefined : undefined,
        forceNew: true,
        origin: 'verify-test',
      })
      toast.success('Abrimos o portal para o teste. Sucesso marcado automaticamente se entrar.')
      await Promise.all([invalidate.services(), invalidate.audit()])
      onOpenChange(false)
    } catch (caught) {
      toast.error(errorMessage(caught))
    }
  }

  const verifyRobotLater = (): void => {
    toast.info(
      'Recomendamos testar antes de confiar no robô — você pode testar depois abrindo o acesso.',
    )
    void Promise.all([invalidate.services(), invalidate.audit()])
    onOpenChange(false)
  }

  const discardRecorded = async (): Promise<void> => {
    if (!wizardId) return
    setWizardBusy(true)
    try {
      await aurumBitPortal().wizard.discard(wizardId)
    } catch {
      // Descarte é idempotente no pior caso; o acesso segue com a automática.
    }
    toast.success('Gravação descartada. O acesso mantém a automação automática.')
    await Promise.all([invalidate.services(), invalidate.audit()])
    onOpenChange(false)
  }

  const reRecord = async (): Promise<void> => {
    if (!wizardId) return
    setWizardBusy(true)
    setError(null)
    try {
      await aurumBitPortal().wizard.cancel(wizardId)
      setWizardId(null)
      setWizardState(null)
      setReviewRemoved([])
      setStage('teach')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setWizardBusy(false)
    }
  }

  const skipTeach = (): void => {
    toast.success('Site adicionado. A automação de login foi configurada automaticamente.')
    void Promise.all([invalidate.services(), invalidate.audit()])
    onOpenChange(false)
  }

  const submit = async () => {
    if (!normalizedUrl) {
      setError('Informe o endereço do site, por exemplo https://portal.sefaz.gov.br')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const parsedDomains = domains
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean)
      const allowedDomains =
        parsedDomains.length > 0
          ? Array.from(new Set(parsedDomains))
          : Array.from(new Set(derived.allowedDomains))
      const input: ServiceInput = {
        name: name.trim(),
        slug: slug.trim() || derived.slug,
        category: effectiveCategory,
        baseUrl: normalizedUrl,
        allowedDomains,
        authMethods: flowMethods,
        defaultAuth: effectiveDefaultAuth,
        notes: notes.trim() || null,
        enabled,
        favorite,
      }
      if (service) {
        await aurumBitPortal().services.update(service.id, input)
        toast.success('Acesso atualizado.')
        await Promise.all([invalidate.services(), invalidate.audit()])
        onOpenChange(false)
        return
      }
      const created = await aurumBitPortal().services.create(input)
      // Logomarca por baixo dos panos; falha aqui não é erro do cadastro.
      void aurumBitPortal()
        .services.fetchLogo(created.id)
        .catch(() => undefined)
      setCreatedService(created)
      setTeachAuthMethod(effectiveDefaultAuth)
      setStage('teach')
      await invalidate.services()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const regenerateAutomation = async () => {
    if (!service) return
    setRecipeActionBusy(true)
    setTestMessage(null)
    try {
      await aurumBitPortal().recipes.reset(service.id)
      toast.success('Automação regenerada a partir do cadastro atual.')
      await Promise.all([invalidate.services(), invalidate.audit()])
    } catch (caught) {
      setTestMessage(errorMessage(caught))
    } finally {
      setRecipeActionBusy(false)
    }
  }

  const startReRecord = (): void => {
    if (!service || service.isBuiltin || !service.recipe) return
    setCreatedService(service)
    const defaultAuth = service.authMethods.includes(service.defaultAuth)
      ? service.defaultAuth
      : service.authMethods.includes('password')
        ? 'password'
        : 'certificate'
    setTeachAuthMethod(defaultAuth)
    setTeachClientId('')
    setTeachCredentialId('')
    setWizardId(null)
    setWizardState(null)
    setReviewRemoved([])
    setCancelConfirm(false)
    setStage('teach')
  }

  const toggleAutoSubmit = async (checked: boolean) => {
    if (!service?.recipe) return
    setRecipeActionBusy(true)
    setTestMessage(null)
    try {
      await aurumBitPortal().recipes.save({
        serviceId: service.id,
        definition: { ...service.recipe.definition, autoSubmit: checked },
      })
      toast.success(
        checked
          ? 'Entrar sozinho ativado. O aplicativo clica em Entrar após preencher.'
          : 'Você volta a clicar em Entrar para finalizar o acesso.',
      )
      await Promise.all([invalidate.services(), invalidate.audit()])
    } catch (caught) {
      setAutoSubmit(!checked)
      setTestMessage(errorMessage(caught))
    } finally {
      setRecipeActionBusy(false)
    }
  }

  const testPortal = async () => {
    if (!service) return
    setRecipeActionBusy(true)
    setTestMessage(null)
    try {
      const result = await aurumBitPortal().recipes.test(service.id)
      setTestMessage(result.message)
    } catch (caught) {
      setTestMessage(errorMessage(caught))
    } finally {
      setRecipeActionBusy(false)
    }
  }

  const fetchLogo = async () => {
    if (!service) return
    setRecipeActionBusy(true)
    try {
      await aurumBitPortal().services.fetchLogo(service.id)
      toast.success('Logomarca atualizada.')
      await invalidate.services()
    } catch (caught) {
      setTestMessage(errorMessage(caught))
    } finally {
      setRecipeActionBusy(false)
    }
  }

  const handleOpenChange = (next: boolean): void => {
    if (stage === 'recording' && !next) return // gravação ativa: só Concluir/Cancelar
    if (!next) {
      setStage('form')
      setCreatedService(null)
      setWizardId(null)
      setWizardState(null)
      setWizardBusy(false)
      setReviewRemoved([])
      setCancelConfirm(false)
    }
    onOpenChange(next)
  }

  const stepIndicator =
    stage === 'form'
      ? null
      : stage === 'teach' || stage === 'recording'
        ? 'Etapa 2 de 3'
        : 'Etapa 3 de 3'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {service
              ? 'Editar acesso'
              : stage === 'teach'
                ? 'Novo acesso — Ensinar o robô'
                : stage === 'recording'
                  ? 'Novo acesso — Gravando…'
                  : stage === 'review'
                    ? 'Revise o robô'
                    : stage === 'saved'
                      ? 'Robô salvo'
                      : 'Novo acesso'}
          </DialogTitle>
          <DialogDescription>
            {service
              ? 'Ajuste os dados do acesso. Opções técnicas ficam em “Opções avançadas”.'
              : stage === 'form'
                ? 'Responda duas perguntas e escolha como você entra. Depois, se quiser, você ensina o caminho ao robô.'
                : stage === 'teach'
                  ? `${stepIndicator} · Você mostra uma vez como entrar; o AurumBit repete sozinho nas próximas.`
                  : stage === 'recording'
                    ? `${stepIndicator} · Faça o login normalmente no portal aberto ao lado.`
                    : stage === 'review'
                      ? `${stepIndicator} · Confira o que o robô aprendeu antes de salvar.`
                      : 'Tudo salvo — falta só descobrir se o robô acerta sozinho.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {stage === 'form' ? (
            <>
              <Field label="Nome do site" required>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                  placeholder="Ex.: SEFAZ da minha empresa, Portal da Nota Fiscal…"
                  autoFocus
                />
              </Field>

              <Field label="Endereço do site" required>
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://portal.sefaz.gov.br"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </Field>
              {urlHint ? (
                <p
                  className={cn(
                    '-mt-2 flex items-start gap-1.5 text-xs leading-snug',
                    urlHint.tone === 'good' && 'text-[var(--pv-success)]',
                    urlHint.tone === 'warn' && 'text-[var(--pv-warning)]',
                    urlHint.tone === 'danger' && 'text-[var(--pv-danger)]',
                  )}
                >
                  {isGovernment && urlHint.tone === 'good' ? (
                    <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  {urlHint.text}
                </p>
              ) : null}
              {strippedParams.length > 0 ? (
                <p className="-mt-2 flex items-start gap-1.5 text-xs leading-snug text-[var(--pv-muted)]">
                  <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Removemos do endereço: <strong>{strippedParams.join(', ')}</strong> — esses
                  códigos mudam a cada acesso e invalidariam o portal amanhã.
                </p>
              ) : null}

              <Field label="Como você entra nesse site?" required>
                <div
                  role="radiogroup"
                  aria-label="Como você entra"
                  className="grid gap-2 sm:grid-cols-3"
                >
                  {LOGIN_FLOW_OPTIONS.map((option) => {
                    const selected = loginFlow === option.value
                    const Icon = option.icon
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setLoginFlow(option.value)}
                        className={cn(
                          'pv-pressable flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-3.5 text-center transition-colors',
                          selected
                            ? 'border-brand-600 bg-[var(--pv-accent-soft)] ring-2 ring-brand-500/40'
                            : 'border-[var(--pv-border)] hover:border-brand-300',
                        )}
                      >
                        <Icon
                          className={cn(
                            'h-5 w-5',
                            selected
                              ? 'text-brand-600 dark:text-brand-300'
                              : 'text-[var(--pv-muted)]',
                          )}
                          aria-hidden="true"
                        />
                        <span className="text-sm font-semibold leading-tight">{option.label}</span>
                        <span className="text-[10px] leading-snug text-[var(--pv-muted)]">
                          {option.description}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </Field>

              <p className="flex items-center gap-1.5 rounded-xl bg-[var(--pv-accent-soft)] px-3 py-2 text-[11px] font-medium text-brand-700 dark:text-brand-200">
                <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />A automação é
                configurada sozinha: nada de domínios, slug ou receitas para preencher.
              </p>

              {/* ---------------- Avançado ---------------- */}
              <div className="rounded-2xl border border-[var(--pv-border)]">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((value) => !value)}
                  aria-expanded={advancedOpen}
                  className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--pv-muted)] transition-colors hover:text-[var(--pv-text)]"
                >
                  Opções avançadas
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', advancedOpen && 'rotate-180')}
                    aria-hidden="true"
                  />
                </button>
                {advancedOpen ? (
                  <div className="grid gap-4 border-t border-[var(--pv-border-subtle)] p-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field
                        label="Identificador (slug)"
                        hint="Gerado automaticamente; só mude se souber o que está fazendo"
                      >
                        <Input
                          value={slug}
                          onChange={(event) => setSlug(slugifyServiceName(event.target.value))}
                          placeholder={derived.slug}
                          disabled={Boolean(service?.isBuiltin)}
                        />
                      </Field>
                      <Field label="Categoria">
                        <Select
                          value={effectiveCategory}
                          onChange={(event) => {
                            setCategory(event.target.value as ServiceCategory)
                            setCategoryTouched(true)
                          }}
                        >
                          {SERVICE_CATEGORIES.map((item) => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    </div>
                    <Field
                      label="Domínios permitidos"
                      hint="Um por linha. Deixe vazio para gerenciar automaticamente (recomendado)."
                    >
                      <Textarea
                        value={domains}
                        onChange={(event) => setDomains(event.target.value)}
                        className="min-h-[90px] font-mono text-xs"
                        placeholder={derived.allowedDomains.join('\n') || 'portal.exemplo.gov.br'}
                      />
                    </Field>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Método padrão">
                        <Select
                          value={effectiveDefaultAuth}
                          onChange={(event) => setDefaultAuth(event.target.value as AuthMethod)}
                        >
                          {flowMethods.includes('certificate') ? (
                            <option value="certificate">Certificado</option>
                          ) : null}
                          {flowMethods.includes('password') ? (
                            <option value="password">Senha</option>
                          ) : null}
                        </Select>
                      </Field>
                      <Field label="Notas">
                        <Input value={notes} onChange={(event) => setNotes(event.target.value)} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm">
                      <label className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--pv-border)] p-3 transition-colors hover:border-brand-300">
                        <Checkbox
                          checked={enabled}
                          onCheckedChange={(checked) => setEnabled(checked === true)}
                        />
                        Acesso habilitado
                      </label>
                      <label className="flex flex-1 cursor-pointer items-center gap-2.5 rounded-xl border border-[var(--pv-border)] p-3 transition-colors hover:border-brand-300">
                        <Checkbox
                          checked={favorite}
                          onCheckedChange={(checked) => setFavorite(checked === true)}
                        />
                        Exibir nos favoritos
                      </label>
                    </div>
                    {service ? (
                      <div className="grid gap-2 rounded-xl border border-dashed border-[var(--pv-border)] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--pv-muted)]">
                          Automação deste acesso
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void testPortal()}
                            disabled={recipeActionBusy}
                          >
                            <TestTube2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Testar lado do site
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void regenerateAutomation()}
                            disabled={recipeActionBusy}
                          >
                            <RefreshCw
                              className={cn('h-3.5 w-3.5', recipeActionBusy && 'animate-spin')}
                              aria-hidden="true"
                            />
                            Regenerar automação
                          </Button>
                          {!service.isBuiltin && service.recipe ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={startReRecord}
                              disabled={recipeActionBusy}
                            >
                              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
                              Reconfigurar robô
                            </Button>
                          ) : null}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void fetchLogo()}
                            disabled={recipeActionBusy}
                          >
                            <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
                            Buscar logomarca
                          </Button>
                          {onOpenRecipe ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onOpenRecipe(service)}
                              disabled={recipeActionBusy}
                            >
                              <Braces className="h-3.5 w-3.5" aria-hidden="true" />
                              Editor de receita (JSON)
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-3 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] px-3.5 py-2.5">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">Entrar sozinho</p>
                            <p className="mt-0.5 text-[11px] leading-snug text-[var(--pv-muted)]">
                              Após preencher usuário e senha, o aplicativo clica em Entrar sozinho.
                              Desligado, você clica para finalizar (mais seguro).
                            </p>
                          </div>
                          <Switch
                            id="recipe-auto-submit"
                            checked={autoSubmit}
                            onCheckedChange={(checked) => {
                              const next = checked === true
                              setAutoSubmit(next)
                              void toggleAutoSubmit(next)
                            }}
                            disabled={recipeActionBusy || !service.recipe}
                            aria-label="Entrar sozinho"
                          />
                        </div>
                        {testMessage ? (
                          <p className="text-xs text-[var(--pv-muted)]">{testMessage}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {stage === 'teach' && createdService ? (
            <div className="grid gap-4">
              <div className="flex items-start gap-3 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-accent-soft)] p-4">
                <GraduationCap
                  className="mt-0.5 h-6 w-6 shrink-0 text-brand-600 dark:text-brand-300"
                  aria-hidden="true"
                />
                <div className="text-sm leading-snug">
                  <p className="font-semibold">Quer ensinar o login ao AurumBit?</p>
                  <p className="mt-1 text-[var(--pv-muted)]">
                    Em vez de adivinhar a tela de login, você mostra <strong>uma vez</strong> como
                    entrar — os cliques e campos viram referência à credencial (
                    <strong>nunca gravamos o que você digitou</strong>). Você confere tudo antes de
                    salvar.
                  </p>
                </div>
              </div>

              <Field
                label="Qual cliente usa este acesso?"
                required
                hint="A gravação abre o portal como este cliente"
              >
                <Select
                  value={teachClientId}
                  onChange={(event) => {
                    setTeachClientId(event.target.value)
                    setTeachCredentialId('')
                  }}
                >
                  <option value="">Selecione…</option>
                  {(clientsQuery.data ?? []).map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </Select>
                {(clientsQuery.data ?? []).length === 0 ? (
                  <p className="mt-1.5 text-xs text-[var(--pv-warning)]">
                    Cadastre um cliente primeiro (Clientes → Novo cliente) — a gravação precisa
                    abrir o portal como um cliente.
                  </p>
                ) : null}
              </Field>

              {createdService.authMethods.length > 1 ? (
                <Field label="Qual fluxo você quer ensinar?" required>
                  <div
                    role="radiogroup"
                    aria-label="Qual fluxo ensinar"
                    className="grid grid-cols-2 gap-2"
                  >
                    {[
                      { value: 'password', label: 'Login e senha', icon: KeyRound },
                      { value: 'certificate', label: 'Certificado digital', icon: ShieldCheck },
                    ].map((option) => {
                      const selected = teachAuthMethod === option.value
                      const Icon = option.icon
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => {
                            setTeachAuthMethod(option.value as AuthMethod)
                            setTeachCertificateId('')
                          }}
                          className={cn(
                            'pv-pressable flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
                            selected
                              ? 'border-brand-600 bg-[var(--pv-accent-soft)] ring-2 ring-brand-500/40'
                              : 'border-[var(--pv-border)] hover:border-brand-300',
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </Field>
              ) : null}

              {teachAuthMethod === 'certificate' ? (
                <Field
                  label="Qual certificado você quer usar?"
                  required
                  hint="O portal pedirá o certificado no carregamento — o AurumBit injeta pela impressão digital (A1)"
                >
                  <Select
                    value={teachCertificateId}
                    onChange={(event) => setTeachCertificateId(event.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {usableCertificates.map((certificate) => (
                      <option key={certificate.id} value={certificate.id}>
                        {certificate.label} · vence {String(certificate.validTo ?? '').slice(0, 10)}
                      </option>
                    ))}
                  </Select>
                  {usableCertificates.length === 0 ? (
                    <p className="mt-1.5 text-xs text-[var(--pv-warning)]">
                      Nenhuma A1 válida instalada para este cliente — instale/vincule uma primeiro
                      (Clientes → Certificados) e volte aqui.
                    </p>
                  ) : null}
                </Field>
              ) : null}

              {teachAuthMethod === 'password' ? (
                <>
                  <Field
                    label="Qual credencial vincular? (opcional)"
                    hint="Vazio = placeholders; vincule depois em Editar → Credenciais"
                  >
                    <Select
                      value={teachCredentialId}
                      onChange={(event) => setTeachCredentialId(event.target.value)}
                    >
                      <option value="">Nenhuma — vincular depois</option>
                      {(credentialsQuery.data ?? []).map((credential) => (
                        <option key={credential.id} value={credential.id}>
                          {credential.username}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {teachClientId && (credentialsQuery.data ?? []).length === 0 ? (
                    <p className="-mt-2 flex items-start gap-1.5 text-xs leading-snug text-[var(--pv-warning)]">
                      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Nenhuma credencial cadastrada ainda — a gravação segue mesmo assim; depois
                      vincule uma credencial a este acesso.
                    </p>
                  ) : null}
                </>
              ) : null}

              <p className="flex items-start gap-1.5 rounded-xl bg-[var(--pv-accent-soft)] px-3 py-2 text-[11px] leading-snug text-brand-700 dark:text-brand-200">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Durante a gravação, digite como você digita hoje e resolva captcha/2FA na mão — o
                robô não aprende (nem precisa) a driblar desafios. Não use o preenchimento
                automático do Chrome.
              </p>
            </div>
          ) : null}

          {stage === 'recording' && wizardState ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-[var(--pv-danger)]/40 bg-[var(--pv-danger)]/5 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--pv-danger)]">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
                  </span>
                  Gravando — faça o login no portal aberto
                </p>
                <p className="mt-2 text-xs text-[var(--pv-muted)]">
                  Tela T{wizardState.screenCount} · <strong>{wizardState.stepCount}</strong> etapas
                  gravadas
                  {wizardState.gaps > 0
                    ? ` · ${wizardState.gaps} evento(s) perdido(s) por navegação`
                    : ''}
                </p>
              </div>
              {wizardState.loggedInHint ? (
                <p className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Parece que você entrou ✓ — ao chegar na área logada, clique em “Concluir
                  gravação”.
                </p>
              ) : null}
              {wizardState.durationWarning ? (
                <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />A gravação
                  será encerrada em 5 min. O que foi capturado será salvo como rascunho — nada se
                  perde.
                </p>
              ) : null}
              {wizardState.warnings.length > 0 ? (
                <div className="grid gap-2">
                  {wizardState.warnings.map((warning, index) => (
                    <WarningBanner key={`${warning.code}-${index}`} warning={warning} />
                  ))}
                </div>
              ) : null}
              {wizardState.status === 'error' ? (
                <p className="flex items-start gap-2 rounded-xl border border-[var(--pv-danger)]/40 bg-[var(--pv-danger)]/10 px-3 py-2 text-xs font-medium text-[var(--pv-danger)]">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />A
                  gravação não pôde ser compilada. Descarte e regrave — nada será salvo.
                </p>
              ) : null}
              {cancelConfirm ? (
                <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 text-xs">
                  <p className="font-semibold">Descartar a gravação?</p>
                  <p className="mt-1 text-[var(--pv-muted)]">
                    Nada será salvo. O acesso mantém a automação automática.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setCancelConfirm(false)}>
                      Voltar
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void cancelRecording()}
                      disabled={wizardBusy}
                    >
                      Descartar
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {stage === 'review' && wizardState?.definition ? (
            <div className="grid gap-3">
              {wizardState.warnings.map((warning, index) => (
                <WarningBanner key={`${warning.code}-${index}`} warning={warning} />
              ))}
              <ol className="grid max-h-[300px] gap-1.5 overflow-y-auto pv-scroll">
                {wizardState.definition.steps.map((step, index) => {
                  if (reviewRemoved.includes(index)) return null
                  const Icon = STEP_GLYPHS[step.action] ?? MousePointerClick
                  return (
                    <li
                      key={index}
                      className="flex items-center gap-2.5 rounded-xl border border-[var(--pv-border)] px-3 py-2"
                    >
                      <Icon
                        className="h-4 w-4 shrink-0 text-[var(--pv-muted)]"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {step.label ?? step.action}
                          {step.action === 'fill' && step.value === '' ? ' (opcional)' : ''}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-[var(--pv-muted)]">
                          {step.action}
                          {step.screen ? ` · ${step.screen}` : ''}
                        </p>
                      </div>
                      <ConfidenceChip confidence={step.confidence} />
                      <button
                        type="button"
                        aria-label="Remover etapa"
                        onClick={() => setReviewRemoved((current) => [...current, index])}
                        className="rounded-lg p-1.5 text-[var(--pv-muted)] transition-colors hover:bg-[var(--pv-panel)] hover:text-[var(--pv-danger)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ol>
              {reviewRemoved.length > 0 ? (
                <p className="text-[11px] text-[var(--pv-muted)]">
                  {reviewRemoved.length} etapa(s) removida(s).{' '}
                  <button type="button" className="underline" onClick={() => setReviewRemoved([])}>
                    Desfazer
                  </button>
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel)] px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight">Entrar sozinho</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--pv-muted)]">
                    Após preencher, o aplicativo clica em Entrar sozinho. Desligado, você clica para
                    finalizar.
                  </p>
                </div>
                <Switch
                  checked={reviewAutoSubmit}
                  onCheckedChange={(checked) => setReviewAutoSubmit(checked === true)}
                  aria-label="Entrar sozinho"
                />
              </div>
              <details className="rounded-xl border border-[var(--pv-border)] p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-[var(--pv-muted)]">
                  Ver como JSON
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto pv-scroll rounded-lg bg-[var(--pv-bg)] p-2 text-[10px] leading-snug">
                  {JSON.stringify(wizardState.definition, null, 2)}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(JSON.stringify(wizardState.definition, null, 2))
                      .then(() => toast.success('JSON copiado.'))
                      .catch(() => undefined)
                  }
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copiar JSON
                </Button>
              </details>
            </div>
          ) : null}

          {stage === 'saved' && createdService ? (
            <div className="grid gap-4">
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4">
                <BadgeCheck
                  className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <div className="text-sm leading-snug">
                  <p className="font-semibold">Robô salvo para este acesso.</p>
                  <p className="mt-1 text-[var(--pv-muted)]">
                    A gravação ensinou o caminho — mas ainda não testamos se o robô acerta sozinho.
                    Em uns 20 segundos dá para descobrir (o teste abre o portal com a credencial e o
                    app detecta se entrou).
                  </p>
                </div>
              </div>
              {teachAuthMethod === 'password' &&
              !teachCredentialId &&
              (credentialsQuery.data ?? []).length === 0 ? (
                <p className="flex items-start gap-1.5 text-xs leading-snug text-[var(--pv-warning)]">
                  <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Para testar, o acesso precisa de uma credencial — vincule uma em Editar →
                  Credenciais e abra o acesso depois.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {stage === 'form' ? (
            <>
              <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={busy || !name.trim() || !normalizedUrl}
              >
                {busy ? 'Salvando…' : service ? 'Salvar alterações' : 'Salvar e continuar →'}
              </Button>
            </>
          ) : null}
          {stage === 'teach' ? (
            <>
              <Button variant="secondary" onClick={skipTeach} disabled={wizardBusy}>
                Pular por agora
              </Button>
              <Button
                onClick={() => void startRecording()}
                disabled={
                  wizardBusy ||
                  !teachClientId ||
                  (teachAuthMethod === 'certificate' && !teachCertificateId)
                }
              >
                {wizardBusy ? 'Abrindo o portal…' : 'Ensinar agora'}
              </Button>
            </>
          ) : null}
          {stage === 'recording' ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setCancelConfirm(true)}
                disabled={wizardBusy}
              >
                Cancelar e descartar
              </Button>
              <Button
                onClick={() => void finishRecording()}
                disabled={wizardBusy || wizardState?.status === 'error'}
              >
                {wizardBusy ? 'Concluindo…' : 'Concluir gravação'}
              </Button>
            </>
          ) : null}
          {stage === 'saved' ? (
            <>
              <Button variant="secondary" onClick={verifyRobotLater} disabled={wizardBusy}>
                Testar depois
              </Button>
              <Button
                onClick={() => void verifyRobotTest()}
                disabled={
                  wizardBusy ||
                  (teachAuthMethod === 'password' &&
                    !teachCredentialId &&
                    (credentialsQuery.data ?? []).length === 0)
                }
              >
                Testar agora
              </Button>
            </>
          ) : null}
          {stage === 'review' ? (
            <>
              <Button variant="secondary" onClick={() => void reRecord()} disabled={wizardBusy}>
                Regravar
              </Button>
              <Button
                variant="secondary"
                onClick={() => void discardRecorded()}
                disabled={wizardBusy}
              >
                Descartar
              </Button>
              <Button onClick={() => void saveRecorded()} disabled={wizardBusy}>
                {wizardBusy ? 'Salvando…' : 'Salvar robô'}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
