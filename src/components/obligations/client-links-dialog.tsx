'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import type { Client } from '@shared/types'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useClientLinks, useObligations, useObligationsInvalidate } from '@/lib/obligations-queries'
import { describeObligationRule } from '@shared/obligation-rules'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/confirm-dialog'

/**
 * Gerenciamento fino dos vínculos de um cliente: datas de início/fim, ativar,
 * inativar e remoção definitiva. Cada alteração é salva e auditada
 * individualmente pelo processo principal.
 */
export function ClientLinksDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const invalidate = useObligationsInvalidate()
  const { data: links, isLoading } = useClientLinks(open ? (client?.id ?? null) : null)
  const { data: obligations } = useObligations()
  const [pendingRemoval, setPendingRemoval] = React.useState<{
    id: string
    sigla: string
  } | null>(null)
  const [removing, setRemoving] = React.useState(false)

  const obligationById = React.useMemo(
    () => new Map((obligations ?? []).map((obligation) => [obligation.id, obligation])),
    [obligations],
  )

  const update = async (
    id: string,
    patch: { dataInicio?: string; dataFim?: string | null; active?: boolean },
  ) => {
    try {
      await aurumBitPortal().obligations.updateLink({ id, ...patch })
      invalidate.all()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const remove = async () => {
    if (!pendingRemoval) return
    setRemoving(true)
    try {
      await aurumBitPortal().obligations.removeLink(pendingRemoval.id)
      invalidate.all()
      toast.success(`Vínculo ${pendingRemoval.sigla} removido definitivamente.`)
      setPendingRemoval(null)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setRemoving(false)
    }
  }

  const sorted = React.useMemo(
    () =>
      [...(links ?? [])].sort((a, b) => {
        const siglaA = obligationById.get(a.obligationId)?.sigla ?? ''
        const siglaB = obligationById.get(b.obligationId)?.sigla ?? ''
        return siglaA.localeCompare(siglaB, 'pt-BR')
      }),
    [links, obligationById],
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Vínculos de {client?.name ?? '—'}</DialogTitle>
            <DialogDescription>
              Datas de início/fim de cada vínculo. Deslize para ativar/inativar; a lixeira remove o
              vínculo definitivamente.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-[var(--pv-border)] pv-scroll">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--pv-muted)]">Carregando…</p>
            ) : sorted.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[var(--pv-muted)]">
                Nenhum vínculo registrado. Use a matriz ou “Colar vínculos” para criar.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[var(--pv-panel-2)] text-left text-[11px] uppercase tracking-wide text-[var(--pv-muted)]">
                  <tr>
                    <th className="px-3 py-2.5">Obrigação</th>
                    <th className="px-3 py-2.5">Início</th>
                    <th className="px-3 py-2.5">Fim</th>
                    <th className="px-3 py-2.5">Ativo</th>
                    <th className="px-3 py-2.5 text-right">Remover</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((link) => {
                    const obligation = obligationById.get(link.obligationId)
                    return (
                      <tr key={link.id} className="border-t border-[var(--pv-border)] align-middle">
                        <td className="px-3 py-2">
                          <div className="text-[13px] font-bold">{obligation?.sigla ?? '—'}</div>
                          <div className="max-w-56 truncate text-[11px] text-[var(--pv-muted)]">
                            {obligation?.name ?? 'Obrigação removida'}
                            {obligation ? ` · ${describeObligationRule(obligation)}` : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={link.dataInicio}
                            onChange={(event) => {
                              const value = event.target.value
                              if (value) void update(link.id, { dataInicio: value })
                            }}
                            aria-label="Data de início"
                            className="h-9 rounded-lg border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] px-2 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="date"
                            value={link.dataFim ?? ''}
                            min={link.dataInicio}
                            onChange={(event) =>
                              void update(link.id, { dataFim: event.target.value || null })
                            }
                            aria-label="Data de fim (opcional)"
                            className="h-9 rounded-lg border border-[var(--pv-border-strong)] bg-[var(--pv-panel)] px-2 text-xs"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Switch
                            checked={link.active}
                            onCheckedChange={(checked) => void update(link.id, { active: checked })}
                            aria-label={link.active ? 'Inativar vínculo' : 'Ativar vínculo'}
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setPendingRemoval({ id: link.id, sigla: obligation?.sigla ?? '' })
                            }
                            aria-label={`Remover definitivamente o vínculo ${obligation?.sigla ?? ''}`}
                            title="Remover definitivamente"
                            className="pv-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--pv-muted)] hover:bg-[var(--pv-danger-soft)] hover:text-[var(--pv-danger)]"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <DialogFooter>
            <p className="mr-auto self-center text-[11px] text-[var(--pv-faint)]">
              {sorted.length} vínculo(s) · fim em aberto = sem prazo
            </p>
            <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(value) => {
          if (!value) setPendingRemoval(null)
        }}
        title="Remover vínculo definitivamente?"
        description={`O vínculo ${pendingRemoval?.sigla ?? ''} será excluído do histórico. Prefira inativar na matriz se quiser manter o registro.`}
        confirmLabel="Remover definitivamente"
        onConfirm={() => void remove()}
        busy={removing}
      />
    </>
  )
}
