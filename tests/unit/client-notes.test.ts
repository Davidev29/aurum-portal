import { describe, expect, it } from 'vitest'
import BetterSqlite3 from 'better-sqlite3'
import {
  createClientNote,
  createClient,
  deleteClientNote,
  getClientNoteRow,
  listClientNotes,
  updateClientNote,
} from '../../electron/main/db/repositories/clients'
import { createDatabase } from '../../electron/main/db/database'
import { MIGRATIONS } from '../../electron/main/db/migrations'
import {
  clientNoteCreateSchema,
  clientNoteDeleteSchema,
  clientNoteListSchema,
  clientNoteUpdateSchema,
} from '../../shared/contracts'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('client notes — CRUD', () => {
  it('cria 2 notas, lista ordenada, atualiza e deleta', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Maria Silva',
        document: '52998224725',
        notes: 'nota legada',
      })
      const first = createClientNote(db, client.id, 'primeira nota')
      await sleep(10)
      const second = createClientNote(db, client.id, 'segunda nota')

      expect(first.clientId).toBe(client.id)
      expect(first.text).toBe('primeira nota')
      expect(second.text).toBe('segunda nota')

      const listed = listClientNotes(db, client.id)
      expect(listed).toHaveLength(2)
      // ordenada por createdAt DESC
      expect(listed[0]?.id).toBe(second.id)
      expect(listed[1]?.id).toBe(first.id)
      expect(listed[0]?.createdAt.localeCompare(listed[1]?.createdAt ?? '')).toBeGreaterThanOrEqual(0)

      // trim no create
      const trimmed = createClientNote(db, client.id, '  texto com espacos  ')
      expect(trimmed.text).toBe('texto com espacos')
      deleteClientNote(db, trimmed.id)
      expect(listClientNotes(db, client.id)).toHaveLength(2)

      // update
      await sleep(5)
      const updated = updateClientNote(db, first.id, 'primeira nota editada')
      expect(updated.id).toBe(first.id)
      expect(updated.text).toBe('primeira nota editada')
      expect(updated.updatedAt >= first.updatedAt).toBe(true)
      expect(getClientNoteRow(db, first.id)?.text).toBe('primeira nota editada')

      // delete
      deleteClientNote(db, second.id)
      const afterDelete = listClientNotes(db, client.id)
      expect(afterDelete).toHaveLength(1)
      expect(afterDelete[0]?.id).toBe(first.id)

      // clients.notes legado intacto
      expect(client.notes).toBe('nota legada')
    } finally {
      close()
    }
  })

  it('valida texto vazio e limite 5000', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Joao',
        document: '52998224725',
        notes: null,
      })
      expect(() => createClientNote(db, client.id, '   ')).toThrow()
      expect(() => createClientNote(db, client.id, '')).toThrow()
      expect(() => createClientNote(db, client.id, 'x'.repeat(5001))).toThrow()
      const ok = createClientNote(db, client.id, 'x'.repeat(5000))
      expect(ok.text).toHaveLength(5000)

      expect(() => updateClientNote(db, ok.id, '  ')).toThrow()
      expect(() => updateClientNote(db, ok.id, 'y'.repeat(5001))).toThrow()
    } finally {
      close()
    }
  })

  it('lanca NOT_FOUND para cliente ou nota inexistente', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Ana',
        document: '52998224725',
      })
      expect(() => listClientNotes(db, 'inexistente')).toThrow(/nao encontrad/)
      expect(() => createClientNote(db, 'inexistente', 'nota')).toThrow(/nao encontrad/)
      expect(() => updateClientNote(db, 'inexistente', 'nota')).toThrow(/nao encontrad/)
      expect(() => deleteClientNote(db, 'inexistente')).toThrow(/nao encontrad/)
      expect(getClientNoteRow(db, 'inexistente')).toBeNull()
      expect(listClientNotes(db, client.id)).toEqual([])
    } finally {
      close()
    }
  })

  it('schemas zod validam limites', () => {
    expect(clientNoteCreateSchema.parse({ clientId: 'c1', text: 'oi' })).toEqual({
      clientId: 'c1',
      text: 'oi',
    })
    expect(() => clientNoteCreateSchema.parse({ clientId: 'c1', text: ' ' })).toThrow()
    expect(() => clientNoteCreateSchema.parse({ clientId: '', text: 'oi' })).toThrow()
    expect(() => clientNoteCreateSchema.parse({ clientId: 'c1', text: 'x'.repeat(5001) })).toThrow()
    expect(clientNoteUpdateSchema.parse({ id: 'n1', text: 'novo' })).toEqual({ id: 'n1', text: 'novo' })
    expect(clientNoteListSchema.parse({ clientId: 'c1' })).toEqual({ clientId: 'c1' })
    expect(clientNoteDeleteSchema.parse({ id: 'n1' })).toEqual({ id: 'n1' })
  })
})

describe('client notes — migração de notes legada', () => {
  it('migra clients.notes não-vazio para client_notes sem apagar legado', () => {
    const sqlite = new BetterSqlite3(':memory:')
    try {
      const v1 = MIGRATIONS.find((m) => m.version === 1)?.sql ?? ''
      const v2 = MIGRATIONS.find((m) => m.version === 2)?.sql ?? ''
      const v3 = MIGRATIONS.find((m) => m.version === 3)?.sql ?? ''
      expect(v3).toContain('CREATE TABLE IF NOT EXISTS client_notes')
      expect(v3).toContain('INSERT INTO client_notes')

      sqlite.exec(v1)
      sqlite.exec(v2)

      const now = new Date().toISOString()
      const insert = sqlite.prepare(
        `INSERT INTO clients (id, type, name, document, notes, tags_json, status, created_at, updated_at)
         VALUES (?, 'PF', 'Legado', ?, ?, '[]', 'active', ?, ?)`,
      )
      insert.run('client-1', '11144477735', 'nota legada importante', now, now)
      insert.run('client-2', '22233344472', '   ', now, now)
      insert.run('client-3', '33355566678', null, now, now)

      sqlite.exec(v3)

      const rows = sqlite.prepare(`SELECT * FROM client_notes ORDER BY client_id`).all() as Array<{
        client_id: string
        text: string
      }>
      expect(rows).toHaveLength(1)
      expect(rows[0]?.client_id).toBe('client-1')
      expect(rows[0]?.text).toBe('nota legada importante')

      // legado intacto
      const c1 = sqlite.prepare(`SELECT notes FROM clients WHERE id = 'client-1'`).get() as {
        notes: string
      }
      expect(c1.notes).toBe('nota legada importante')

      // índice existe
      const idx = sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='client_notes_client_idx'`)
        .get()
      expect(idx).toBeTruthy()
    } finally {
      sqlite.close()
    }
  })
})
