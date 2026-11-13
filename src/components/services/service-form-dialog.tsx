'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  Braces,
  ChevronDown,
  Globe,
  ImagePlus,
  KeyRound,
  Landmark,
  Layers,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TestTube2,
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
import type { Service, ServiceInput } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useInvalidate } from '@/lib/queries'
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
      } else {
        const created = await aurumBitPortal().services.create(input)
        toast.success('Site adicionado. A automação de login foi configurada automaticamente.')
        // Logomarca por baixo dos panos; falha aqui não é erro do cadastro.
        void aurumBitPortal()
          .services.fetchLogo(created.id)
          .catch(() => undefined)
      }
      await Promise.all([invalidate.services(), invalidate.audit()])
      onOpenChange(false)
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{service ? 'Editar acesso' : 'Novo acesso'}</DialogTitle>
          <DialogDescription>
            {service
              ? 'Ajuste os dados do acesso. Opções técnicas ficam em “Opções avançadas”.'
              : 'Responda duas perguntas e escolha como você entra. A automação do login é configurada sozinha — nada técnico para preencher.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
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
              Removemos do endereço: <strong>{strippedParams.join(', ')}</strong> — esses códigos
              mudam a cada acesso e invalidariam o portal amanhã.
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
                        selected ? 'text-brand-600 dark:text-brand-300' : 'text-[var(--pv-muted)]',
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

          {error ? (
            <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim() || !normalizedUrl}>
            {busy ? 'Salvando…' : service ? 'Salvar alterações' : 'Adicionar site'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
