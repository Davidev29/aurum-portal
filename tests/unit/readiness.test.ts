/**
 * Testes do motor de prontidão (`readiness.ts`).
 *
 * Duas camadas:
 *  - Sonda real executada via `jsdom` (a MESMA string avaliada na página) —
 *    cobre readyState, ocupadores visíveis, janela quieta e isenção de
 *    polling de verdade.
 *  - Fake programável de `RecipeTarget` — cobre o loop do processo main:
 *    retries, erro-duro, orçamento de tempo e estabilidade de URL.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import {
  probeReadiness,
  ReadinessProbeError,
  waitForReady,
} from '../../electron/main/recipes/readiness'
import type { RecipeTarget } from '../../electron/main/recipes/runner'

const require = createRequire(import.meta.url)
// jsdom não traz tipos próprios e não adicionamos @types/jsdom.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { JSDOM } = require('jsdom') as { JSDOM: any }

const PORTAL_URL = 'https://portal.exemplo.gov.br/login'

/** Relógio fake: avança apenas quando o código espera (determinístico). */
function makeClock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    /** sleep que avança o relógio fake — o loop sempre termina. */
    sleep: async (ms: number) => {
      t += ms
    },
  }
}

interface ResourceEntry {
  initiatorType: string
  name: string
  startTime: number
}

interface DomTarget {
  target: RecipeTarget
  setEntries: (entries: ResourceEntry[]) => void
}

/**
 * Avalia o probe de prontidão de VERDADE dentro de um documento jsdom.
 * `performance.now()` fixo em 10_000 ms — entradas com `startTime` maior que
 * `10_000 - quietMs` estão "na janela".
 */
function makeDomTarget(opts: {
  readyState?: string
  entries?: ResourceEntry[]
  bodyHtml?: string
  bodyAttrs?: string
}): DomTarget {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body${opts.bodyAttrs ? ` ${opts.bodyAttrs}` : ''}>${opts.bodyHtml ?? ''}</body></html>`,
    { url: PORTAL_URL, runScripts: 'outside-only', pretendToBeVisual: true },
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = dom.window as any
  Object.defineProperty(w.document, 'readyState', {
    value: opts.readyState ?? 'complete',
    configurable: true,
  })

  let entries = (opts.entries ?? []).slice()
  Object.defineProperty(w, 'performance', {
    configurable: true,
    value: {
      now: () => 10_000,
      getEntriesByType: (type: string) => (type === 'resource' ? entries.slice() : []),
    },
  })
  w.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: 240,
      height: 32,
      top: 10,
      left: 10,
      right: 250,
      bottom: 42,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    }
  }

  return {
    target: {
      async executeJavaScript<T = unknown>(code: string): Promise<T> {
        return w.eval(code) as T
      },
      async loadURL() {},
      getURL: () => w.location.href as string,
      isDestroyed: () => false,
      stop() {},
    },
    setEntries: (next: ResourceEntry[]) => {
      entries = next.slice()
    },
  }
}

/** Fake programável: decide o payload de cada chamada de evaluate. */
function makeScriptedTarget(opts: {
  url?: string | (() => string)
  probe?: (callIndex: number) => unknown
}) {
  let probeCalls = 0
  const target: RecipeTarget & { probeCalls: () => number } = {
    async executeJavaScript<T = unknown>(_code: string): Promise<T> {
      const raw = opts.probe ? opts.probe(probeCalls) : undefined
      probeCalls += 1
      return raw as T
    },
    async loadURL() {},
    getURL: () => (typeof opts.url === 'function' ? opts.url() : (opts.url ?? PORTAL_URL)),
    isDestroyed: () => false,
    stop() {},
    probeCalls: () => probeCalls,
  }
  return target
}

const quiet = (over: Partial<ResourceEntry> = {}): ResourceEntry => ({
  initiatorType: 'script',
  name: 'https://portal.exemplo.gov.br/app.js',
  startTime: 9_500,
  ...over,
})

describe('waitForReady — sonda real (jsdom)', () => {
  it('readyState completo + rede quieta → ready:true na primeira amostra', async () => {
    const { target } = makeDomTarget({ entries: [] })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
    expect(report.urlStable).toBe(true)
    expect(report.busyVisible).toBe(false)
    expect(report.pendingResources).toBe(0)
    expect(report.readyState).toBe('complete')
    expect(report.detail).toContain('estável')
    expect(report.waitedMs).toBe(0)
  })

  it('readyState "interactive" com rede quieta NÃO está pronto (ordenação dos sinais)', async () => {
    const { target } = makeDomTarget({ readyState: 'interactive', entries: [] })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 1_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.readyState).toBe('interactive')
    expect(report.detail).toContain('carregamento ainda não terminou')
  })

  it('readyState "loading" nunca está pronto', async () => {
    const { target } = makeDomTarget({ readyState: 'loading', entries: [] })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.readyState).toBe('loading')
  })

  it('ocupador visível (.loading) → não pronto até sumir', async () => {
    const { target } = makeDomTarget({
      entries: [],
      bodyHtml: '<div class="loading">Carregando…</div>',
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.busyVisible).toBe(true)
    expect(report.detail).toContain('indicador de carregamento')
  })

  it('body[aria-busy="true"] visível → não pronto', async () => {
    const { target } = makeDomTarget({ entries: [], bodyAttrs: 'aria-busy="true"' })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.busyVisible).toBe(true)
  })

  it('ocupador oculto (display:none) NÃO conta — página pronta', async () => {
    const { target } = makeDomTarget({
      entries: [],
      bodyHtml: '<div class="loading" style="display:none">oculto</div>',
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
  })

  it('poll eterno: 3 recursos /api/heartbeat (XHR+fetch) → isentos → pronto', async () => {
    const heartbeat = (over: Partial<ResourceEntry>): ResourceEntry => ({
      initiatorType: 'xmlhttprequest',
      name: 'https://portal.exemplo.gov.br/api/heartbeat',
      startTime: 9_600,
      ...over,
    })
    const { target } = makeDomTarget({
      entries: [
        heartbeat({ name: 'https://portal.exemplo.gov.br/api/heartbeat' }),
        heartbeat({ name: 'https://portal.exemplo.gov.br/api/poll?from=1', startTime: 9_800 }),
        heartbeat({
          initiatorType: 'fetch',
          name: 'https://portal.exemplo.gov.br/api/notifications',
          startTime: 9_900,
        }),
      ],
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
    expect(report.pendingResources).toBe(0)
  })

  it('recurso XHR fora do padrão de polling (/api/relatorio) → não pronto', async () => {
    const { target } = makeDomTarget({
      entries: [
        {
          initiatorType: 'xmlhttprequest',
          name: 'https://portal.exemplo.gov.br/api/relatorio',
          startTime: 9_700,
        },
      ],
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.pendingResources).toBe(1)
    expect(report.detail).toContain('rede ainda está ativa')
  })

  it('script "/assets/poll.js" NÃO é isento — a isenção vale só para XHR/fetch', async () => {
    const { target } = makeDomTarget({
      entries: [quiet({ name: 'https://portal.exemplo.gov.br/assets/poll.js' })],
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 500,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.pendingResources).toBe(1)
  })

  it('script na janela bloqueia até CESSAR (não pronto até cessar)', async () => {
    const { target, setEntries } = makeDomTarget({
      entries: [quiet({ startTime: 9_900 })],
    })
    let sample = 0
    const clock = makeClock()
    const sleep = async (ms: number) => {
      sample += 1
      if (sample === 2) setEntries([]) // depois de 2 amostras "carregando", cessa
      await clock.sleep(ms)
    }
    const report = await waitForReady(target, {
      timeoutMs: 5_000,
      sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
    expect(report.waitedMs).toBeGreaterThan(0)
  })

  it('silêncio ordering: recurso começado FORA da janela quieta não bloqueia', async () => {
    const { target } = makeDomTarget({
      entries: [quiet({ startTime: 5_000 })], // 5 s atrás, bem antes da janela de 800 ms
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      quietMs: 800,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
  })
})

describe('waitForReady — controle do loop (fake programável)', () => {
  const readySample = {
    readyState: 'complete',
    busyVisible: false,
    recentResourceCount: 0,
    href: PORTAL_URL,
  }

  it('URL mudando entre amostras → urlStable:false → não pronto até estabilizar', async () => {
    // A cada amostra a URL alterna — nunca há duas amostras iguais seguidas.
    let call = 0
    const hrefs = ['https://portal.exemplo.gov.br/b', 'https://portal.exemplo.gov.br/c']
    const target = makeScriptedTarget({
      url: 'https://portal.exemplo.gov.br/a',
      probe: () => ({ ...readySample, href: hrefs[call++ % 2] as string }),
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 1_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.urlStable).toBe(false)
    expect(report.detail).toContain('URL')
  })

  it('URL estável entre amostras (e igual à de entrada) → pronto', async () => {
    const target = makeScriptedTarget({ url: PORTAL_URL, probe: () => readySample })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 1_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
    expect(report.urlStable).toBe(true)
  })

  it('href do probe diferente do getURL() de entrada → 1ª amostra instável; amostras seguintes estáveis → pronto', async () => {
    // A entrada aponta para a URL antiga; o documento está numa página nova e
    // assentada — a estabilidade vale a partir da 2ª amostra da sonda.
    const target = makeScriptedTarget({
      url: PORTAL_URL,
      probe: () => ({ ...readySample, href: 'https://portal.exemplo.gov.br/redirect' }),
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
  })

  it('safeExecute devolvendo null 1× → retry após 400 ms e segue', async () => {
    let call = 0
    const target = makeScriptedTarget({
      probe: () => {
        call += 1
        return call === 1 ? null : readySample
      },
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
    expect(target.probeCalls()).toBe(2)
  })

  it('safeExecute devolvendo null 2× consecutivas → ReadinessProbeError', async () => {
    const target = makeScriptedTarget({ probe: () => null })
    const clock = makeClock()
    await expect(
      waitForReady(target, { timeoutMs: 5_000, sleep: clock.sleep, now: clock.now }),
    ).rejects.toBeInstanceOf(ReadinessProbeError)
    await expect(
      waitForReady(target, { timeoutMs: 5_000, sleep: clock.sleep, now: clock.now }),
    ).rejects.toThrow(/duas sondas/)
  })

  it('safeExecute rejeitando (documento destruído) conta como sonda falha', async () => {
    const target: RecipeTarget = {
      async executeJavaScript() {
        throw new Error('context destroyed')
      },
      async loadURL() {},
      getURL: () => PORTAL_URL,
      isDestroyed: () => false,
    }
    const clock = makeClock()
    await expect(
      waitForReady(target, { timeoutMs: 5_000, sleep: clock.sleep, now: clock.now }),
    ).rejects.toBeInstanceOf(ReadinessProbeError)
  })

  it('falha intercalada (null) não-consecutiva é retentada sem erro-duro', async () => {
    const seq: Array<unknown> = [null, readySample]
    let call = 0
    const target = makeScriptedTarget({
      probe: () => seq[Math.min(call++, seq.length - 1)],
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 2_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
  })

  it('timeoutMs=0 → ready:false sem sequer sondar', async () => {
    const target = makeScriptedTarget({ probe: () => readySample })
    const report = await waitForReady(target, { timeoutMs: 0 })
    expect(report.ready).toBe(false)
    expect(report.pendingResources).toBe(0)
    expect(target.probeCalls()).toBe(0)
  })

  it('timeout esgotado → ready:false, diagnóstico da última amostra, PT-BR', async () => {
    const target = makeScriptedTarget({
      probe: () => ({
        readyState: 'interactive',
        busyVisible: false,
        recentResourceCount: 7,
        href: PORTAL_URL,
      }),
    })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 1_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(false)
    expect(report.waitedMs).toBe(1_000)
    expect(report.pendingResources).toBe(7)
    expect(report.readyState).toBe('interactive')
    expect(report.detail).toMatch(/A página não estabilizou a tempo/)
  })

  it('compatibilidade Fase 1: evaluate concluiu mas payload irreconhecível → prossegue (sem prontidão)', async () => {
    // Fake legado que responde { ok: true, ... } a qualquer script (sem a forma
    // da sonda). Impossível em páginas reais; documenta o fallback deliberado.
    const target = makeScriptedTarget({ probe: () => ({ ok: true, selector: null, detail: 'ok' }) })
    const clock = makeClock()
    const report = await waitForReady(target, {
      timeoutMs: 1_000,
      sleep: clock.sleep,
      now: clock.now,
    })
    expect(report.ready).toBe(true)
    expect(report.detail).toContain('inesperada')
  })
})

describe('probeReadiness — amostra única', () => {
  it('devolve a sonda normalizada (recognized:true) sem fazer loop', async () => {
    const target = makeDomTarget({ entries: [] }).target
    const sample = await probeReadiness(target, { quietMs: 800 })
    expect(sample).not.toBeNull()
    expect(sample?.readyState).toBe('complete')
    expect(sample?.recognized).toBe(true)
  })

  it('devolve null quando o evaluate falha (sem lançar)', async () => {
    const target = makeScriptedTarget({ probe: () => null })
    const sample = await probeReadiness(target, { timeoutMs: 1_000 })
    expect(sample).toBeNull()
  })
})
