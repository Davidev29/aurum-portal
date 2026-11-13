/**
 * Motor de prontidão de página (Fase 2 do plano Gravação Assistida).
 *
 * Regra de ouro (decisão fechada nº 5 do produto): página estabilizou → agir;
 * página nunca estabilizou → PAUSAR e devolver para o humano. Nunca chutar.
 *
 * O módulo é ADITIVO ao runner (D8): cada passo do robô agora percorre
 * esperar pronto → verificar pré-condição → agir → verificar pós-condição.
 * A sonda é in-page (`PerformanceResourceTiming` + `document.readyState` +
 * seletores de "ocupador" visível), com o loop de espera no processo main.
 *
 * Sinais NÃO usados (deliberado): `window.onload` (portais ASP.NET/PrimeFaces
 * nunca disparam `load` de forma confiável) e `session.webRequest` no hot path
 * (mudaria o comportamento de todas as sessões — D9).
 *
 * Calibração (telemetria real, 2026-11-13, páginas públicas de login):
 * e-CAC nav 2761ms/23 recursos · gov.br SSO 1740ms/59 recursos ·
 * Redesim→gov.br SPA 5230ms/34 recursos — todas chegaram a
 * `readyState 'complete'` com 0 busy visíveis em repouso. Por isso a janela
 * quieta default de 800 ms e a isenção de polling (XHR/fetch cujo nome casa
 * /poll|refresh|heartbeat|ping|status|events|notification/i) ficam mantidas —
 * os padrões são os observados no tráfego de revalidação gov.br.
 */
import type { RecipeTarget } from './runner'
import { safeExecute } from './runner'

export interface ReadinessOptions {
  /** Janela quieta em ms: nenhum recurso (não-isento) pode ter começado nela. Default 800. */
  quietMs?: number
  /** Teto da espera inteira (incluindo retries de probe). Default 12_000; cap 30_000. */
  timeoutMs?: number
  /** Seletores de "ocupador" EXTRAS da receita (os defaults sempre valem). */
  busySelectors?: string[]
  /** sleep injetável (testes). */
  sleep?: (ms: number) => Promise<void>
  /** now injetável (testes). */
  now?: () => number
}

export interface ReadinessReport {
  ready: boolean
  /** 'complete' | 'interactive' | 'loading' | 'unknown (probe falhou)' */
  readyState: string
  urlStable: boolean
  busyVisible: boolean
  /** Quantos recursos não-isentos começaram na janela quieta (diagnóstico). */
  pendingResources: number
  waitedMs: number
  /** Sempre PT-BR, sempre SEM valores da página. */
  detail: string
}

export interface ReadinessProbeSample {
  readyState: string
  busyVisible: boolean
  /** Recursos (não-isentos) iniciados na janela quieta. */
  recentResourceCount: number
  /** `location.href` visto pelo documento (estabilidade entre amostras). */
  href: string
  /**
   * `true` quando o objeto tem a forma da nossa sonda (páginas reais — o
   * probe sempre devolve `readyState`/`recentResourceCount`). `false` quando
   * o evaluate CONCLUIU e devolveu um objeto de outra forma — impossível em
   * páginas reais; existe apenas em fakes de teste escritos antes da Fase 2.
   */
  recognized: boolean
}

/** Falha DURA = probe impossível 2× consecutivas (página destruída/ocupada). */
export class ReadinessProbeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReadinessProbeError'
  }
}

const DEFAULT_QUIET_MS = 800
const DEFAULT_TIMEOUT_MS = 12_000
const MAX_TIMEOUT_MS = 30_000
const PROBE_TIMEOUT_MS = 4_000
const PROBE_RETRY_DELAY_MS = 400
const SAMPLE_INTERVAL_MS = 100

/**
 * Ocupadores default. Captchas/2FA NUNCA contam como "busy" (são interação
 * humana, não progresso de carregamento) — por isso ficam de fora.
 * Visibilidade = mesma regra do core (`__pvVisible`: computed style + rect).
 */
const DEFAULT_BUSY_SELECTORS = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  '[role="status"][aria-live]',
  '.spinner',
  '.loading',
  '.carregando',
  '[data-loading="true"]',
  'progress',
  'body[aria-busy="true"]',
] as const

/**
 * Sonda in-page auto-contida. Os parâmetros entram via JSON.stringify nos
 * dois tokens (`__BUSY_SELECTORS__`, `__QUIET_MS__`) — nada de valores da
 * página cruza para fora do documento. Deve retornar um objeto plano
 * `{ readyState, busyVisible, recentResourceCount, href }` ou lançar
 * (o `safeExecute` converte exceção/rejeição em `null`).
 */
const PROBE = String.raw`
(function () {
  var busySelectors = __BUSY_SELECTORS__;
  var quietMs = __QUIET_MS__;

  var isVisible = function (el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  var readyState = 'unknown';
  try { readyState = String(document.readyState || 'unknown'); } catch (_) {}

  var busyVisible = false;
  for (var i = 0; i < busySelectors.length && !busyVisible; i += 1) {
    var nodes;
    try { nodes = document.querySelectorAll(busySelectors[i]); } catch (_) { continue; }
    for (var j = 0; j < nodes.length; j += 1) {
      if (isVisible(nodes[j])) { busyVisible = true; break; }
    }
  }

  var nowMs = 0;
  try { nowMs = performance.now(); } catch (_) { nowMs = Date.now(); }

  var POLL_NOISE = /poll|refresh|heartbeat|ping|status|events|notification/i;
  var entries = [];
  try { entries = performance.getEntriesByType('resource') || []; } catch (_) { entries = []; }
  var recent = 0;
  for (var k = 0; k < entries.length; k += 1) {
    var entry = entries[k];
    if (!entry) continue;
    var start = Number(entry.startTime) || 0;
    if (!(start > nowMs - quietMs)) continue;
    var type = String(entry.initiatorType || '').toLowerCase();
    var name = String(entry.name || '');
    var isPolling = (type === 'xmlhttprequest' || type === 'fetch') && POLL_NOISE.test(name);
    if (isPolling) continue;
    recent += 1;
  }

  var href = '';
  try { href = String((window.location && window.location.href) || ''); } catch (_) {}

  return {
    readyState: readyState,
    busyVisible: busyVisible,
    recentResourceCount: recent,
    href: href,
  };
})()
`

function buildReadinessProbeScript(busySelectors: string[], quietMs: number): string {
  return PROBE.replace('__BUSY_SELECTORS__', JSON.stringify(busySelectors)).replace(
    '__QUIET_MS__',
    JSON.stringify(Math.max(0, Math.floor(quietMs))),
  )
}

function clampQuietMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_QUIET_MS
  // 60_000 = mesmo teto do campo `readinessMs` no schema da receita.
  return Math.min(Math.max(Math.floor(value), 0), 60_000)
}

function clampTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(Math.floor(value), 0), MAX_TIMEOUT_MS)
}

function clampProbeTimeoutMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return PROBE_TIMEOUT_MS
  return Math.min(Math.max(Math.floor(value), 100), PROBE_TIMEOUT_MS)
}

function mergedBusySelectors(extra: string[] | undefined): string[] {
  const merged: string[] = []
  for (const selector of [...DEFAULT_BUSY_SELECTORS, ...(extra ?? [])]) {
    if (typeof selector === 'string' && selector.trim().length > 0 && !merged.includes(selector)) {
      merged.push(selector)
    }
  }
  return merged
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function safeGetUrl(target: RecipeTarget): string | null {
  try {
    const url = target.getURL()
    return typeof url === 'string' && url.length > 0 ? url : null
  } catch {
    return null
  }
}

/**
 * Normaliza o retorno da sonda. Dois caminhos, deliberados:
 *
 * - Forma da sonda (campos presentes): sample completo, com `recognized: true`.
 * - Objeto que NÃO é a sonda (nenhum dos campos): `recognized: false`. O
 *   evaluate CONCLUIU e o documento respondeu — só que de outra forma. Este
 *   caso não existe em páginas reais (o probe sempre devolve o objeto
 *   completo; se o documento morrer, o evaluate rejeita e o `safeExecute`
 *   devolve `null`, caindo na trilha de retry/erro-duro). Existe apenas em
 *   fakes de teste legados — e aí a página respondeu, então mantemos o
 *   comportamento da Fase 1 (sem prontidão) em vez de PAUSAR para sempre.
 */
function normalizeSample(raw: unknown): ReadinessProbeSample | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const href = typeof record.href === 'string' ? record.href : ''

  const hasReadyState = typeof record.readyState === 'string' && record.readyState.length > 0
  const hasResourceCount = typeof record.recentResourceCount !== 'undefined'
  if (!hasReadyState && !hasResourceCount) {
    return {
      readyState: 'unknown',
      busyVisible: false,
      recentResourceCount: 0,
      href,
      recognized: false,
    }
  }

  const readyState = hasReadyState ? (record.readyState as string) : 'unknown'
  const busyVisible = record.busyVisible === true
  const rawCount = Number(record.recentResourceCount)
  const recentResourceCount = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0
  return { readyState, busyVisible, recentResourceCount, href, recognized: true }
}

export interface ProbeReadinessOptions {
  quietMs?: number
  busySelectors?: string[]
  /** Timeout por amostra (default 4_000). */
  timeoutMs?: number
}

/**
 * UMA amostra de prontidão (nunca faz loop). Devolve `null` quando o probe
 * é impossível (página ocupada/destruída/evaluate suspenso) — o chamador
 * decide entre retry, pausar ou seguir. Usado pelo agente para uma checagem
 * mínima antes do OBSERVE, que nunca pode bloquear o ciclo.
 */
export async function probeReadiness(
  target: RecipeTarget,
  opts?: ProbeReadinessOptions,
): Promise<ReadinessProbeSample | null> {
  const quietMs = clampQuietMs(opts?.quietMs)
  const busySelectors = mergedBusySelectors(opts?.busySelectors)
  const timeoutMs = clampProbeTimeoutMs(opts?.timeoutMs)
  const raw = await safeExecute<unknown>(
    target,
    buildReadinessProbeScript(busySelectors, quietMs),
    timeoutMs,
  )
  return normalizeSample(raw)
}

/**
 * Aguarda até a página estar pronta para o próximo passo do robô.
 *
 * Pronta = (1) `document.readyState === 'complete'`; (2) nenhum ocupador
 * visível; (3) janela quieta — nenhum `PerformanceResourceTiming` (exceto
 * ruído de polling XHR/fetch) com `startTime` nos últimos `quietMs`;
 * (4) URL estável entre a amostra atual e a anterior.
 *
 * Loop no processo main (a página pode morrer — `safeExecute` devolve null;
 * uma nova tentativa após 400 ms e, persistindo, `ReadinessProbeError`).
 * O orçamento é o MAIOR entre o relógio de parede (`now`) e o tempo
 * acumulado de `sleep` — assim `sleep` instantâneo injetado em testes ainda
 * esgota `timeoutMs` e a espera sempre termina.
 */
export async function waitForReady(
  target: RecipeTarget,
  opts: ReadinessOptions = {},
): Promise<ReadinessReport> {
  const quietMs = clampQuietMs(opts.quietMs)
  const timeoutMs = clampTimeoutMs(opts.timeoutMs)
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now

  const startedAt = now()
  let sleptMs = 0
  const ownSleep = async (ms: number): Promise<void> => {
    sleptMs += ms
    await sleep(ms)
  }
  const elapsed = (): number => Math.max(now() - startedAt, sleptMs)

  // Estabilidade de URL: a amostra de entrada é o `getURL()` do processo main
  // (§5.1.4 do plano); as amostras seguintes comparam o href visto pela sonda.
  // Sem getURL utilizável, a primeira amostra conta como estável até prova em
  // contrário (não há contra o que comparar).
  let previousHref: string | null = safeGetUrl(target)
  let previousSampleHref: string | null = null

  let consecutiveProbeFailures = 0
  let lastSample: ReadinessProbeSample | null = null
  let urlStable = true
  let ready = false
  /** true quando a prontidão foi liberada pelo caminho de compatibilidade (ver normalizeSample). */
  let compatReady = false

  for (;;) {
    if (elapsed() >= timeoutMs) break

    const sample = await probeReadiness(target, {
      quietMs,
      busySelectors: opts.busySelectors,
      timeoutMs: PROBE_TIMEOUT_MS,
    })

    if (!sample) {
      consecutiveProbeFailures += 1
      if (consecutiveProbeFailures >= 2) {
        throw new ReadinessProbeError(
          'Não foi possível avaliar o estado da página (duas sondas consecutivas falharam).',
        )
      }
      await ownSleep(PROBE_RETRY_DELAY_MS)
      continue
    }
    consecutiveProbeFailures = 0

    if (sample.recognized === false) {
      // Compatibilidade Fase 1/legado (ver normalizeSample): o documento
      // respondeu, mas não a nossa forma. Prossegue sem verificação de
      // prontidão — exatamente como se comportava antes da Fase 2.
      lastSample = { ...sample, readyState: 'unknown' }
      ready = true
      compatReady = true
      break
    }

    const sampleHref = sample.href || previousHref || ''
    const hrefMoved =
      (previousHref !== null && sampleHref !== previousHref) ||
      (previousSampleHref !== null && sample.href !== '' && sample.href !== previousSampleHref)
    urlStable = !hrefMoved
    previousHref = sampleHref
    if (sample.href) previousSampleHref = sample.href
    lastSample = sample

    const quiet = sample.recentResourceCount === 0
    if (sample.readyState === 'complete' && !sample.busyVisible && quiet && urlStable) {
      ready = true
      break
    }

    const remaining = timeoutMs - elapsed()
    if (remaining <= 0) break
    await ownSleep(Math.min(SAMPLE_INTERVAL_MS, remaining))
  }

  const waitedMs = Math.max(0, Math.round(elapsed()))

  if (ready && lastSample) {
    if (compatReady) {
      return {
        ready: true,
        readyState: 'unknown',
        urlStable: true,
        busyVisible: false,
        pendingResources: 0,
        waitedMs,
        detail:
          'O documento respondeu à sondagem de forma inesperada; prosseguindo sem verificação de prontidão.',
      }
    }
    return {
      ready: true,
      readyState: lastSample.readyState,
      urlStable: true,
      busyVisible: false,
      pendingResources: 0,
      waitedMs,
      detail: 'Página estável: carregamento completo, sem indicadores de progresso e rede quieta.',
    }
  }

  const reason = !lastSample
    ? 'a página não respondeu à sondagem'
    : lastSample.readyState !== 'complete'
      ? 'o carregamento ainda não terminou'
      : lastSample.busyVisible
        ? 'há um indicador de carregamento visível'
        : lastSample.recentResourceCount > 0
          ? 'a rede ainda está ativa'
          : !urlStable
            ? 'a URL ainda está mudando'
            : 'o carregamento ainda não terminou'

  return {
    ready: false,
    readyState: lastSample?.readyState ?? 'unknown',
    urlStable,
    busyVisible: lastSample?.busyVisible ?? false,
    pendingResources: lastSample?.recentResourceCount ?? 0,
    waitedMs,
    detail: `A página não estabilizou a tempo: ${reason}.`,
  }
}
