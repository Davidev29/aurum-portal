'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  CheckSquare,
  FolderOpen,
  Pencil,
  Plus,
  Search,
  Square,
  Trash2,
  UsersRound,
} from 'lucide-react'
import type { ObligationGroup } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import {
  useObligationGroups,
  useObligations,
  useObligationsInvalidate,
} from '@/lib/obligations-queries'
import { useClients } from '@/lib/queries'
import { formatDocumentMasked } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface FormState {
  id: string | null
  name: string
  description: string
  obligationIds: Set<string>
}

const emptyForm: FormState = { id: null, name: '', description: '', obligationIds: new Set() }

export function GroupsTab() {
  const invalidate = useObligationsInvalidate()
  const { data: groups, isLoading } = useObligationGroups()
  const { data: obligations } = useObligations()

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [obligationSearch, setObligationSearch] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [issue, setIssue] = React.useState<string | null>(null)

  const [pendingDelete, setPendingDelete] = React.useState<ObligationGroup | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const [applyGroup, setApplyGroup] = React.useState<ObligationGroup | null>(null)

  const obligationsByDepartment = React.useMemo(() => {
    const list = obligations ?? []
    const query = obligationSearch.trim().toLowerCase()
    const filtered = query
      ? list.filter((obligation) =>
          [obligation.sigla, obligation.name, obligation.departmentName]
            .join(' ')
            .toLowerCase()
            .includes(query),
        )
      : list
    const grouped = new Map<string, typeof list>()
    for (const obligation of filtered) {
      const key = obligation.departmentName
      const bucket = grouped.get(key) ?? []
      bucket.push(obligation)
      grouped.set(key, bucket)
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
  }, [obligations, obligationSearch])

  const openNew = () => {
    setForm(emptyForm)
    setObligationSearch('')
    setIssue(null)
    setDialogOpen(true)
  }

  const openEdit = (group: ObligationGroup) => {
    setForm({
      id: group.id,
      name: group.name,
      description: group.description ?? '',
      obligationIds: new Set(group.obligationIds),
    })
    setObligationSearch('')
    setIssue(null)
    setDialogOpen(true)
  }

  const toggleObligation = (id: string) => {
    setForm((current) => {
      const next = new Set(current.obligationIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...current, obligationIds: next }
    })
  }

  const submit = async () => {
    if (!form.name.trim()) {
      setIssue('Informe o nome do grupo')
      return
    }
    setSaving(true)
    setIssue(null)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      obligationIds: [...form.obligationIds],
    }
    try {
      if (form.id) {
        await aurumBitPortal().obligations.updateGroup(form.id, payload)
        toast.success('Grupo atualizado.')
      } else {
        await aurumBitPortal().obligations.createGroup(payload)
        toast.success('Grupo criado.')
      }
      invalidate.all()
      setDialogOpen(false)
    } catch (error) {
      setIssue(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await aurumBitPortal().obligations.deleteGroup(pendingDelete.id)
      invalidate.all()
      toast.success(`Grupo ${pendingDelete.name} excluído.`)
      setPendingDelete(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const selectedObligations = React.useMemo(
    () =>
      (obligations ?? [])
        .filter((obligation) => form.obligationIds.has(obligation.id))
        .sort((a, b) => a.sigla.localeCompare(b.sigla, 'pt-BR')),
    [obligations, form.obligationIds],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        <p className="text-xs leading-relaxed text-[var(--pv-muted)]">
          Grupos são <strong>templates reutilizáveis</strong>: aplicá-los a clientes gera vínculos
          individuais (um por cliente/obrigação), nunca um vínculo compartilhado.
        </p>
        <Button size="sm" className="ml-auto" onClick={openNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo grupo
        </Button>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-[var(--pv-muted)]">Carregando grupos…</p>
      ) : (groups ?? []).length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-6 w-6" aria-hidden="true" />}
          title="Nenhum grupo de obrigações"
          description="Crie um template com as obrigações comuns a um perfil de cliente (ex.: “MEI”, “Lucro Presumido”) e aplique em lote."
          action={
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Criar primeiro grupo
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(groups ?? []).map((group) => (
            <div
              key={group.id}
              className="flex flex-col gap-3 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-5 shadow-[var(--pv-shadow)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[15px] font-bold tracking-tight" title={group.name}>
                    {group.name}
                  </h3>
                  {group.description ? (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--pv-muted)]">
                      {group.description}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-full bg-[var(--pv-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--pv-accent)]">
                  {group.obligationIds.length} obrigação(ões)
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.obligations.slice(0, 8).map((obligation) => (
                  <span
                    key={obligation.id}
                    title={`${obligation.name} — ${obligation.departmentName}`}
                    className="rounded-md border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--pv-muted)]"
                  >
                    {obligation.sigla}
                  </span>
                ))}
                {group.obligationIds.length > 8 ? (
                  <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold text-[var(--pv-faint)]">
                    +{group.obligationIds.length - 8}
                  </span>
                ) : null}
                {group.obligationIds.length === 0 ? (
                  <span className="text-[11px] italic text-[var(--pv-faint)]">
                    Grupo vazio — edite para selecionar obrigações.
                  </span>
                ) : null}
              </div>
              <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--pv-border)] pt-3">
                <Button size="sm" variant="soft" onClick={() => setApplyGroup(group)}>
                  <UsersRound className="h-4 w-4" aria-hidden="true" />
                  Aplicar a clientes…
                </Button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(group)}
                    title="Editar grupo"
                    aria-label={`Editar ${group.name}`}
                    className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-2)] hover:text-[var(--pv-text)]"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(group)}
                    title="Excluir grupo"
                    aria-label={`Excluir ${group.name}`}
                    className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-danger-soft)] hover:text-[var(--pv-danger)]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor de grupo */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar grupo' : 'Novo grupo de obrigações'}</DialogTitle>
            <DialogDescription>
              Selecione as obrigações que formam o template. A prévia abaixo mostra o resultado.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" required>
                <Input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Ex.: Lucro Presumido"
                  autoFocus
                />
              </Field>
              <div className="flex items-end">
                <div className="w-full rounded-xl border border-[var(--pv-accent-soft-border)] bg-[var(--pv-accent-soft)] px-4 py-2.5 text-xs font-semibold text-[var(--pv-accent)]">
                  {form.obligationIds.size} obrigação(ões) selecionada(s)
                </div>
              </div>
            </div>
            <Field label="Descrição">
              <Textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Para qual perfil de cliente este grupo serve…"
                className="min-h-16"
              />
            </Field>

            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-faint)]"
                aria-hidden="true"
              />
              <Input
                value={obligationSearch}
                onChange={(event) => setObligationSearch(event.target.value)}
                placeholder="Filtrar obrigações por sigla, nome ou departamento…"
                aria-label="Filtrar obrigações"
                className="pl-10"
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--pv-border)] pv-scroll">
              {obligationsByDepartment.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-[var(--pv-muted)]">
                  Nenhuma obrigação encontrada. Cadastre obrigações na aba “Obrigações”.
                </p>
              ) : (
                obligationsByDepartment.map(([departmentName, items]) => (
                  <div
                    key={departmentName}
                    className="border-b border-[var(--pv-border)] last:border-0"
                  >
                    <div className="bg-[var(--pv-panel-2)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--pv-muted)]">
                      {departmentName}
                    </div>
                    {items.map((obligation) => {
                      const checked = form.obligationIds.has(obligation.id)
                      return (
                        <label
                          key={obligation.id}
                          className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[var(--pv-panel-2)]/60"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleObligation(obligation.id)}
                            className="h-4 w-4 accent-[var(--pv-accent-solid)]"
                          />
                          <span className="inline-flex min-w-14 justify-center rounded-md border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-1.5 py-0.5 text-[11px] font-bold">
                            {obligation.sigla}
                          </span>
                          <span className="min-w-0 flex-1 truncate" title={obligation.name}>
                            {obligation.name}
                            {obligation.active ? '' : ' (inativa)'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Prévia do template */}
            {selectedObligations.length > 0 ? (
              <div className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-4 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--pv-muted)]">
                  Prévia — {selectedObligations.length} obrigação(ões)
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--pv-muted)]">
                  {selectedObligations.map((obligation) => obligation.sigla).join(' · ')}
                </p>
              </div>
            ) : null}
          </div>
          {issue ? (
            <p
              role="alert"
              className="rounded-xl border border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] px-4 py-3 text-xs text-[var(--pv-danger)]"
            >
              {issue}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={saving}>
              {saving ? 'Salvando…' : form.id ? 'Salvar grupo' : 'Criar grupo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aplicar a clientes */}
      <ApplyGroupDialog group={applyGroup} onClose={() => setApplyGroup(null)} />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Excluir grupo?"
        description={
          pendingDelete
            ? `Excluir "${pendingDelete.name}"? Os vínculos já criados em clientes são mantidos — o grupo é apenas um template.`
            : undefined
        }
        confirmLabel="Excluir grupo"
        onConfirm={() => void confirmDelete()}
        busy={deleting}
      />
    </div>
  )
}

function ApplyGroupDialog({
  group,
  onClose,
}: {
  group: ObligationGroup | null
  onClose: () => void
}) {
  const invalidate = useObligationsInvalidate()
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [dataInicio, setDataInicio] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [applying, setApplying] = React.useState(false)
  const { data: clients, isLoading } = useClients({
    search: search.trim() || undefined,
    status: 'active',
  })

  React.useEffect(() => {
    if (group) {
      setSearch('')
      setSelected(new Set())
      setDataInicio(new Date().toISOString().slice(0, 10))
      setApplying(false)
    }
  }, [group])

  const visible = clients ?? []
  const allVisibleSelected =
    visible.length > 0 && visible.every((client) => selected.has(client.id))

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        for (const client of visible) next.delete(client.id)
      } else {
        for (const client of visible) next.add(client.id)
      }
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async () => {
    if (!group) return
    if (selected.size === 0) {
      toast.warning('Selecione ao menos um cliente.')
      return
    }
    setApplying(true)
    try {
      const result = await aurumBitPortal().obligations.applyGroup({
        groupId: group.id,
        clientIds: [...selected],
        dataInicio,
      })
      invalidate.all()
      const reactivated = result.reactivated > 0 ? `, ${result.reactivated} reativado(s)` : ''
      toast.success(
        `Grupo "${group.name}" aplicado a ${selected.size} cliente(s): ${result.created} vínculo(s) criado(s), ${result.skipped} já existiam${reactivated}.`,
      )
      onClose()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog
      open={group !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Aplicar “{group?.name}” a clientes</DialogTitle>
          <DialogDescription>
            Serão criados vínculos individuais (um por cliente e obrigação do grupo). Vínculos já
            existentes são ignorados; vínculos inativos são reativados.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-faint)]"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar cliente…"
              aria-label="Buscar cliente"
              className="pl-10"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--pv-accent)] hover:underline"
            >
              {allVisibleSelected ? (
                <>
                  <Square className="h-4 w-4" aria-hidden="true" /> Desmarcar visíveis
                </>
              ) : (
                <>
                  <CheckSquare className="h-4 w-4" aria-hidden="true" /> Selecionar visíveis
                </>
              )}
            </button>
            <span className="text-xs font-medium text-[var(--pv-muted)]">
              {selected.size} selecionado(s)
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--pv-border)] pv-scroll">
            {isLoading ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--pv-muted)]">Carregando…</p>
            ) : visible.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-[var(--pv-muted)]">
                Nenhum cliente ativo encontrado.
              </p>
            ) : (
              visible.map((client) => {
                const checked = selected.has(client.id)
                return (
                  <label
                    key={client.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-[var(--pv-border)] px-3 py-2 text-[13px] last:border-0 hover:bg-[var(--pv-panel-2)]/60"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOne(client.id)}
                      className="h-4 w-4 accent-[var(--pv-accent-solid)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{client.name}</span>
                      <span className="text-[10px] text-[var(--pv-faint)]">
                        {formatDocumentMasked(client.document)}
                      </span>
                    </span>
                  </label>
                )
              })
            )}
          </div>
          <Field label="Data de início dos vínculos">
            <Input
              type="date"
              value={dataInicio}
              onChange={(event) => setDataInicio(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => void apply()} disabled={applying || selected.size === 0}>
            {applying ? 'Aplicando…' : `Aplicar a ${selected.size} cliente(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
