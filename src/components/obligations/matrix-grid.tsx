'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  ExternalLink,
  ListChecks,
  Search,
  X,
} from 'lucide-react'
import type { Client, ClientObligation, Obligation } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import {
  useClientObligationLinks,
  useObligationGroups,
  useObligations,
  useDepartments,
  useObligationsInvalidate,
} from '@/lib/obligations-queries'
import { useClients } from '@/lib/queries'
import { useObligationClipboard } from '@/lib/obligations-clipboard'
import { cn, formatDocumentMasked } from '@/lib/utils'
import { Avatar } from '@/components/ui/primitives'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ClientLinksDialog } from './client-links-dialog'

type LinkStatusFilter = 'active' | 'inactive' | 'all'

/** Matriz Clientes × Obrigações com cópia/colagem de vínculos entre clientes. */
export function MatrixGrid() {
  const invalidate = useObligationsInvalidate()
  const clipboard = useObligationClipboard()

  const [search, setSearch] = React.useState('')
  const [debouncedSearch, setDebouncedSearch] = React.useState('')
  const [groupFilter, setGroupFilter] = React.useState<string>('all')
  const [statusFilter, setStatusFilter] = React.useState<LinkStatusFilter>('active')
  /** null = todos os departamentos (padrão). */
  const [deptSelection, setDeptSelection] = React.useState<Set<string> | null>(null)
  const [deptOpen, setDeptOpen] = React.useState(false)
  const deptRef = React.useRef<HTMLDivElement>(null)

  const [pendingRemoval, setPendingRemoval] = React.useState<{
    clientId: string
    clientName: string
    obligationId: string
    sigla: string
  } | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const [manageClient, setManageClient] = React.useState<Client | null>(null)

  React.useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 250)
    return () => clearTimeout(timeout)
  }, [search])

  React.useEffect(() => {
    if (!deptOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (deptRef.current && !deptRef.current.contains(event.target as Node)) setDeptOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeptOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [deptOpen])

  const { data: departments, isLoading: departmentsLoading } = useDepartments()
  const { data: obligations, isLoading: obligationsLoading } = useObligations({ active: 'active' })
  const { data: groups } = useObligationGroups()
  const { data: links, isLoading: linksLoading } = useClientObligationLinks()
  const { data: clients, isLoading: clientsLoading } = useClients({
    search: debouncedSearch || undefined,
    status: 'active',
  })

  const visibleDepartmentIds = React.useMemo(() => {
    if (deptSelection) return deptSelection
    return new Set((departments ?? []).map((department) => department.id))
  }, [departments, deptSelection])

  const groupObligationIds = React.useMemo(() => {
    if (groupFilter === 'all') return null
    const group = (groups ?? []).find((item) => item.id === groupFilter)
    return group ? new Set(group.obligationIds) : new Set<string>()
  }, [groups, groupFilter])

  const columns = React.useMemo(() => {
    return (obligations ?? [])
      .filter((obligation) => visibleDepartmentIds.has(obligation.departmentId))
      .filter((obligation) => !groupObligationIds || groupObligationIds.has(obligation.id))
      .sort(
        (a, b) =>
          a.departmentName.localeCompare(b.departmentName, 'pt-BR') ||
          a.sigla.localeCompare(b.sigla, 'pt-BR'),
      )
  }, [obligations, visibleDepartmentIds, groupObligationIds])

  const linksByClient = React.useMemo(() => {
    const map = new Map<string, Map<string, ClientObligation>>()
    for (const link of links ?? []) {
      const byObligation = map.get(link.clientId) ?? new Map<string, ClientObligation>()
      byObligation.set(link.obligationId, link)
      map.set(link.clientId, byObligation)
    }
    return map
  }, [links])

  const toggleDepartment = (departmentId: string) => {
    setDeptSelection((current) => {
      const base = new Set(current ?? (departments ?? []).map((department) => department.id))
      if (base.has(departmentId)) base.delete(departmentId)
      else base.add(departmentId)
      return base
    })
  }

  const setCell = async (clientId: string, obligationId: string, active: boolean) => {
    try {
      const result = await aurumBitPortal().obligations.setLink({ clientId, obligationId, active })
      invalidate.all()
      if (result.created) toast.success('Vínculo criado.')
      else if (result.reactivated) toast.success('Vínculo reativado.')
      else if (!active && result.changed)
        toast.success('Vínculo removido (vínculo inativado; histórico preservado).')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const onCellClick = (client: Client, obligation: Obligation) => {
    const link = linksByClient.get(client.id)?.get(obligation.id)
    const isActiveLink = Boolean(link?.active)
    const isInactiveLink = Boolean(link && !link.active)
    if (statusFilter === 'inactive') {
      if (isInactiveLink) void setCell(client.id, obligation.id, true)
      return
    }
    if (isActiveLink) {
      setPendingRemoval({
        clientId: client.id,
        clientName: client.name,
        obligationId: obligation.id,
        sigla: obligation.sigla,
      })
      return
    }
    void setCell(client.id, obligation.id, true)
  }

  const confirmRemoval = async () => {
    if (!pendingRemoval) return
    setRemoving(true)
    try {
      await setCell(pendingRemoval.clientId, pendingRemoval.obligationId, false)
      setPendingRemoval(null)
    } finally {
      setRemoving(false)
    }
  }

  const copyFrom = (client: Client) => {
    const activeIds = (links ?? [])
      .filter((link) => link.clientId === client.id && link.active)
      .map((link) => link.obligationId)
    if (activeIds.length === 0) {
      toast.warning('Este cliente não possui vínculos ativos para copiar.')
      return
    }
    clipboard.copy({ clientId: client.id, clientName: client.name, obligationIds: activeIds })
    toast.success(
      `${activeIds.length} vínculo(s) de ${client.name} copiado(s) para a área de transferência.`,
    )
  }

  const pasteTo = async (client: Client) => {
    if (clipboard.obligationIds.length === 0) {
      toast.warning('A área de transferência está vazia. Copie os vínculos de um cliente primeiro.')
      return
    }
    try {
      const result = await aurumBitPortal().obligations.pasteLinks({
        targetClientId: client.id,
        obligationIds: clipboard.obligationIds,
      })
      invalidate.all()
      const reactivated = result.reactivated > 0 ? `, ${result.reactivated} reativado(s)` : ''
      toast.success(
        `Vínculos colados em ${client.name}: ${result.created} copiado(s), ${result.skipped} já existiam${reactivated}.`,
      )
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const isLoading = departmentsLoading || obligationsLoading || linksLoading || clientsLoading
  const rows = clients ?? []
  const selectedDepartmentsCount = visibleDepartmentIds.size
  const totalDepartments = departments?.length ?? 0
  const activeLinksCount = (links ?? []).filter((link) => link.active).length

  return (
    <div className="space-y-4">
      {/* -------- Filtros -------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        {/* Departamento (multi-select) */}
        <div ref={deptRef} className="relative">
          <button
            type="button"
            onClick={() => setDeptOpen((value) => !value)}
            aria-expanded={deptOpen}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] px-3.5 text-sm font-medium text-[var(--pv-text)] shadow-sm hover:border-[var(--pv-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/25"
          >
            Departamentos
            <span className="rounded-full bg-[var(--pv-panel-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--pv-muted)]">
              {deptSelection === null
                ? `todos (${totalDepartments})`
                : `${selectedDepartmentsCount}/${totalDepartments}`}
            </span>
            <ChevronDown className="h-4 w-4 text-[var(--pv-muted)]" aria-hidden="true" />
          </button>
          {deptOpen ? (
            <div
              role="group"
              aria-label="Filtrar por departamento"
              className="absolute z-30 mt-2 w-72 rounded-2xl border border-[var(--pv-border)] bg-[var(--pv-panel)] p-2 shadow-[var(--pv-shadow-lg)]"
            >
              <button
                type="button"
                onClick={() => setDeptSelection(null)}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)]"
              >
                Todos os departamentos
                {deptSelection === null ? (
                  <Check className="h-4 w-4 text-[var(--pv-accent)]" aria-hidden="true" />
                ) : null}
              </button>
              <div className="my-1 h-px bg-[var(--pv-border)]" />
              <div className="max-h-64 overflow-y-auto pv-scroll">
                {(departments ?? []).map((department) => {
                  const checked = visibleDepartmentIds.has(department.id)
                  return (
                    <label
                      key={department.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm hover:bg-[var(--pv-panel-2)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDepartment(department.id)}
                        className="h-4 w-4 accent-[var(--pv-accent-solid)]"
                      />
                      <span className="min-w-0 flex-1 truncate">{department.name}</span>
                      <span className="text-[11px] font-medium text-[var(--pv-faint)]">
                        {department.obligationsCount}
                      </span>
                    </label>
                  )
                })}
                {totalDepartments === 0 ? (
                  <p className="px-3 py-2 text-xs text-[var(--pv-muted)]">
                    Nenhum departamento cadastrado.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        {/* Cliente (busca) */}
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-faint)]"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente por nome ou documento…"
            aria-label="Buscar cliente"
            className="pl-10"
          />
        </div>

        {/* Grupo de obrigações */}
        <Select
          value={groupFilter}
          onChange={(event) => setGroupFilter(event.target.value)}
          aria-label="Filtrar por grupo de obrigações"
          className="w-52"
        >
          <option value="all">Todos os grupos</option>
          {(groups ?? []).map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>

        {/* Status do vínculo */}
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as LinkStatusFilter)}
          aria-label="Status do vínculo"
          className="w-40"
        >
          <option value="active">Vínculos ativos</option>
          <option value="inactive">Vínculos inativos</option>
          <option value="all">Ativos e inativos</option>
        </Select>

        <span className="ml-auto whitespace-nowrap text-xs font-medium text-[var(--pv-muted)]">
          {rows.length} cliente(s) × {columns.length} obrigação(ões) · {activeLinksCount} vínculo(s)
          ativo(s)
        </span>
      </div>

      {/* -------- Barra da área de transferência -------- */}
      {clipboard.obligationIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--pv-accent-soft-border)] bg-[var(--pv-accent-soft)] px-4 py-2 text-xs text-[var(--pv-accent)]">
          <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
          <span className="font-semibold">
            Área de transferência: {clipboard.obligationIds.length} vínculo(s) de{' '}
            {clipboard.sourceClientName ?? 'cliente'}.
          </span>
          <span className="text-[var(--pv-muted)]">
            Passe o mouse sobre outro cliente e clique em Colar.
          </span>
          <button
            type="button"
            onClick={clipboard.clear}
            className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold hover:bg-black/5"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Limpar
          </button>
        </div>
      ) : null}

      {/* -------- Grade matricial -------- */}
      <div className="overflow-x-auto rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)] pv-scroll">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--pv-border)] bg-[var(--pv-panel-2)]">
              <th
                scope="col"
                className="sticky left-0 z-10 min-w-64 border-r border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.06em] text-[var(--pv-muted)]"
              >
                Cliente
              </th>
              {columns.map((obligation) => (
                <th
                  key={obligation.id}
                  scope="col"
                  title={`${obligation.name} — ${obligation.departmentName}`}
                  aria-label={`${obligation.name} — ${obligation.departmentName}`}
                  className="min-w-16 border-r border-[var(--pv-border)]/60 px-2 py-3 text-center align-bottom"
                >
                  <span className="block text-[11px] font-extrabold tracking-wide text-[var(--pv-text)]">
                    {obligation.sigla}
                  </span>
                  <span className="mt-0.5 block max-w-24 truncate text-[9px] font-medium text-[var(--pv-faint)]">
                    {obligation.departmentName}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-10 text-center text-sm text-[var(--pv-muted)]"
                >
                  Carregando matriz…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-4 py-10 text-center text-sm text-[var(--pv-muted)]"
                >
                  Nenhum cliente encontrado{debouncedSearch ? ` para “${debouncedSearch}”` : ''}.
                </td>
              </tr>
            ) : columns.length === 0 ? (
              <tr>
                <td colSpan={1} className="px-4 py-10 text-center text-sm text-[var(--pv-muted)]">
                  Nenhuma obrigação ativa para os filtros selecionados. Cadastre obrigações na aba
                  “Obrigações” ou ajuste os departamentos/grupo.
                </td>
              </tr>
            ) : (
              rows.map((client) => {
                const clientLinks = linksByClient.get(client.id)
                const activeCount = [...(clientLinks?.values() ?? [])].filter(
                  (link) => link.active,
                ).length
                return (
                  <tr
                    key={client.id}
                    className="group border-b border-[var(--pv-border)] last:border-0 hover:bg-[var(--pv-panel-2)]/60"
                  >
                    <td className="sticky left-0 z-10 border-r border-[var(--pv-border)] bg-[var(--pv-panel)] px-4 py-2 group-hover:bg-[var(--pv-panel-2)]">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={client.name} size="sm" />
                        <div className="min-w-0">
                          <Link
                            href={`/clients/detail/?id=${client.id}`}
                            className="block max-w-52 truncate text-[13px] font-semibold leading-tight hover:text-[var(--pv-accent)] hover:underline"
                            title={`Abrir ficha de ${client.name}`}
                          >
                            {client.name}
                          </Link>
                          <span className="text-[10px] font-medium text-[var(--pv-faint)]">
                            {formatDocumentMasked(client.document)} · {activeCount} vínculo(s)
                          </span>
                          {/* Ações abaixo do nome, reveladas no hover/foco (sem coluna dedicada) */}
                          <div className="grid grid-rows-[0fr] opacity-0 transition-all duration-150 ease-out focus-within:grid-rows-[1fr] focus-within:opacity-100 group-hover:grid-rows-[1fr] group-hover:opacity-100">
                            <div className="overflow-hidden">
                              <div className="flex items-center gap-1 pt-1">
                                <button
                                  type="button"
                                  onClick={() => copyFrom(client)}
                                  title="Copiar vínculos"
                                  aria-label={`Copiar vínculos de ${client.name}`}
                                  className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)] disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={activeCount === 0}
                                >
                                  <Copy className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void pasteTo(client)}
                                  title={
                                    clipboard.obligationIds.length > 0
                                      ? `Colar ${clipboard.obligationIds.length} vínculo(s) da área de transferência`
                                      : 'Área de transferência vazia'
                                  }
                                  aria-label={`Colar vínculos em ${client.name}`}
                                  className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)] disabled:cursor-not-allowed disabled:opacity-35"
                                  disabled={clipboard.obligationIds.length === 0}
                                >
                                  <ClipboardPaste className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setManageClient(client)}
                                  title="Gerenciar vínculos (datas e remoção definitiva)"
                                  aria-label={`Gerenciar vínculos de ${client.name}`}
                                  className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)]"
                                >
                                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                                </button>
                                <Link
                                  href={`/clients/detail/?id=${client.id}`}
                                  title="Abrir ficha do cliente"
                                  aria-label={`Abrir ficha de ${client.name}`}
                                  className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)]"
                                >
                                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                </Link>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                    {columns.map((obligation) => {
                      const link = clientLinks?.get(obligation.id)
                      const isActiveLink = Boolean(link?.active)
                      const isInactiveLink = Boolean(link && !link.active)
                      const showInactive = statusFilter === 'all' || statusFilter === 'inactive'
                      const filled = statusFilter === 'inactive' ? false : isActiveLink
                      const dashed = !filled && isInactiveLink && showInactive
                      const inert = statusFilter === 'inactive' && !isInactiveLink
                      return (
                        <td
                          key={obligation.id}
                          className="border-r border-[var(--pv-border)]/60 p-1 text-center align-middle"
                        >
                          <button
                            type="button"
                            disabled={inert}
                            onClick={() => onCellClick(client, obligation)}
                            aria-pressed={isActiveLink}
                            aria-label={`${
                              isActiveLink ? 'Remover vínculo de' : 'Vincular'
                            } ${obligation.name} (${obligation.sigla}) — ${client.name}`}
                            title={`${obligation.name} — ${client.name}`}
                            className={cn(
                              'mx-auto flex h-9 w-9 items-center justify-center rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30',
                              filled &&
                                'border-[var(--pv-accent-soft-border)] bg-[var(--pv-accent-soft)] text-[var(--pv-accent)] shadow-sm',
                              dashed &&
                                'border-dashed border-[var(--pv-border-strong)] bg-transparent text-[var(--pv-faint)] hover:border-[var(--pv-accent)] hover:text-[var(--pv-accent)]',
                              !filled &&
                                !dashed &&
                                !inert &&
                                'border-transparent text-transparent hover:border-[var(--pv-border-strong)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-faint)]',
                              inert && 'cursor-default border-transparent text-transparent',
                            )}
                          >
                            {filled || dashed ? (
                              <Check
                                className="h-4 w-4"
                                strokeWidth={filled ? 3 : 2}
                                aria-hidden="true"
                              />
                            ) : null}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--pv-faint)]">
        Clique na célula para vincular/desvincular. As ações de cada cliente aparecem abaixo do nome
        ao passar o mouse (ou ao focar com Tab). Desvincular na célula inativa o vínculo (o
        histórico é preservado); a remoção definitiva fica em “Gerenciar vínculos”. A cópia de
        vínculos fica apenas na memória de sessão e cria registros independentes por cliente.
      </p>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null)
        }}
        title="Remover vínculo?"
        description={
          pendingRemoval
            ? `Desvincular “${pendingRemoval.sigla}” de ${pendingRemoval.clientName}? O vínculo fica inativo (histórico preservado) e pode ser reativado depois.`
            : undefined
        }
        confirmLabel="Remover vínculo"
        onConfirm={() => void confirmRemoval()}
        busy={removing}
      />

      <ClientLinksDialog
        client={manageClient}
        open={manageClient !== null}
        onOpenChange={(open) => {
          if (!open) setManageClient(null)
        }}
      />
    </div>
  )
}
