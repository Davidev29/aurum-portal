'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { CalendarClock, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react'
import type { Obligation, RecurrenceType, DueRuleType } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useDepartments, useObligations, useObligationsInvalidate } from '@/lib/obligations-queries'
import {
  DUE_RULE_LABELS,
  MONTH_LABELS,
  RECURRENCE_LABELS,
  RECURRENCE_TYPES,
  describeObligationRule,
  obligationRuleIssues,
} from '@shared/obligation-rules'
import { formatDateBr } from '@shared/holidays'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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
  sigla: string
  description: string
  departmentId: string
  recurrence: RecurrenceType
  dueRule: DueRuleType | ''
  diaFixo: string
  diaUtil: string
  mesReferencia: string
  antecedenciaNotificacaoDias: string
  active: boolean
}

const emptyForm: FormState = {
  id: null,
  name: '',
  sigla: '',
  description: '',
  departmentId: '',
  recurrence: 'mensal',
  dueRule: 'dia_fixo',
  diaFixo: '15',
  diaUtil: '5',
  mesReferencia: '1',
  antecedenciaNotificacaoDias: '7',
  active: true,
}

const SIGLA_PATTERN = /^[A-Z0-9.\-/]{1,12}$/

function formFromObligation(obligation: Obligation): FormState {
  return {
    id: obligation.id,
    name: obligation.name,
    sigla: obligation.sigla,
    description: obligation.description ?? '',
    departmentId: obligation.departmentId,
    recurrence: obligation.recurrence,
    dueRule: obligation.dueRule ?? '',
    diaFixo: obligation.diaFixo?.toString() ?? '',
    diaUtil: obligation.diaUtil?.toString() ?? '',
    mesReferencia: obligation.mesReferencia?.toString() ?? '1',
    antecedenciaNotificacaoDias: obligation.antecedenciaNotificacaoDias.toString(),
    active: obligation.active,
  }
}

export function ObligationsTab() {
  const invalidate = useObligationsInvalidate()
  const { data: departments } = useDepartments()

  const [search, setSearch] = React.useState('')
  const [departmentFilter, setDepartmentFilter] = React.useState<string>('all')
  const [recurrenceFilter, setRecurrenceFilter] = React.useState<string>('all')
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'active' | 'inactive'>('all')

  const { data: obligations, isLoading } = useObligations({
    search: search.trim() || undefined,
    departmentId: departmentFilter === 'all' ? undefined : departmentFilter,
    recurrence: recurrenceFilter as RecurrenceType | 'all',
    active: statusFilter,
  })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [form, setForm] = React.useState<FormState>(emptyForm)
  const [issues, setIssues] = React.useState<string[]>([])
  const [saving, setSaving] = React.useState(false)
  const [pendingDelete, setPendingDelete] = React.useState<Obligation | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const openNew = () => {
    setForm({ ...emptyForm, departmentId: departments?.[0]?.id ?? '' })
    setIssues([])
    setDialogOpen(true)
  }

  const openEdit = (obligation: Obligation) => {
    setForm(formFromObligation(obligation))
    setIssues([])
    setDialogOpen(true)
  }

  const setRecurrence = (recurrence: RecurrenceType) => {
    setForm((current) => {
      if (recurrence === 'eventual') {
        return { ...current, recurrence, dueRule: '', diaFixo: '', diaUtil: '', mesReferencia: '' }
      }
      if (recurrence === 'mensal') {
        return { ...current, recurrence, mesReferencia: '' }
      }
      return {
        ...current,
        recurrence,
        mesReferencia: current.mesReferencia || '1',
        dueRule: current.dueRule || 'dia_fixo',
      }
    })
  }

  const submit = async () => {
    const sigla = form.sigla.trim().toUpperCase()
    const diaFixo = form.diaFixo.trim() === '' ? null : Number(form.diaFixo)
    const diaUtil = form.diaUtil.trim() === '' ? null : Number(form.diaUtil)
    const mesReferencia = form.mesReferencia.trim() === '' ? null : Number(form.mesReferencia)
    const antecedencia = Number(form.antecedenciaNotificacaoDias)
    const baseIssues: string[] = []
    if (!form.name.trim()) baseIssues.push('Informe o nome da obrigação')
    if (!SIGLA_PATTERN.test(sigla)) {
      baseIssues.push(
        'A sigla deve ter de 1 a 12 caracteres: letras, números, ponto, hífen ou barra',
      )
    }
    if (!form.departmentId) baseIssues.push('Selecione o departamento')
    if (!Number.isInteger(antecedencia) || antecedencia < 0 || antecedencia > 90) {
      baseIssues.push('A antecedência deve ser um inteiro entre 0 e 90 dias')
    }
    if (form.recurrence !== 'eventual' && !form.dueRule) {
      baseIssues.push('Selecione a regra de vencimento')
    }
    if (
      form.dueRule === 'dia_fixo' &&
      (!Number.isInteger(diaFixo) || diaFixo! < 1 || diaFixo! > 31)
    ) {
      baseIssues.push('O dia fixo deve ser um inteiro entre 1 e 31')
    }
    if (
      form.dueRule === 'dia_util' &&
      (!Number.isInteger(diaUtil) || diaUtil! < 1 || diaUtil! > 15)
    ) {
      baseIssues.push('O N-ésimo dia útil deve ser um inteiro entre 1 e 15')
    }
    const ruleIssues = obligationRuleIssues({
      recurrence: form.recurrence,
      dueRule: form.dueRule || null,
      diaFixo: form.dueRule === 'dia_fixo' ? diaFixo : null,
      diaUtil: form.dueRule === 'dia_util' ? diaUtil : null,
      mesReferencia:
        form.recurrence === 'mensal' || form.recurrence === 'eventual' ? null : mesReferencia,
      antecedenciaNotificacaoDias: Number.isInteger(antecedencia) ? antecedencia : null,
    })
    const allIssues = [...new Set([...baseIssues, ...ruleIssues])]
    if (allIssues.length > 0) {
      setIssues(allIssues)
      return
    }

    setSaving(true)
    setIssues([])
    const payload = {
      name: form.name.trim(),
      sigla,
      description: form.description.trim() || null,
      departmentId: form.departmentId,
      recurrence: form.recurrence,
      dueRule: form.recurrence === 'eventual' ? null : form.dueRule || null,
      diaFixo: form.dueRule === 'dia_fixo' ? diaFixo : null,
      diaUtil: form.dueRule === 'dia_util' ? diaUtil : null,
      mesReferencia:
        form.recurrence === 'mensal' || form.recurrence === 'eventual' ? null : mesReferencia,
      antecedenciaNotificacaoDias: form.recurrence === 'eventual' ? 0 : antecedencia,
      active: form.active,
    }
    try {
      if (form.id) {
        await aurumBitPortal().obligations.updateObligation(form.id, payload)
        toast.success('Obrigação atualizada.')
      } else {
        await aurumBitPortal().obligations.createObligation(payload)
        toast.success('Obrigação criada.')
      }
      invalidate.all()
      setDialogOpen(false)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (obligation: Obligation) => {
    try {
      await aurumBitPortal().obligations.setObligationActive(obligation.id, !obligation.active)
      invalidate.all()
      toast.success(obligation.active ? 'Obrigação inativada.' : 'Obrigação reativada.')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await aurumBitPortal().obligations.deleteObligation(pendingDelete.id)
      invalidate.all()
      toast.success(`Obrigação ${pendingDelete.sigla} excluída.`)
      setPendingDelete(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  const isEventual = form.recurrence === 'eventual'
  const needsAnchor =
    form.recurrence === 'bimestral' ||
    form.recurrence === 'trimestral' ||
    form.recurrence === 'semestral' ||
    form.recurrence === 'anual'

  return (
    <div className="space-y-4">
      {/* Filtros + ação principal */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] p-3 shadow-[var(--pv-shadow)]">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--pv-faint)]"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome ou sigla…"
            aria-label="Buscar obrigação"
            className="pl-10"
          />
        </div>
        <Select
          value={departmentFilter}
          onChange={(event) => setDepartmentFilter(event.target.value)}
          aria-label="Filtrar por departamento"
          className="w-52"
        >
          <option value="all">Todos os departamentos</option>
          {(departments ?? []).map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </Select>
        <Select
          value={recurrenceFilter}
          onChange={(event) => setRecurrenceFilter(event.target.value)}
          aria-label="Filtrar por recorrência"
          className="w-40"
        >
          <option value="all">Todas as recorrências</option>
          {RECURRENCE_TYPES.map((recurrence) => (
            <option key={recurrence} value={recurrence}>
              {RECURRENCE_LABELS[recurrence]}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}
          aria-label="Filtrar por status"
          className="w-36"
        >
          <option value="all">Ativas e inativas</option>
          <option value="active">Somente ativas</option>
          <option value="inactive">Somente inativas</option>
        </Select>
        <Button size="sm" className="ml-auto" onClick={openNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nova obrigação
        </Button>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <p className="py-10 text-center text-sm text-[var(--pv-muted)]">Carregando obrigações…</p>
      ) : (obligations ?? []).length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" aria-hidden="true" />}
          title="Nenhuma obrigação cadastrada"
          description="Cadastre obrigações recorrentes (SPED, DCTF, FGTS, eSocial…) vinculadas a um departamento. Cada obrigação pode ser vinculada aos clientes na matriz."
          action={
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Cadastrar primeira obrigação
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--pv-radius)] border border-[var(--pv-border)] bg-[var(--pv-panel)] shadow-[var(--pv-shadow)] pv-scroll">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-[var(--pv-panel-2)] text-left text-[11px] uppercase tracking-[0.06em] text-[var(--pv-muted)]">
              <tr>
                <th className="px-4 py-3">Sigla</th>
                <th className="px-4 py-3">Obrigação</th>
                <th className="px-4 py-3">Departamento</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3">Antecedência</th>
                <th className="px-4 py-3">Próx. vencimento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(obligations ?? []).map((obligation) => (
                <tr
                  key={obligation.id}
                  className="border-t border-[var(--pv-border)] hover:bg-[var(--pv-panel-2)]/60"
                >
                  <td className="px-4 py-3">
                    <span className="inline-flex min-w-16 justify-center rounded-lg border border-[var(--pv-border-strong)] bg-[var(--pv-panel-2)] px-2.5 py-1 text-[12px] font-extrabold tracking-wide">
                      {obligation.sigla}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div
                      className="max-w-72 truncate text-[13px] font-semibold"
                      title={obligation.name}
                    >
                      {obligation.name}
                    </div>
                    <div className="text-[11px] text-[var(--pv-faint)]">
                      {RECURRENCE_LABELS[obligation.recurrence]}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-[var(--pv-muted)]">
                    {obligation.departmentName}
                  </td>
                  <td className="max-w-56 px-4 py-3 text-[12px] leading-snug text-[var(--pv-muted)]">
                    {describeObligationRule(obligation)}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    {obligation.recurrence === 'eventual'
                      ? '—'
                      : `${obligation.antecedenciaNotificacaoDias} dia(s)`}
                  </td>
                  <td className="px-4 py-3 text-[13px]">{formatDateBr(obligation.nextDueDate)}</td>
                  <td className="px-4 py-3">
                    {obligation.active ? (
                      <Badge variant="success">Ativa</Badge>
                    ) : (
                      <Badge variant="outline">Inativa</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(obligation)}
                        title="Editar"
                        aria-label={`Editar ${obligation.sigla}`}
                        className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)]"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleActive(obligation)}
                        title={obligation.active ? 'Inativar' : 'Reativar'}
                        aria-label={`${obligation.active ? 'Inativar' : 'Reativar'} ${obligation.sigla}`}
                        className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-panel-3)] hover:text-[var(--pv-text)]"
                      >
                        <Power className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(obligation)}
                        title="Excluir (somente sem vínculos ativos)"
                        aria-label={`Excluir ${obligation.sigla}`}
                        className="pv-icon-btn flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-danger-soft)] hover:text-[var(--pv-danger)]"
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

      {/* Criar/editar */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar obrigação' : 'Nova obrigação'}</DialogTitle>
            <DialogDescription>
              A sigla é única dentro do departamento. A regra de vencimento define quando o
              agendador diário dispara o aviso na central de avisos.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ex.: SPED Contribuições"
                autoFocus
              />
            </Field>
            <Field label="Sigla" required hint="Única por departamento. Ex.: SPEDE, DCTF, FGTS.">
              <Input
                value={form.sigla}
                onChange={(event) =>
                  setForm({
                    ...form,
                    sigla: event.target.value.toUpperCase().replace(/[^a-zA-Z0-9.\-/]/g, ''),
                  })
                }
                placeholder="Ex.: DCTF"
                maxLength={12}
                className="uppercase"
              />
            </Field>
            <Field label="Departamento" required>
              <Select
                value={form.departmentId}
                onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
              >
                <option value="">Selecione…</option>
                {(departments ?? [])
                  .filter((department) => department.active || department.id === form.departmentId)
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                      {department.active ? '' : ' (inativo)'}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <Textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Detalhes, base legal, observações internas…"
                className="min-h-20"
              />
            </Field>
            <Field label="Recorrência" required>
              <Select
                value={form.recurrence}
                onChange={(event) => setRecurrence(event.target.value as RecurrenceType)}
              >
                {RECURRENCE_TYPES.map((recurrence) => (
                  <option key={recurrence} value={recurrence}>
                    {RECURRENCE_LABELS[recurrence]}
                  </option>
                ))}
              </Select>
            </Field>
            {!isEventual ? (
              <Field label="Regra de vencimento" required>
                <Select
                  value={form.dueRule}
                  onChange={(event) =>
                    setForm({ ...form, dueRule: event.target.value as DueRuleType })
                  }
                >
                  <option value="dia_fixo">{DUE_RULE_LABELS.dia_fixo}</option>
                  <option value="dia_util">{DUE_RULE_LABELS.dia_util}</option>
                </Select>
              </Field>
            ) : (
              <div className="flex items-end pb-2 text-xs leading-relaxed text-[var(--pv-muted)]">
                Obrigação eventual: sem vencimento automático. Os avisos não são gerados; o
                acompanhamento é manual.
              </div>
            )}
            {form.dueRule === 'dia_fixo' && !isEventual ? (
              <Field label="Dia do mês" required hint="Em mês com menos dias, vence no último dia.">
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={form.diaFixo}
                  onChange={(event) => setForm({ ...form, diaFixo: event.target.value })}
                />
              </Field>
            ) : null}
            {form.dueRule === 'dia_util' && !isEventual ? (
              <Field
                label="N-ésimo dia útil"
                required
                hint="Ex.: 5 = quinto dia útil do mês (sem fins de semana nem feriados)."
              >
                <Input
                  type="number"
                  min={1}
                  max={15}
                  value={form.diaUtil}
                  onChange={(event) => setForm({ ...form, diaUtil: event.target.value })}
                />
              </Field>
            ) : null}
            {needsAnchor ? (
              <Field
                label="Mês de referência"
                required={needsAnchor}
                hint="Mês de início do ciclo (âncora da recorrência)."
              >
                <Select
                  value={form.mesReferencia}
                  onChange={(event) => setForm({ ...form, mesReferencia: event.target.value })}
                >
                  {MONTH_LABELS.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {!isEventual ? (
              <Field
                label="Antecedência do aviso (dias)"
                hint="O aviso aparece na central X dias antes do vencimento."
              >
                <Input
                  type="number"
                  min={0}
                  max={90}
                  value={form.antecedenciaNotificacaoDias}
                  onChange={(event) =>
                    setForm({ ...form, antecedenciaNotificacaoDias: event.target.value })
                  }
                />
              </Field>
            ) : null}
            {form.id ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] px-4 py-3 sm:col-span-2">
                <div>
                  <div className="text-sm font-semibold">Obrigação ativa</div>
                  <div className="text-xs text-[var(--pv-muted)]">
                    Inativas somem da matriz e não geram avisos.
                  </div>
                </div>
                <Switch
                  checked={form.active}
                  onCheckedChange={(checked) => setForm({ ...form, active: checked })}
                  aria-label="Obrigação ativa"
                />
              </div>
            ) : null}
          </div>

          {issues.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-[var(--pv-danger-border)] bg-[var(--pv-danger-soft)] px-4 py-3 text-xs text-[var(--pv-danger)]"
            >
              <p className="font-bold">Verifique os campos:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void submit()} disabled={saving}>
              {saving ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Criar obrigação'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Excluir obrigação?"
        description={
          pendingDelete
            ? `Excluir "${pendingDelete.sigla} — ${pendingDelete.name}"? Só é possível sem vínculos ativos; vínculos inativos serão removidos junto. Para manter o histórico, prefira inativar.`
            : undefined
        }
        confirmLabel="Excluir obrigação"
        onConfirm={() => void confirmDelete()}
        busy={deleting}
      />
    </div>
  )
}
