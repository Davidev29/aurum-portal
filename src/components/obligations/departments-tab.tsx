'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Building2, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react'
import type { Department } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useDepartments, useObligationsInvalidate } from '@/lib/obligations-queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
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
  active: boolean
}

const emptyForm: FormState = { id: null, name: '', description: '', active: true }

export function DepartmentsTab() {
  const invalidate = useObligationsInvalidate()
  const { data: departments, isLoading } = useDepartments()
  const [search, setSearch] = React.useState('')

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [saving, setSaving] = React.useState(false)
  const [issue, setIssue] = React.useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = React.useState<Department | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const filtered = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = departments ?? []
    if (!query) return list
    return list.filter((department) =>
      [department.name, department.description ?? ''].join(' ').toLowerCase().includes(query),
    )
  }, [departments, search])

  const openNew = () => {
    setForm(emptyForm)
    setIssue(null)
    setDialogOpen(true)
  }

  const openEdit = (department: Department) => {
    setForm({
      id: department.id,
      name: department.name,
      description: department.description ?? '',
      active: department.active,
    })
    setIssue(null)
    setDialogOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) {
      setIssue('Informe o nome do departamento')
      return
    }
    setSaving(true)
    setIssue(null)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      active: form.active,
    }
    try {
      if (form.id) {
        await aurumBitPortal().obligations.updateDepartment(form.id, payload)
        toast.success('Departamento atualizado.')
      } else {
        await aurumBitPortal().obligations.createDepartment(payload)
        toast.success('Departamento criado.')
      }
      invalidate.all()
      setDialogOpen(false)
    } catch (error) {
      setIssue(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (department: Department) => {
    try {
      await aurumBitPortal().obligations.setDepartmentActive(department.id, !department.active)
      invalidate.all()
      toast.success(department.active ? 'Departamento inativado.' : 'Departamento reativado.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await aurumBitPortal().obligations.deleteDepartment(pendingDelete.id)
      invalidate.all()
      toast.success(`Departamento ${pendingDelete.name} excluído.`)
      setPendingDelete(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-faint)]"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar departamento…"
            aria-label="Buscar departamento"
            className="pl-10"
          />
        </div>
        <span className="text-xs font-medium text-[var(--pv-muted)]">
          {filtered.length} departamento(s)
        </span>
        <Button size="sm" className="ml-auto" onClick={openNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo departamento
        </Button>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-[var(--pv-muted)]">Carregando…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" aria-hidden="true" />}
          title={search ? 'Nenhum departamento encontrado' : 'Nenhum departamento cadastrado'}
          description="Departamentos organizam o catálogo de obrigações (Fiscal, Trabalhista, Contábil…). Toda obrigação pertence a um departamento."
          action={
            search ? undefined : (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Cadastrar primeiro departamento
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)] pv-scroll">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-[var(--pv-panel-2)] text-left text-[11px] uppercase tracking-[0.06em] text-[var(--pv-muted)]">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3 text-center">Obrigações</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((department) => (
                <tr
                  key={department.id}
                  className="border-t border-[var(--pv-border)] align-middle hover:bg-[var(--pv-panel-2)]/60"
                >
                  <td className="px-4 py-3 text-[13px] font-semibold">{department.name}</td>
                  <td className="max-w-96 px-4 py-3 text-[12px] leading-snug text-[var(--pv-muted)]">
                    {department.description || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={department.obligationsCount > 0 ? 'default' : 'outline'}>
                      {department.obligationsCount}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {department.active ? (
                      <Badge variant="success">Ativo</Badge>
                    ) : (
                      <Badge variant="outline">Inativo</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(department)}
                        title="Editar"
                        aria-label={`Editar ${department.name}`}
                        className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(department)}
                        title={department.active ? 'Inativar' : 'Reativar'}
                        aria-label={`${department.active ? 'Inativar' : 'Reativar'} ${department.name}`}
                        className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)]"
                      >
                        <Power className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(department)}
                        disabled={department.obligationsCount > 0}
                        title={
                          department.obligationsCount > 0
                            ? `Exclusão bloqueada: ${department.obligationsCount} obrigação(ões) vinculada(s). Inative o departamento.`
                            : 'Excluir departamento'
                        }
                        aria-label={`Excluir ${department.name}`}
                        className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-danger-soft)] hover:text-[var(--pv-danger)] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-[var(--pv-muted)]"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--pv-faint)]">
        A exclusão é bloqueada quando há obrigações vinculadas; nesses casos, inative o
        departamento. Obrigações inativas continuam vinculáveis a grupos e à matriz.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar departamento' : 'Novo departamento'}</DialogTitle>
            <DialogDescription>
              Departamentos agrupam obrigações por área (Fiscal, Trabalhista, Contábil…).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field label="Nome" required>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ex.: Fiscal"
                autoFocus
              />
            </Field>
            <Field label="Descrição">
              <Textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="O que este departamento cobre…"
                className="min-h-20"
              />
            </Field>
            {form.id ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Departamento ativo</div>
                  <div className="text-xs text-[var(--pv-muted)]">
                    Inativos somem dos seletores de novas obrigações.
                  </div>
                </div>
                <Switch
                  checked={form.active}
                  onCheckedChange={(checked) => setForm({ ...form, active: checked })}
                  aria-label="Departamento ativo"
                />
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
              {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Criar departamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Excluir departamento?"
        description={
          pendingDelete
            ? `Excluir "${pendingDelete.name}"? Esta ação não pode ser desfeita.`
            : undefined
        }
        confirmLabel="Excluir departamento"
        onConfirm={() => void confirmDelete()}
        busy={deleting}
      />
    </div>
  )
}
