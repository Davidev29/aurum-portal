/**
 * Suíte de stress — clientes e credenciais (volume PJ + reuso de senha).
 *
 * Observação conhecida (medida, não corrigida): `createCredential` chama
 * `getCredentialView`, que por sua vez chama `listCredentials(db)` — full
 * table scan + group-by de fingerprint + sort completo a cada chamada, ou
 * seja, a criação de credenciais é O(N²). As métricas `*.create_batches`
 * registram first50AvgMs × last50AvgMs para quantificar o efeito.
 *
 * Nenhum dado real: CNPJs/senhas são sintéticos e determinísticos
 * (tests/stress/helpers.ts). Bancos são in-memory e fechados em finally.
 */
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  createClient,
  listClients,
  getClient,
  findClientByDocument,
  updateClient,
  setClientStatus,
  clientsForCsv,
  createClientNote,
  listClientNotes,
} from '../../electron/main/db/repositories/clients'
import {
  createCredential,
  listCredentials,
  revealCredential,
  deleteCredential,
  setDefaultCredential,
} from '../../electron/main/db/repositories/credentials'
import { createDatabase } from '../../electron/main/db/database'
import { seedBuiltins } from '../../electron/main/db/seed'
import { services } from '../../electron/main/db/schema'
import { VaultService } from '../../electron/main/vault/service'
import { makeValidCnpj, syntheticPassword, logMetric, mulberry32 } from './helpers'

const avg = (xs: number[]): number => xs.reduce((sum, x) => sum + x, 0) / xs.length

const p95 = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? 0
}

describe('stress: clientes e credenciais', () => {
  const vault = new VaultService(Buffer.alloc(32, 9))

  it('stress: 500 clientes PJ', () => {
    const { db, close } = createDatabase(':memory:')
    seedBuiltins(db)
    try {
      // ── criação ─────────────────────────────────────────────────
      const created: ReturnType<typeof createClient>[] = []
      const createTimes: number[] = []
      const createStart = performance.now()
      for (let i = 0; i < 500; i++) {
        const t0 = performance.now()
        created.push(
          createClient(db, {
            type: 'PJ',
            name: `Stress Empresa ${String(i).padStart(4, '0')}`,
            document: makeValidCnpj(50000 + i),
            consent: true,
            honorariosCents: 15000 + i,
            tags: ['stress'],
          }),
        )
        createTimes.push(performance.now() - t0)
      }
      const totalMs = performance.now() - createStart
      logMetric('clients.create_500', { totalMs, msPerClient: totalMs / 500 })
      logMetric('clients.create_batches', {
        first50AvgMs: avg(createTimes.slice(0, 50)),
        last50AvgMs: avg(createTimes.slice(-50)),
        totalMs,
        count: created.length,
      })
      expect(listClients(db)).toHaveLength(500)
      expect(totalMs).toBeLessThan(15000)

      // ── busca (ClientFilter.search) ──────────────────────────────
      const found = listClients(db, { search: 'Empresa 0042' })
      expect(found).toHaveLength(1)
      expect(found[0]?.name).toBe('Stress Empresa 0042')
      const searchStart = performance.now()
      let searchHits = 0
      for (let i = 0; i < 200; i++) {
        searchHits = listClients(db, { search: 'Empresa 0042' }).length
      }
      const searchMs = performance.now() - searchStart
      logMetric('clients.search_200', {
        totalMs: searchMs,
        msPerSearch: searchMs / 200,
        hits: searchHits,
      })
      expect(searchMs).toBeLessThan(2000)

      // ── exportação CSV + junção local ────────────────────────────
      const csvStart = performance.now()
      const csvRows = clientsForCsv(db)
      const csv = [
        'id;type;name;document;honorariosCents;status',
        ...csvRows.map((row) =>
          [row.id, row.type, row.name, row.document, row.honorariosCents ?? '', row.status].join(
            ';',
          ),
        ),
      ].join('\n')
      const csvMs = performance.now() - csvStart
      logMetric('clients.csv_500', { totalMs: csvMs, rows: csvRows.length, bytes: csv.length })
      expect(csvRows).toHaveLength(500)
      expect(csv.split('\n')).toHaveLength(501)

      // ── findClientByDocument × 100 aleatórios ────────────────────
      const rng = mulberry32(20261112)
      const picks = new Set<number>()
      while (picks.size < 100) picks.add(Math.floor(rng() * 500))
      const findStart = performance.now()
      for (const i of picks) {
        const document = makeValidCnpj(50000 + i)
        expect(findClientByDocument(db, document)?.document).toBe(document)
      }
      const findMs = performance.now() - findStart
      logMetric('clients.find_document_100', { totalMs: findMs, msPerFind: findMs / picks.size })

      // ── atualização em massa de honorários (200) ─────────────────
      const updateStart = performance.now()
      for (let i = 0; i < 200; i++) {
        updateClient(db, created[i]!.id, { honorariosCents: 99900 + i })
      }
      const updateMs = performance.now() - updateStart
      for (const i of [0, 50, 100, 150, 199]) {
        expect(getClient(db, created[i]!.id)?.honorariosCents).toBe(99900 + i)
      }
      logMetric('clients.update_honorarios_200', {
        totalMs: updateMs,
        msPerUpdate: updateMs / 200,
      })

      // ── notas: 100 no mesmo cliente ──────────────────────────────
      const notesClient = created[0]!
      const notesStart = performance.now()
      for (let i = 0; i < 100; i++) {
        createClientNote(db, notesClient.id, `nota stress ${i}`)
      }
      const notes = listClientNotes(db, notesClient.id)
      const notesMs = performance.now() - notesStart
      logMetric('clients.notes_100', { totalMs: notesMs, count: notes.length })
      expect(notes).toHaveLength(100)
      expect(notesMs).toBeLessThan(5000)

      // ── arquivamento de 50 clientes ──────────────────────────────
      const archiveStart = performance.now()
      for (let i = 0; i < 50; i++) {
        setClientStatus(db, created[i]!.id, 'archived')
      }
      const archiveMs = performance.now() - archiveStart
      const afterArchive = listClients(db)
      expect(afterArchive).toHaveLength(500)
      const archivedOnly = listClients(db, { status: 'archived' })
      expect(archivedOnly).toHaveLength(50)
      logMetric('clients.archive_50', {
        totalMs: archiveMs,
        archived: archivedOnly.length,
        total: afterArchive.length,
      })
    } finally {
      close()
    }
  }, 60_000)

  it('stress: 400 credenciais com reveal e reuso', () => {
    const { db, close } = createDatabase(':memory:')
    seedBuiltins(db)
    try {
      const credClients: ReturnType<typeof createClient>[] = []
      for (let i = 0; i < 50; i++) {
        credClients.push(
          createClient(db, {
            type: 'PJ',
            name: `Stress Cred Empresa ${String(i).padStart(3, '0')}`,
            document: makeValidCnpj(60000 + i),
            consent: true,
            honorariosCents: 20000 + i,
            tags: ['stress', 'cred'],
          }),
        )
      }
      const serviceIds = db
        .select()
        .from(services)
        .all()
        .map((row) => row.id)
      expect(serviceIds.length).toBeGreaterThan(0)

      // ── criação (O(N²) conhecido: createCredential → getCredentialView) ──
      const createdCreds: ReturnType<typeof createCredential>[] = []
      const createTimes: number[] = []
      const createStart = performance.now()
      for (let i = 0; i < 400; i++) {
        const t0 = performance.now()
        createdCreds.push(
          createCredential(db, vault, {
            clientId: credClients[i % 50]!.id,
            serviceId: serviceIds[i % serviceIds.length]!,
            label: `Cred Stress ${String(i).padStart(3, '0')}`,
            username: `stress.user.${i}@example.com`,
            usernameType: 'email',
            password: syntheticPassword(i < 380 ? i : 99999), // 20 compartilham a senha 99999
          }),
        )
        createTimes.push(performance.now() - t0)
      }
      const totalMs = performance.now() - createStart
      logMetric('credentials.create_400', {
        totalMs,
        first50AvgMs: avg(createTimes.slice(0, 50)),
        last50AvgMs: avg(createTimes.slice(-50)),
        p95CreateMs: p95(createTimes),
      })
      logMetric('credentials.create_batches', {
        first50AvgMs: avg(createTimes.slice(0, 50)),
        last50AvgMs: avg(createTimes.slice(-50)),
        totalMs,
        count: createdCreds.length,
      })
      expect(totalMs).toBeLessThan(120_000)
      expect(listCredentials(db)).toHaveLength(400)

      // ── detecção de reuso de senha ───────────────────────────────
      const listed = listCredentials(db)
      const reusedCount = listed.filter((credential) => credential.reused).length
      logMetric('credentials.reuse_detection', { reusedCount, total: listed.length })
      expect(reusedCount).toBeGreaterThanOrEqual(20)

      // ── reveal × 100 (a cada 4ª credencial) ──────────────────────
      const revealStart = performance.now()
      let revealed = 0
      for (let i = 0; i < createdCreds.length; i += 4) {
        const credential = createdCreds[i]!
        const expected = syntheticPassword(i < 380 ? i : 99999)
        expect(revealCredential(db, vault, credential.id).password).toBe(expected)
        revealed += 1
      }
      const revealMs = performance.now() - revealStart
      logMetric('credentials.reveal_100', {
        totalMs: revealMs,
        count: revealed,
        msPerReveal: revealMs / revealed,
      })
      expect(revealMs).toBeLessThan(10000)

      // ── churn de setDefaultCredential × 50 ───────────────────────
      const churnStart = performance.now()
      for (let k = 0; k < 50; k++) {
        setDefaultCredential(db, createdCreds[k * 8]!.id)
      }
      const churnMs = performance.now() - churnStart
      logMetric('credentials.set_default_churn_50', {
        totalMs: churnMs,
        msPerSet: churnMs / 50,
      })

      // ── delete × 40 ──────────────────────────────────────────────
      const deleteStart = performance.now()
      for (let i = 0; i < 40; i++) {
        deleteCredential(db, createdCreds[i]!.id)
      }
      const deleteMs = performance.now() - deleteStart
      const remaining = listCredentials(db)
      logMetric('credentials.delete_40', { totalMs: deleteMs, remaining: remaining.length })
      expect(remaining).toHaveLength(360)
    } finally {
      close()
    }
  }, 180_000)

  it('stress: banco com volume misto', () => {
    const { db, close } = createDatabase(':memory:')
    seedBuiltins(db)
    try {
      const mixedClients: ReturnType<typeof createClient>[] = []
      for (let i = 0; i < 50; i++) {
        mixedClients.push(
          createClient(db, {
            type: 'PJ',
            name: `Stress Mix Empresa ${String(i).padStart(3, '0')}`,
            document: makeValidCnpj(70000 + i),
            consent: true,
            honorariosCents: 30000 + i,
            tags: ['stress', 'mix'],
          }),
        )
      }
      const serviceIds = db
        .select()
        .from(services)
        .all()
        .map((row) => row.id)

      // ── setup: recria o volume (50 clientes + 400 credenciais) ───
      const setupStart = performance.now()
      const createdCreds: ReturnType<typeof createCredential>[] = []
      for (let i = 0; i < 400; i++) {
        createdCreds.push(
          createCredential(db, vault, {
            clientId: mixedClients[i % 50]!.id,
            serviceId: serviceIds[i % serviceIds.length]!,
            label: `Mix Cred ${String(i).padStart(3, '0')}`,
            username: `mix.user.${i}@example.com`,
            usernameType: 'email',
            password: syntheticPassword(i < 380 ? i : 99999),
          }),
        )
      }
      const setupMs = performance.now() - setupStart
      logMetric('mixed.setup_400', { totalMs: setupMs })

      // ── carga mista: 50 finds + 50 reveals + 50 lists + 50 gets ──
      const rng = mulberry32(20261113)
      const workloadStart = performance.now()
      let finds = 0
      for (let k = 0; k < 50; k++) {
        const document = makeValidCnpj(70000 + Math.floor(rng() * 50))
        expect(findClientByDocument(db, document)?.document).toBe(document)
        finds += 1
      }
      let reveals = 0
      for (let k = 0; k < 50; k++) {
        const i = Math.floor(rng() * createdCreds.length)
        const expected = syntheticPassword(i < 380 ? i : 99999)
        expect(revealCredential(db, vault, createdCreds[i]!.id).password).toBe(expected)
        reveals += 1
      }
      let listCalls = 0
      for (let k = 0; k < 50; k++) {
        expect(listCredentials(db)).toHaveLength(400)
        listCalls += 1
      }
      let gets = 0
      for (let k = 0; k < 50; k++) {
        const client = mixedClients[Math.floor(rng() * mixedClients.length)]!
        expect(getClient(db, client.id)?.id).toBe(client.id)
        gets += 1
      }
      const workloadMs = performance.now() - workloadStart
      logMetric('mixed.workload', {
        totalMs: workloadMs,
        finds,
        reveals,
        listCredentials: listCalls,
        getClient: gets,
      })
      expect(workloadMs).toBeLessThan(60000)
    } finally {
      close()
    }
  }, 180_000)
})
