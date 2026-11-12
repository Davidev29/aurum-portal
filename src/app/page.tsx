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
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
} from 'lucide-react'
import type { Service } from '@shared/types'
import { SERVICE_CATEGORIES } from '@shared/constants'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useCertificates, useInvalidate, useServices, useSessions } from '@/lib/queries'
import { cn, initials } from '@/lib/utils'
import { AppShell } from '@/components/app-shell'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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

export default function StorePage() {
  const router = useRouter()
  const invalidate = useInvalidate()
  const editParam = useSearchParam('serviceId')
  const { data: services, isLoading } = useServices()
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
  React.useEffect(() => {
    if (!editParam || !services) return
    const match = services.find((service) => service.id === editParam)
    if (match) {
      setEditingService(match)
      setServiceFormOpen(true)
    }
  }, [editParam, services])

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
      toast.success(`Serviço duplicado como "${copy.name}".`)
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
      toast.success('Serviço excluído. Credenciais e sessões associadas não foram apagadas.')
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
      toast.success('Serviços nativos restaurados.')
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
        title="Store de serviços"
        description="Abra portais com o cliente correto, certificado explícito e sessão isolada. Adicione novos sites em segundos."
        eyebrow="Visão geral"
        icon={<LayoutGrid className="h-5 w-5" />}
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
              Novo site
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Serviços disponíveis"
          value={services?.length ?? 0}
          icon={<LayoutGrid className="h-5 w-5" />}
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
            <Link href="/certificates" className="font-semibold underline underline-offset-4">
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
                onClick={() => void aurumBitPortal().sessions.focus(session.id)}
                className="pv-lift flex min-w-[268px] items-center gap-3 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] px-3.5 py-3 text-left shadow-[var(--pv-shadow)] hover:border-brand-300"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--pv-accent-solid)] text-xs font-bold text-[var(--pv-on-accent)]">
                  {initials(session.clientName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{session.clientName}</div>
                  <div className="truncate text-xs text-[var(--pv-muted)]">
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
        <div className="relative min-w-[240px] flex-1">
          <Search
            className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-muted)]"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar serviço, categoria ou URL"
            className="pl-10"
            aria-label="Buscar serviços"
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
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-6 w-6" />}
          title="Nenhum serviço encontrado"
          description={
            services && services.length === 0
              ? 'Adicione um site ou restaure os serviços nativos do catálogo oficial.'
              : 'Ajuste a busca, a categoria ou os favoritos.'
          }
          action={
            <>
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" />
                Adicionar site
              </Button>
              <Button variant="secondary" onClick={() => void restoreBuiltins()}>
                <RefreshCw className="h-4 w-4" />
                Restaurar nativos
              </Button>
            </>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 pv-stagger">
          {filtered.map((service) => (
            <ServiceCard
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
        title="Excluir serviço?"
        description={
          <>
            O serviço <strong>{deleting?.name}</strong> será removido da store. Credenciais e
            eventos de auditoria já registrados são preservados; sessões abertas continuam até serem
            fechadas.
          </>
        }
        confirmLabel="Excluir serviço"
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

function ServiceCard({
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
    <Card
      className={cn(
        'pv-service-card group relative flex flex-col overflow-hidden',
        !service.enabled && 'opacity-60 saturate-50',
      )}
    >
      {/* Cabeçalho: logomarca + nome + favorito */}
      <div className="flex items-start gap-3.5 px-4 pb-3 pt-4">
        <div
          className={cn(
            'pv-service-logo flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl ring-1',
            logoSrc
              ? 'bg-white p-1.5 shadow-[var(--pv-shadow-sm)] ring-[var(--pv-border-subtle)]'
              : 'bg-gradient-to-br from-brand-600 via-brand-700 to-brand-800 text-sm font-bold tracking-wide text-brand-50 ring-brand-800/30 shadow-md',
          )}
        >
          {logoSrc ? (
            <img
              src={logoSrc}
              alt=""
              className="h-full w-full object-contain"
              loading="lazy"
              draggable={false}
            />
          ) : (
            initials(service.name)
          )}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3
              className="min-w-0 truncate text-[15px] font-semibold leading-snug tracking-tight"
              title={service.name}
            >
              {service.name}
            </h3>
            {service.openSessions > 0 ? (
              <span
                className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-[var(--pv-success-border)] bg-[var(--pv-success-soft)] px-2 text-[10px] font-bold leading-none text-[var(--pv-success)]"
                title={`${service.openSessions} sessão(ões) aberta(s)`}
              >
                <span className="pv-live-dot h-1.5 w-1.5 rounded-full bg-[var(--pv-success)]" />
                {service.openSessions}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-[11px] font-medium leading-none text-[var(--pv-faint)]">
            {service.category}
          </p>
        </div>
        <button
          type="button"
          onClick={handleFavorite}
          aria-label={service.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          aria-pressed={service.favorite}
          className="pv-icon-btn -mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--pv-faint)] hover:bg-[var(--pv-warning-soft)] hover:text-[var(--pv-warning)]"
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
      </div>

      {/* Metadados: método de autenticação e identidade */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
        <AuthMethodBadges methods={service.authMethods} />
        {govBr ? (
          <span
            className="pv-gov-chip"
            title="Serviço derivado do ecossistema GOV.BR — autentica pelo login único"
          >
            <Landmark className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
            gov.br
          </span>
        ) : null}
        {!service.enabled ? <Badge variant="danger">Desabilitado</Badge> : null}
        {service.isBuiltin ? <Badge variant="outline">Nativo</Badge> : null}
        <Badge variant={service.recipe ? 'secondary' : 'outline'}>
          {service.recipe ? 'Automação ativa' : 'Sem automação'}
        </Badge>
        {service.recipe?.status === 'broken' ? (
          <Badge variant="warning">Automação com falha</Badge>
        ) : null}
        <div className="ml-auto inline-flex items-center gap-1.5">
          <Switch
            id={`service-enabled-${service.id}`}
            checked={service.enabled}
            onCheckedChange={(checked) => onToggleEnabled(checked === true)}
            aria-label={`${service.enabled ? 'Desativar' : 'Ativar'} serviço ${service.name}`}
          />
          <label
            htmlFor={`service-enabled-${service.id}`}
            className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wide text-[var(--pv-faint)]"
          >
            {service.enabled ? 'Ativo' : 'Inativo'}
          </label>
        </div>
      </div>

      {/* Rodapé de ações */}
      <div className="mt-auto flex items-center gap-2 border-t border-[var(--pv-border-subtle)] bg-[color-mix(in_srgb,var(--pv-panel-2)_45%,transparent)] px-4 py-2.5">
        <Button
          onClick={onOpen}
          disabled={!service.enabled}
          className="h-10 flex-1 rounded-xl text-[13px]"
        >
          <Sparkles className="h-4 w-4" />
          Abrir portal
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={onEdit}
          title="Editar serviço"
          aria-label="Editar serviço"
          className="h-10 w-10 rounded-xl"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              size="icon"
              title="Mais ações"
              aria-label="Mais ações"
              className="h-10 w-10 rounded-xl"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent sideOffset={8}>
            <DropdownMenuLabel>Ações do serviço</DropdownMenuLabel>
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
              Duplicar serviço
            </DropdownMenuItem>
            {!service.isBuiltin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="danger" onSelect={onDelete}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Excluir serviço
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
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
