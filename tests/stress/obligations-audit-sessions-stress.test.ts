/**
 * Suíte de stress — obrigações em volume, auditoria com redaction e
 * partições/registry de sessões.
 *
 * Nenhum dado real: CNPJs sintéticos (tests/stress/helpers.ts), bancos
 * in-memory fechados em finally. Métricas via logMetric para coleta do
 * orquestrador. Não ajustar redaction.ts mesmo se um sentinel sobreviver:
 * falhar o teste e reportar.
 */
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  applyGroup,
  createDepartment,
  createGroup,
  createObligation,
  listAllLinks,
  listLinksByClient,
  listMonthOverview,
  pasteLinks,
  setDelivery,
  updateLink,
} from '../../electron/main/db/repositories/obligations'
import { generateDueNotifications } from '../../electron/main/notifications/obligations-scheduler'
import { createClient } from '../../electron/main/db/repositories/clients'
import { createDatabase } from '../../electron/main/db/database'
import { seedBuiltins } from '../../electron/main/db/seed'
import {
  allAuditEvents,
  appendAuditEvent,
  countAuditEvents,
  listAuditEvents,
} from '../../electron/main/db/repositories/audit'
import {
  buildPartition,
  isPartitionForClient,
  sanitizePartitionSegment,
  sessionReuseKey,
} from '../../electron/main/sessions/partition'
import {
  SessionContextRegistry,
  type SessionContext,
} from '../../electron/main/sessions/context-registry'
import { makeValidCnpj, logMetric, mulberry32 } from './helpers'

const mensalRule = {
  recurrence: 'mensal' as const,
  dueRule: 'dia_fixo' as const,
  diaFixo: 5,
  diaUtil: null,
  mesReferencia: null,
  antecedenciaNotificacaoDias: 7,
}

const SENTINELS = [
  'stress-sentinel-password-777',
  'stress-sentinel-token-888',
  'stress-sentinel-pfx-999',
  'stress-sentinel-cookie-666',
] as const

describe('stress: matriz de obrigações 60 clientes × 15 obrigações', () => {
  it(
    '900 vínculos: grupo + pasteLinks, 12 meses de overview, agendador e baixas',
    { timeout: 180_000 },
    () => {
      const { db, close } = createDatabase(':memory:')
      seedBuiltins(db)
      try {
        const dept = createDepartment(db, { name: 'Fiscal', description: 'Obrigações fiscais' })
        const clients = Array.from({ length: 60 }, (_, i) =>
          createClient(db, {
            type: 'PJ',
            name: `Stress Obrig ${String(i).padStart(2, '0')}`,
            document: makeValidCnpj(80000 + i),
            consent: true,
          }),
        )
        const clientIds = clients.map((client) => client.id)
        const obligationsCreated = Array.from({ length: 15 }, (_, i) => {
          const code = `O${String(i + 1).padStart(2, '0')}`
          return createObligation(db, {
            ...mensalRule,
            name: `Stress ${code}`,
            sigla: code,
            departmentId: dept.id,
          })
        })
        const obligationIds = obligationsCreated.map((obligation) => obligation.id)

        // Grupo com as 10 primeiras obrigações aplicado aos 60 clientes.
        const group = createGroup(db, {
          name: 'Stress Grupo',
          obligationIds: obligationIds.slice(0, 10),
        })
        const applyStart = performance.now()
        const firstApply = applyGroup(db, { groupId: group.id, clientIds })
        const applyMs = performance.now() - applyStart
        expect(firstApply).toEqual({ created: 600, reactivated: 0, skipped: 0 })
        const secondApply = applyGroup(db, { groupId: group.id, clientIds })
        expect(secondApply).toEqual({ created: 0, reactivated: 0, skipped: 600 })
        logMetric('obligations.apply_group_600', {
          totalMs: applyMs,
          idempotentSkipped: secondApply.skipped,
        })

        // 5 restantes via pasteLinks, uma chamada por cliente (assinatura real).
        const pasteStart = performance.now()
        let pasteCreated = 0
        for (const client of clients) {
          const result = pasteLinks(db, {
            targetClientId: client.id,
            obligationIds: obligationIds.slice(10),
          })
          pasteCreated += result.created
        }
        const pasteMs = performance.now() - pasteStart
        expect(pasteCreated).toBe(300)
        logMetric('obligations.paste_links_300', { totalMs: pasteMs, created: pasteCreated })

        expect(listAllLinks(db)).toHaveLength(900)
        expect(listLinksByClient(db, clientIds[0]!)).toHaveLength(15)

        // dataInicio comum: ocorrências contam a partir de jan/2026.
        const updateStart = performance.now()
        for (const link of listAllLinks(db)) {
          updateLink(db, { id: link.id, dataInicio: '2026-01-01' })
        }
        logMetric('obligations.update_links_900', { totalMs: performance.now() - updateStart })

        // Visão mensal 2026-01..2026-12 — cada mês tem 900 ocorrências.
        const months = Array.from(
          { length: 12 },
          (_, i) => `2026-${String(i + 1).padStart(2, '0')}`,
        )
        const overviewStart = performance.now()
        const counts: number[] = []
        for (const month of months) {
          counts.push(listMonthOverview(db, month).length)
        }
        const overviewMs = performance.now() - overviewStart
        for (const [index, count] of counts.entries()) {
          expect(count, `overview ${months[index]}`).toBe(900)
        }
        logMetric('obligations.month_overview_12', {
          totalMs: overviewMs,
          counts,
          min: Math.min(...counts),
          max: Math.max(...counts),
        })
        expect(overviewMs).toBeLessThan(30_000)

        // Agendador: dias 24..31 de cada mês (cobre todos os dias de aviso
        // possíveis para dia_fixo=5 com antecedência 7).
        const sweep = (label: string): number => {
          let created = 0
          const start = performance.now()
          for (let m = 0; m < 12; m += 1) {
            for (let day = 24; day <= 31; day += 1) {
              created += generateDueNotifications(db, new Date(2026, m, day, 9, 0, 0))
            }
          }
          logMetric(label, { totalMs: performance.now() - start, created })
          return created
        }
        const firstSweepCreated = sweep('obligations.scheduler_first_sweep')
        expect(firstSweepCreated).toBeGreaterThan(1000)
        const secondSweepCreated = sweep('obligations.scheduler_second_sweep')
        expect(secondSweepCreated).toBe(0)

        // Baixa em lote: 100 primeiras ocorrências de 2026-03, 2ª passada idempotente.
        const batch = listMonthOverview(db, '2026-03').slice(0, 100)
        const deliveryStart = performance.now()
        const firstCompletedAt = new Map<string, string | null>()
        for (const item of batch) {
          expect(item.dueDate).toBeTruthy()
          const result = setDelivery(db, {
            clientId: item.clientId,
            obligationId: item.obligationId,
            dueDate: item.dueDate,
            delivered: true,
          })
          firstCompletedAt.set(
            `${item.clientId}|${item.obligationId}|${item.dueDate}`,
            result.completedAt,
          )
        }
        for (const item of batch) {
          const result = setDelivery(db, {
            clientId: item.clientId,
            obligationId: item.obligationId,
            dueDate: item.dueDate,
            delivered: true,
          })
          expect(result.completedAt).toBe(
            firstCompletedAt.get(`${item.clientId}|${item.obligationId}|${item.dueDate}`),
          )
        }
        const deliveryMs = performance.now() - deliveryStart
        const deliveredCount = listMonthOverview(db, '2026-03').filter(
          (item) => item.delivered,
        ).length
        expect(deliveredCount).toBe(100)
        logMetric('obligations.set_delivery_lote_200', { totalMs: deliveryMs, deliveredCount })
      } finally {
        close()
      }
    },
  )
})

describe('stress: auditoria em volume com redaction', () => {
  it(
    '1500 appends com sentinels — nada vaza; página, filtro e amostragem',
    { timeout: 180_000 },
    () => {
      const { db, close } = createDatabase(':memory:')
      seedBuiltins(db)
      try {
        const appendStart = performance.now()
        for (let i = 0; i < 1500; i += 1) {
          appendAuditEvent(db, {
            type: 'stress.event',
            entity: 'stress',
            entityId: `stress-entity-${i % 25}`,
            metadata: {
              password: SENTINELS[0],
              nested: { token: SENTINELS[1], pfx: SENTINELS[2], cookie: SENTINELS[3] },
              plain: 'ok',
              index: i,
            },
          })
        }
        const appendMs = performance.now() - appendStart
        logMetric('audit.append_1500', { totalMs: appendMs })
        expect(appendMs).toBeLessThan(10_000)
        expect(countAuditEvents(db)).toBe(1500)

        const readStart = performance.now()
        const all = allAuditEvents(db, {})
        const readMs = performance.now() - readStart
        logMetric('audit.all_1500', { totalMs: readMs, count: all.length })
        expect(all).toHaveLength(1500)
        expect(readMs).toBeLessThan(10_000)

        const serialized = JSON.stringify(all)
        for (const sentinel of SENTINELS) {
          expect(serialized).not.toContain(sentinel)
        }

        const page = listAuditEvents(db, { limit: 500 })
        expect(page.events).toHaveLength(500)
        expect(page.total).toBe(1500)
        const filtered = listAuditEvents(db, { types: ['stress.event'], limit: 500 })
        expect(filtered.total).toBe(1500)
        expect(filtered.events.every((event) => event.type === 'stress.event')).toBe(true)

        // 25 amostras: nenhum sentinel e campo `plain` preservado.
        for (let i = 0; i < all.length; i += 60) {
          const event = all[i]!
          const json = JSON.stringify(event)
          for (const sentinel of SENTINELS) {
            expect(json).not.toContain(sentinel)
          }
          expect(event.metadata.plain).toBe('ok')
        }
      } finally {
        close()
      }
    },
  )
})

describe('stress: partições e registry de sessões', () => {
  it(
    '2000 partições, sanitize hostil ×1000, reuse keys ×2000, registry 500',
    { timeout: 180_000 },
    () => {
      // 2000 buildPartition alternando certificate/password.
      const buildStart = performance.now()
      for (let i = 0; i < 2000; i += 1) {
        const authMethod = i % 2 === 0 ? ('certificate' as const) : ('password' as const)
        const partition = buildPartition({
          clientId: `client-${i}`,
          certificateId: authMethod === 'certificate' ? `cert-${i}` : null,
          authMethod,
        })
        expect(partition.startsWith('persist:client:')).toBe(true)
        if (authMethod === 'certificate') {
          expect(partition).toContain(`:cert:cert-${i}`)
        } else {
          expect(partition).not.toContain(':cert:')
        }
      }
      const buildMs = performance.now() - buildStart
      logMetric('partition.build_2000', { totalMs: buildMs })
      expect(buildMs).toBeLessThan(5_000)

      // 1000 inputs hostis: só a string vazia pode lançar (exatamente 1).
      const hostile = [
        'överção/\\evil|:x'.repeat(3),
        '  espaços  /barras\\ ',
        'a/b\\c:d|e"f\'g',
        '🔥unicode🔥över',
        'x'.repeat(200),
        `${'y'.repeat(120)}${'/'.repeat(80)}`,
        'normal-id_123',
        'ãõç/onde',
      ]
      let successes = 0
      let throws = 0
      const sanitizeStart = performance.now()
      for (let i = 0; i < 1000; i += 1) {
        const input = i === 500 ? '' : `${hostile[i % hostile.length]}#${i}`
        try {
          expect(sanitizePartitionSegment(input).length).toBeLessThanOrEqual(96)
          successes += 1
        } catch {
          throws += 1
        }
      }
      const sanitizeMs = performance.now() - sanitizeStart
      expect(throws).toBe(1)
      expect(successes).toBe(999)
      expect(sanitizePartitionSegment('x'.repeat(200))).toHaveLength(96)
      expect(() => sanitizePartitionSegment('')).toThrow()
      logMetric('partition.sanitize_1000', { totalMs: sanitizeMs, successes, throws })

      // 2000 reuse keys com material distinto — nenhuma colisão.
      const reuseKeys = new Set<string>()
      const reuseStart = performance.now()
      for (let i = 0; i < 2000; i += 1) {
        const authMethod = i % 3 === 0 ? ('certificate' as const) : ('password' as const)
        reuseKeys.add(
          authMethod === 'certificate'
            ? sessionReuseKey({
                clientId: `client-${i % 250}`,
                serviceId: `svc-${i % 40}`,
                authMethod,
                certificateId: `cert-${i}`,
              })
            : sessionReuseKey({
                clientId: `client-${i % 250}`,
                serviceId: `svc-${i % 40}`,
                authMethod,
                credentialId: `cred-${i}`,
              }),
        )
      }
      const reuseMs = performance.now() - reuseStart
      logMetric('partition.reuse_key_2000', { totalMs: reuseMs, uniqueCount: reuseKeys.size })
      expect(reuseKeys.size).toBe(2000)

      // 2000 round-trip isPartitionForClient: própria true, alheia false.
      const roundStart = performance.now()
      for (let i = 0; i < 2000; i += 1) {
        const authMethod = i % 2 === 0 ? ('certificate' as const) : ('password' as const)
        const partition = buildPartition({
          clientId: `client-${i}`,
          certificateId: authMethod === 'certificate' ? `cert-${i}` : null,
          authMethod,
        })
        expect(isPartitionForClient(partition, `client-${i}`)).toBe(true)
        expect(isPartitionForClient(partition, `other-client-${i}`)).toBe(false)
      }
      const roundMs = performance.now() - roundStart
      logMetric('partition.is_for_client_2000', { totalMs: roundMs })

      // Registry: 500 sessões/contextos, delete de 250.
      const registry = new SessionContextRegistry()
      const rng = mulberry32(2026)
      const hex = (n: number): string =>
        Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(rng() * 16)]).join('')
      const sessions = Array.from({ length: 500 }, () => ({}))
      const contexts: SessionContext[] = sessions.map((_, i) => {
        const authMethod = i % 2 === 0 ? ('certificate' as const) : ('password' as const)
        const certificateId = authMethod === 'certificate' ? `cert-${i}` : null
        return {
          sessionId: `session-${i}`,
          clientId: `client-${i}`,
          clientName: `Cliente ${i}`,
          clientDocument: makeValidCnpj(60000 + i),
          serviceId: `svc-${i % 40}`,
          serviceName: `Service ${i % 40}`,
          serviceSlug: `service-${i % 40}`,
          authMethod,
          certificateId,
          certificateLabel: certificateId ? `Cert ${i}` : null,
          certificateThumbprintSha256: certificateId ? hex(64) : null,
          certificateThumbprintSha1: certificateId ? hex(40) : null,
          allowedDomains: [`service-${i % 40}.example.gov.br`],
          partition: buildPartition({ clientId: `client-${i}`, certificateId, authMethod }),
        }
      })
      const registryStart = performance.now()
      for (let i = 0; i < 500; i += 1) registry.set(sessions[i]!, contexts[i]!)
      for (let i = 0; i < 500; i += 1) {
        expect(registry.has(sessions[i]!)).toBe(true)
        expect(registry.get(sessions[i]!)).toEqual(contexts[i])
      }
      for (let i = 0; i < 250; i += 1) registry.delete(sessions[i]!)
      for (let i = 0; i < 250; i += 1) expect(registry.has(sessions[i]!)).toBe(false)
      for (let i = 250; i < 500; i += 1) expect(registry.has(sessions[i]!)).toBe(true)
      const registryMs = performance.now() - registryStart
      logMetric('partition.registry_500', { totalMs: registryMs })
    },
  )
})
