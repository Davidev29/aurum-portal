'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ClientNote } from '@shared/types'
import { errorMessage, aurumBitPortal } from '@/lib/api'
import { useClientNotes, useInvalidate } from '@/lib/queries'
import { formatDateTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function ClientNotesManager({
  clientId,
  clientName,
}: {
  clientId: string
  clientName?: string
}) {
  const invalidate = useInvalidate()
  const { data: notes = [], isLoading, isError, error, refetch } = useClientNotes(clientId)

  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingText, setEditingText] = React.useState('')
  const [deletingNote, setDeletingNote] = React.useState<ClientNote | null>(null)
  const [busy, setBusy] = React.useState(false)

  const addNote = async () => {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      await aurumBitPortal().clients.createNote({ clientId, text })
      toast.success('Observação adicionada.')
      setDraft('')
      await Promise.all([invalidate.clientNotes(clientId), invalidate.audit()])
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (note: ClientNote) => {
    setEditingId(note.id)
    setEditingText(note.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditingText('')
  }

  const saveEdit = async () => {
    const text = editingText.trim()
    if (!editingId || !text || busy) return
    setBusy(true)
    try {
      await aurumBitPortal().clients.updateNote({ id: editingId, text })
      toast.success('Observação atualizada.')
      cancelEdit()
      await Promise.all([invalidate.clientNotes(clientId), invalidate.audit()])
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const deleteNote = async () => {
    if (!deletingNote || busy) return
    setBusy(true)
    try {
      await aurumBitPortal().clients.deleteNote(deletingNote.id)
      toast.success('Observação excluída.')
      setDeletingNote(null)
      if (editingId === deletingNote.id) cancelEdit()
      await Promise.all([invalidate.clientNotes(clientId), invalidate.audit()])
    } catch (caught) {
      toast.error(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Observações</CardTitle>
          {!isLoading && notes.length > 0 ? <Badge variant="outline">{notes.length}</Badge> : null}
        </div>
        {clientName ? <CardDescription>Observações de {clientName}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div
            className="h-20 animate-pulse rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)]"
            aria-label="Carregando observações"
            role="status"
          />
        ) : isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm font-medium text-[var(--pv-danger)]">
              {errorMessage(error) || 'Não foi possível carregar as observações.'}
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-[var(--pv-muted)]">Sem observações cadastradas.</p>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-xl border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-3"
              >
                {editingId === note.id ? (
                  <div className="space-y-2">
                    <label
                      htmlFor={`edit-note-${note.id}`}
                      className="text-sm font-medium text-[var(--pv-text)]"
                    >
                      Editar observação
                    </label>
                    <Textarea
                      id={`edit-note-${note.id}`}
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                      disabled={busy}
                      aria-label="Texto da observação"
                    />
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={busy}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void saveEdit()}
                        disabled={busy || !editingText.trim()}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Salvar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-sm text-[var(--pv-text)]">
                        {note.text}
                      </p>
                      <time
                        dateTime={note.createdAt}
                        className="mt-1.5 block text-xs text-[var(--pv-muted)]"
                      >
                        {formatDateTime(note.createdAt)}
                      </time>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => startEdit(note)}
                        title="Editar"
                        aria-label="Editar observação"
                        disabled={busy}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeletingNote(note)}
                        title="Excluir"
                        aria-label="Excluir observação"
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4 text-[var(--pv-danger)]" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void addNote()
          }}
        >
          <label htmlFor="new-note" className="text-sm font-semibold text-[var(--pv-text)]">
            Nova observação
          </label>
          <Textarea
            id="new-note"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Nova observação..."
            disabled={busy}
            aria-label="Nova observação"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-4 w-4" aria-hidden="true" />
              )}
              Adicionar
            </Button>
          </div>
        </form>
      </CardContent>

      <ConfirmDialog
        open={Boolean(deletingNote)}
        onOpenChange={(open) => {
          if (!open) setDeletingNote(null)
        }}
        title="Excluir observação?"
        description={
          <>
            Você deseja excluir a observação abaixo? Esta ação não pode ser desfeita.
            {deletingNote ? (
              <span className="mt-2 block whitespace-pre-wrap rounded-lg border border-[var(--pv-border)] bg-[var(--pv-panel-2)] p-2.5 text-sm">
                {deletingNote.text}
              </span>
            ) : null}
          </>
        }
        confirmLabel="Excluir"
        busy={busy}
        onConfirm={() => void deleteNote()}
      />
    </Card>
  )
}
