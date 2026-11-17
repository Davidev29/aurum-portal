'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Copy,
  ExternalLink,
  Globe2,
  MoreVertical,
  ImagePlus,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
  Vault,
} from 'lucide-react'
import type { Service } from '@shared/types'
import { SERVICE_CATEGORIES } from '@shared/constants'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useCertificates, useInvalidate, useServices, useSessions } from '@/lib/queries'
import { cn, initials } from '@/lib/utils'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert } from '@/components/ui/alert'
import { AuthMethodBadges, SessionStatusBadge } from '@/components/status-badges'
import { LaunchDialog } from '@/components/sessions/launch-dialog'
import { ServiceFormDialog } from '@/components/services/service-form-dialog'
import { RecipeDialog } from '@/components/services/recipe-dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Switch } from '@/components/ui/switch'
import { SkeletonGrid, StatCard, Toolbar } from '@/components/ui/primitives'
import { useSearchParam } from '@/lib/hooks'

const GOV_BR_LOGO = '/portals/gov-br.png'

/**
 * Detecta serviços derivados do ecossistema GOV.BR (SSO do login único ou
 * domínios oficiais gov.br). Usado para exibir a logomarca do GOV.BR quando
 * o serviço não tem logomarca própria, e o chip de identidade no card.
 */
function isGovBrDerived(service: Service): boolean {
  return service.allowedDomains.some((raw) => {
    const domain = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/^\*\./, '')
    return (
      domain === 'gov.br' ||
      domain === 'www.gov.br' ||
      domain === 'portal.gov.br' ||
      domain === 'acesso.gov.br' ||
      domain.endsWith('.acesso.gov.br') ||
      domain === 'sistema.gov.br' ||
      domain.endsWith('.sistema.gov.br')
    )
  })
}

export default function AcessosPage() {
  const router = useRouter()
  const invalidate = useInvalidate()
  const editParam = useSearchParam('serviceId')
  const servicesQuery = useServices()
  const { data: services, isLoading } = servicesQuery
  const servicesError = servicesQuery.error
  const { data: sessions } = useSessions()
  const { data: certificates } = useCertificates()
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<string>('all')
  const [onlyFavorites, setOnlyFavorites] = React.useState(false)
  const [launchService, setLaunchService] = React.useState<Service | null>(null)
  const [editingService, setEditingService] = React.useState<Service | null>(null)
  const [serviceFormOpen, setServiceFormOpen] = React.useState(false)
  const [recipeService, setRecipeService] = React.useState<Service | null>(null)
  const [deleting, setDeleting] = React.useState<Service | null>(null)
  const [restoring, setRestoring] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  // Edição via deep-link ?serviceId= (compatibilidade com links antigos).
  // O param é consumido-e-limpo da URL: sem isso, qualquer refetch dos
  // serviços reabriria o diálogo depois que o usuário o fechou.
  const handledEditParam = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!editParam || !services) return
    if (handledEditParam.current === editParam) return
    const match = services.find((service) => service.id === editParam)
    if (match) {
      handledEditParam.current = editParam
      setEditingService(match)
      setServiceFormOpen(true)
      router.replace('/', { scroll: false })
    }
  }, [editParam, services, router])

  const expiring = (certificates ?? []).filter(
    (certificate) => certificate.status === 'expiring' || certificate.status === 'expired',
  )

  const filtered = (services ?? []).filter((service) => {
    if (onlyFavorites && !service.favorite) return false
    if (category !== 'all' && service.category !== category) return false
    const search = query.trim().toLowerCase()
    if (!search) return true
    return [service.name, service.category, service.baseUrl]
      .join(' ')
      .toLowerCase()
      .includes(search)
  })

  const toggleFavorite = async (service: Service) => {
    try {
      await aurumBitPortal().services.update(service.id, { favorite: !service.favorite })
      await invalidate.services()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const openNew = () => {
    setEditingService(null)
    setServiceFormOpen(true)
  }

  const update = async (service: Service, patch: Partial<Service>) => {
    try {
      await aurumBitPortal().services.update(service.id, patch)
      await invalidate.services()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const duplicate = async (service: Service) => {
    try {
      const copy = await aurumBitPortal().services.duplicate(service.id)
      toast.success(`Acesso duplicado como "${copy.name}".`)
      await Promise.all([invalidate.services(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const fetchLogo = async (service: Service) => {
    try {
      await aurumBitPortal().services.fetchLogo(service.id)
      toast.success('Favicon carregado do dominio permitido.')
      await invalidate.services()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const uploadLogo = async (service: Service) => {
    try {
      await aurumBitPortal().services.uploadLogo(service.id)
      toast.success('Logomarca atualizada.')
      await invalidate.services()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await aurumBitPortal().services.delete(deleting.id)
      toast.success('Acesso excluído. Credenciais e sessões associadas não foram apagadas.')
      await Promise.all([invalidate.services(), invalidate.audit()])
      setDeleting(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const restoreBuiltins = async () => {
    setRestoring(true)
    try {
      await aurumBitPortal().services.restoreBuiltins()
      toast.success('Acessos nativos restaurados.')
      await Promise.all([invalidate.services(), invalidate.audit()])
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Acessos"
        description="Abra os portais com o cliente correto, certificado explícito e sessão isolada. Adicione novos acessos em segundos."
        eyebrow="Visão geral"
        icon={<Vault className="h-5 w-5" />}
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push('/certificates?import=1')}>
              <ShieldCheck className="h-4 w-4" />
              Importar certificado
            </Button>
            <Button variant="secondary" onClick={() => void restoreBuiltins()} disabled={restoring}>
              <RefreshCw className={cn('h-4 w-4', restoring && 'animate-spin')} />
              Restaurar nativos
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" />
              Novo acesso
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Acessos disponíveis"
          value={services?.length ?? 0}
          icon={<Vault className="h-5 w-5" />}
        />
        <StatCard
          label="Sessões abertas"
          value={sessions?.length ?? 0}
          icon={<Sparkles className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="Certificados no cofre"
          value={certificates?.length ?? 0}
          icon={<ShieldCheck className="h-5 w-5" />}
          tone={expiring.length > 0 ? 'warning' : 'teal'}
          hint={expiring.length > 0 ? `${expiring.length} a vencer/vencido(s)` : undefined}
        />
      </div>

      {expiring.length > 0 ? (
        <Alert
          variant="warning"
          className="mb-5"
          action={
            <Link
              href="/certificates"
              className="font-semibold underline-offset-4 transition-colors hover:underline"
            >
              Revisar certificados
            </Link>
          }
        >
          {expiring.length} certificado(s) vencido(s) ou próximo(s) do vencimento. Certificados
          vencidos não autenticam.
        </Alert>
      ) : null}

      {sessions && sessions.length > 0 ? (
        <div className="mb-6">
          <div className="mb-2.5 flex items-center justify-between">
            <h2 className="pv-eyebrow">Sessões abertas</h2>
            <Link
              href="/sessions"
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300"
            >
              Gerenciar sessões
            </Link>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-2 pv-scroll">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() =>
                  void aurumBitPortal()
                    .sessions.focus(session.id)
                    .catch((error) => toast.error(errorMessage(error)))
                }
                className="pv-lift flex min-w-[268px] items-center gap-3 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] px-3.5 py-3 text-left shadow-[var(--pv-shadow)] hover:border-brand-300"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--pv-accent-solid)] text-xs font-bold text-[var(--pv-on-accent)]">
                  {initials(session.clientName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold" title={session.clientName}>
                    {session.clientName}
                  </div>
                  <div
                    className="truncate text-xs text-[var(--pv-muted)]"
                    title={session.serviceName}
                  >
                    {session.serviceName}
                  </div>
                </div>
                <SessionStatusBadge status={session.status} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Toolbar>
        <div className="relative min-w-0 flex-1 basis-full sm:basis-auto">
          <Search
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar acesso, categoria ou URL…"
            className="pl-10"
            aria-label="Buscar acessos"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
            Todos
          </FilterChip>
          {SERVICE_CATEGORIES.map((item) => (
            <FilterChip key={item} active={category === item} onClick={() => setCategory(item)}>
              {item}
            </FilterChip>
          ))}
          <FilterChip
            active={onlyFavorites}
            onClick={() => setOnlyFavorites((value) => !value)}
            ariaPressed={onlyFavorites}
          >
            <Star className={cn('h-4 w-4', onlyFavorites && 'fill-current')} aria-hidden="true" />
            Favoritos
          </FilterChip>
        </div>
      </Toolbar>

      {isLoading ? (
        <SkeletonGrid count={6} />
      ) : servicesError ? (
        <Alert
          variant="danger"
          action={
            <Button variant="secondary" size="sm" onClick={() => void servicesQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
          }
        >
          Não foi possível carregar os acessos: {errorMessage(servicesError)}
        </Alert>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Vault className="h-6 w-6" />}
          title="Nenhum acesso encontrado"
          description={
            services && services.length === 0
              ? 'Adicione um acesso ou restaure os acessos nativos do catálogo oficial.'
              : 'Ajuste a busca, a categoria ou os favoritos.'
          }
          action={
            <>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                Adicionar acesso
              </Button>
              <Button variant="secondary" onClick={() => void restoreBuiltins()}>
                <RefreshCw className="h-4 w-4" />
                Restaurar nativos
              </Button>
            </>
          }
        />
      ) : (
        <>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="pv-eyebrow">Seus acessos</h2>
            <span className="text-[11px] font-medium tabular-nums text-[var(--pv-faint)]">
              {filtered.length === (services?.length ?? 0)
                ? `${filtered.length} no catálogo`
                : `${filtered.length} de ${services?.length ?? 0}`}
            </span>
          </div>
          <div className="@container">
            <div className="grid gap-5 grid-cols-1 @min-[600px]:grid-cols-2 @min-[1080px]:grid-cols-3 pv-stagger">
              {filtered.map((service) => (
                <AccessCard
                  key={service.id}
                  service={service}
                  onOpen={() => setLaunchService(service)}
                  onEdit={() => {
                    setEditingService(service)
                    setServiceFormOpen(true)
                  }}
                  onFavorite={() => void toggleFavorite(service)}
                  onFetchLogo={() => void fetchLogo(service)}
                  onUploadLogo={() => void uploadLogo(service)}
                  onDuplicate={() => void duplicate(service)}
                  onDelete={() => setDeleting(service)}
                  onToggleEnabled={(enabled) => void update(service, { enabled })}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <QuickCard
          icon={<Users className="h-5 w-5" />}
          title="Clientes"
          description="Cadastre titulares PF/PJ, documentos, tags e consentimento LGPD."
          href="/clients"
        />
        <QuickCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Certificados A1"
          description="Importação individual, em lote e do repositório do Windows, com diagnóstico mTLS."
          href="/certificates"
        />
      </div>

      <LaunchDialog
        open={Boolean(launchService)}
        onOpenChange={(open) => {
          if (!open) setLaunchService(null)
        }}
        service={launchService}
      />
      <ServiceFormDialog
        open={serviceFormOpen}
        onOpenChange={(open) => {
          setServiceFormOpen(open)
          if (!open) setEditingService(null)
        }}
        service={editingService}
        onOpenRecipe={(target) => {
          setServiceFormOpen(false)
          setRecipeService(target)
        }}
      />
      <RecipeDialog
        service={recipeService}
        onOpenChange={(open) => {
          if (!open) setRecipeService(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Excluir acesso?"
        description={
          <>
            O acesso <strong>{deleting?.name}</strong> será removido dos seus acessos. Credenciais e
            eventos de auditoria já registrados são preservados; sessões abertas continuam até serem
            fechadas.
          </>
        }
        confirmLabel="Excluir acesso"
        busy={busy}
        onConfirm={() => void remove()}
      />
    </AppShell>
  )
}

function FilterChip({
  active,
  onClick,
  children,
  ariaPressed,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  ariaPressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed ?? active}
      className={cn(
        'pv-pressable inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold',
        active
          ? 'border-[var(--pv-accent-solid)] bg-[var(--pv-accent-solid)] text-[var(--pv-on-accent)] shadow-md'
          : 'border-[var(--pv-border-strong)] text-[var(--pv-muted)] hover:border-brand-300 hover:text-[var(--pv-text)]',
      )}
    >
      {children}
    </button>
  )
}

function AccessCard({
  service,
  onOpen,
  onEdit,
  onFavorite,
  onFetchLogo,
  onUploadLogo,
  onDuplicate,
  onDelete,
  onToggleEnabled,
}: {
  service: Service
  onOpen: () => void
  onEdit: () => void
  onFavorite: () => void
  onFetchLogo: () => void
  onUploadLogo: () => void
  onDuplicate: () => void
  onDelete: () => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const [starPop, setStarPop] = React.useState(false)
  const govBr = isGovBrDerived(service)
  const logoSrc = service.logoUrl ?? (govBr ? GOV_BR_LOGO : null)

  React.useEffect(() => {
    if (!starPop) return
    const timer = window.setTimeout(() => setStarPop(false), 460)
    return () => window.clearTimeout(timer)
  }, [starPop])

  const handleFavorite = () => {
    if (!service.favorite) setStarPop(true)
    onFavorite()
  }

  return (
    <div
      className={cn(
        'pv-access-card group relative flex min-h-[236px] flex-col overflow-hidden rounded-[var(--pv-radius)]',
        !service.enabled && 'opacity-60 saturate-50',
      )}
    >
      {/* Cabeçalho: logomarca em destaque + nome */}
      <div className="flex items-start gap-4 px-5 pb-3 pt-5">
        <div
          className={cn(
            'pv-access-logo flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[18px]',
            logoSrc
              ? 'bg-white p-2 shadow-[var(--pv-shadow-sm)] ring-1 ring-black/5 dark:ring-white/10'
              : 'bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-base font-bold tracking-wide text-brand-50 ring-1 ring-brand-800/30 shadow-md',
          )}
        >
          {logoSrc ? (
            <img src={logoSrc} alt="" className="h-full w-full object-contain" draggable={false} />
          ) : (
            initials(service.name)
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5 pr-8">
          <h3
            className="min-w-0 text-[16px] font-medium leading-snug tracking-[0.01em] text-[var(--pv-access-ink)] line-clamp-2"
            title={service.name}
          >
            {service.name}
          </h3>
          <p className="mt-1.5 truncate text-[10px] font-medium uppercase leading-none tracking-[0.14em] text-[var(--pv-access-ink-2)]">
            {service.category}
          </p>
        </div>
      </div>

      {/* Favorito — estrela flutuante no canto superior direito */}
      <button
        type="button"
        onClick={handleFavorite}
        aria-label={service.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
        aria-pressed={service.favorite}
        className="absolute right-2.5 top-2.5 flex h-10 w-10 items-center justify-center rounded-full text-[var(--pv-access-ink-2)] transition-colors hover:bg-black/5 hover:text-[var(--pv-warning)] focus-visible:ring-2 focus-visible:ring-[var(--pv-accent-solid)] dark:hover:bg-white/5"
      >
        <Star
          key={String(service.favorite)}
          className={cn(
            'h-5 w-5 transition-colors duration-200',
            service.favorite && 'fill-amber-400 text-amber-500',
            starPop && service.favorite && 'pv-star-pop',
          )}
          aria-hidden="true"
        />
      </button>

      {/* Metadados — linha 1: badges (sessões, auth, identidade, estados) */}
      <div className="flex min-h-[26px] flex-wrap items-center gap-1.5 px-5">
        {service.openSessions > 0 ? (
          <span
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-[var(--pv-success-border)] bg-[var(--pv-success-soft)] px-2.5 text-[10px] font-bold leading-none text-[var(--pv-success)]"
            title={`${service.openSessions} sessão(ões) aberta(s) neste acesso`}
          >
            <span className="pv-live-dot h-1.5 w-1.5 rounded-full bg-[var(--pv-success)]" />
            {service.openSessions} sess{service.openSessions === 1 ? 'ão' : 'ões'}
          </span>
        ) : null}
        <AuthMethodBadges methods={service.authMethods} />
        {govBr ? (
          <span
            className="pv-gov-chip"
            title="Acesso derivado do ecossistema GOV.BR — autentica pelo login único"
          >
            <Landmark className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            gov.br
          </span>
        ) : null}
        {!service.enabled ? <Badge variant="danger">Desabilitado</Badge> : null}
        {service.recipe?.status === 'broken' ? (
          <Badge variant="warning">Automação com falha</Badge>
        ) : null}
      </div>
      {/* Metadados — linha 2: origem/automação (texto quiet) + toggle à direita */}
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-1.5">
        <span className="min-w-0 truncate text-[11px] font-medium leading-none text-[var(--pv-access-ink-2)]">
          {service.isBuiltin ? 'Nativo' : 'Personalizado'}
          {' · '}
          {service.recipe
            ? service.recipe.status === 'broken'
              ? 'automação com falha'
              : 'automação ativa'
            : 'sem automação'}
        </span>
        <div className="inline-flex shrink-0 items-center gap-1.5">
          <Switch
            id={`service-enabled-${service.id}`}
            checked={service.enabled}
            onCheckedChange={(checked) => onToggleEnabled(checked === true)}
            aria-label={`${service.enabled ? 'Desativar' : 'Ativar'} acesso ${service.name}`}
          />
          <label
            htmlFor={`service-enabled-${service.id}`}
            className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wide text-[var(--pv-access-ink-2)]"
          >
            {service.enabled ? 'Ativo' : 'Inativo'}
          </label>
        </div>
      </div>

      {/* Rodapé de ações: uma sólida (índigo), demais translúcidas */}
      <div
        className="mt-auto flex items-center gap-2 border-t px-4 py-3"
        style={{
          borderColor: 'var(--pv-access-divider)',
          background: 'color-mix(in srgb, var(--pv-access-ink) 4%, transparent)',
        }}
      >
        <Button
          onClick={onOpen}
          disabled={!service.enabled}
          className="h-10 flex-1 rounded-[32px] text-[13px] font-medium"
        >
          <Sparkles className="h-4 w-4" />
          Abrir portal
        </Button>
        <Button
          variant="soft"
          size="icon"
          onClick={onEdit}
          title="Editar acesso"
          aria-label="Editar acesso"
          className="h-10 w-10 rounded-full"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="soft"
              size="icon"
              title="Mais ações"
              aria-label="Mais ações"
              className="h-10 w-10 rounded-full"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent sideOffset={8}>
            <DropdownMenuLabel>Ações do acesso</DropdownMenuLabel>
            <DropdownMenuItem onSelect={onFetchLogo}>
              <Globe2 className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
              Carregar favicon do domínio
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onUploadLogo}>
              <ImagePlus className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
              Enviar logomarca
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
              Duplicar acesso
            </DropdownMenuItem>
            {!service.isBuiltin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Excluir acesso
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function QuickCard({
  icon,
  title,
  description,
  href,
}: {
  icon: React.ReactNode
  title: string
  description: string
  href: string
}) {
  return (
    <Link
      href={href}
      className="pv-lift group flex items-start gap-3.5 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-5 shadow-[var(--pv-shadow)] hover:border-brand-300"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--pv-accent-soft)] text-brand-600 ring-1 ring-brand-100 dark:text-brand-300 dark:ring-brand-500/20">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
          {title}
          <ExternalLink
            className="h-3.5 w-3.5 text-[var(--pv-muted)] opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--pv-muted)]">{description}</p>
      </div>
    </Link>
  )
}
