import type { RecipeDefinition, RecipeStep } from '../../../shared/recipe'
import { resolveRecipeTemplate } from '../../../shared/recipe'
import { isAllowedHost, isGovernmentHost } from '../../../shared/network'
import type { RecipeActionResult, RecipeValues } from './core'
import {
  buildActionScript,
  buildAutoSubmitScript,
  buildDetectScript,
  buildPostLoginScript,
  buildWaitScript,
} from './core'
import { redactUrl } from '../security/redaction'

export interface RecipeTarget {
  executeJavaScript<T = unknown>(code: string): Promise<T>
  loadURL(url: string): Promise<void> | void
  getURL(): string
  isDestroyed(): boolean
  /**
   * Aborta os carregamentos pendentes da página (webContents.stop()).
   * Chamado quando um evaluate excede o limite de tempo (o Electron suspende
   * o evaluate até a página "terminar de carregar" — alguns portais nunca
   * disparam o evento `load` e a avaliação ficaria suspensa para sempre).
   */
  stop?(): void
}

export type RecipeRunStatus = 'authenticated' | 'awaiting_login' | 'manual' | 'error'

/**
 * Códigos estruturados de falha do runner (C7 do plano §5.4). Substituem o
 * acoplamento por mensagem. O fallback para o agente inteligente depende
 * apenas de `element-not-found` no passo 0 — ver `fallback.ts`.
 */
export type RecipeFailureCode =
  | 'element-not-found'
  | 'selector-not-found'
  | 'readiness-timeout'
  | 'post-condition-failed'
  | 'probe-error'
  | 'budget-exhausted'

export interface RecipeRunResult {
  status: RecipeRunStatus
  message: string
  failedStep: number | null
  captchaDetected: boolean
  twoFactorDetected: boolean
  lastUrl: string
  failureCode: RecipeFailureCode | null
}

export interface RunRecipeOptions {
  recipe: RecipeDefinition
  values: RecipeValues
  target: RecipeTarget
  allowedDomains: string[]
  onProgress?: (stepIndex: number, total: number) => void
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Executa um script na página com limite de tempo duro. Se o evaluate ficar
 * suspenso (o Electron o suspende até a página parar de carregar, e alguns
 * portais nunca emitem `load`), a página recebe `stop()` — que destrói ou
 * aborta o contexto pendente — e o passo falha como `null` em vez de travar
 * a receita para sempre.
 */
export async function safeExecute<T>(
  target: RecipeTarget,
  script: string,
  timeoutMs = 30_000,
): Promise<T | null> {
  const TIMED_OUT = Symbol('timed-out')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const outcome = await Promise.race([
      target.executeJavaScript<T>(script).then(
        (value) => ({ kind: 'ok' as const, value }),
        () => ({ kind: 'ok' as const, value: null }),
      ),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), Math.max(100, timeoutMs))
      }),
    ])
    if (outcome === TIMED_OUT) {
      try {
        target.stop?.()
      } catch {
        // A página pode já estar destruída.
      }
      return null
    }
    return outcome.value
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function validateGoto(step: RecipeStep, allowedDomains: string[]): string | null {
  if (!step.url) return 'Passo goto sem URL'
  let url: URL
  try {
    url = new URL(step.url)
  } catch {
    return 'URL de goto invalida'
  }
  if (url.protocol !== 'https:') return 'Somente HTTPS e permitido nas receitas'
  if (!isGovernmentHost(url.hostname) && !isAllowedHost(url.hostname, allowedDomains)) {
    return 'URL de goto fora da allowlist do servico'
  }
  return null
}

export async function detectInterstitial(
  recipe: RecipeDefinition,
  target: RecipeTarget,
): Promise<{ captcha: boolean; twoFactor: boolean }> {
  const hasCaptchaSelectors = Boolean(recipe.captchaSelectors?.length)
  const hasTwoFactorSelectors = Boolean(recipe.twoFactorSelectors?.length)
  if (!hasCaptchaSelectors && !hasTwoFactorSelectors) return { captcha: false, twoFactor: false }
  const result = await safeExecute<{ captcha?: boolean; twoFactor?: boolean }>(
    target,
    buildDetectScript(recipe),
  )
  return { captcha: result?.captcha === true, twoFactor: result?.twoFactor === true }
}

/**
 * Aguarda (no processo main, sem injeção de script) até que a URL atual
 * satisfaça os filtros de inclusão/exclusão. Imune à destruição do contexto
 * da página (diferente de um waitFor injetado, que morre com o documento).
 */
export async function waitForUrlMatch(
  target: Pick<RecipeTarget, 'getURL' | 'isDestroyed'>,
  step: Pick<RecipeStep, 'urlIncludes' | 'urlExcludes' | 'timeoutMs'>,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<{ ok: boolean; detail: string }> {
  const includes = (step.urlIncludes ?? []).map((needle) => needle.toLowerCase())
  const excludes = (step.urlExcludes ?? []).map((needle) => needle.toLowerCase())
  const passes = (href: string): boolean => {
    const url = href.toLowerCase()
    if (includes.length > 0 && !includes.some((needle) => url.includes(needle))) return false
    if (excludes.some((needle) => url.includes(needle))) return false
    return true
  }
  const deadline = Date.now() + Math.min(Math.max(step.timeoutMs ?? 10_000, 100), 120_000)
  while (Date.now() < deadline) {
    if (target.isDestroyed()) {
      return { ok: false, detail: 'sessao encerrada durante a espera de URL' }
    }
    const href = target.getURL()
    if (passes(href)) {
      return { ok: true, detail: `url atingida: ${href.slice(0, 120)}` }
    }
    await sleep(100)
  }
  return { ok: false, detail: 'timeout aguardando URL esperada' }
}

/**
 * Pós-condição simples (Fase 1): confirmar que a URL passou a conter um dos
 * `expectedAfter.urlIncludes` — ou, como alternativa, que um marcador
 * `expectedAfter.selectors` existe — dentro de uma janela curta. Rodado
 * apenas quando o passo traz `expectedAfter` (receita gravada). Polling no
 * processo main (URL) ou em páginas (marcador), nunca chute.
 */
export async function verifyExpectedAfter(
  step: Pick<RecipeStep, 'expectedAfter' | 'label'>,
  target: RecipeTarget,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<{ ok: boolean; detail: string }> {
  const guard = step.expectedAfter
  if (!guard) return { ok: true, detail: 'sem pós-condição' }
  const timeoutMs = Math.min(Math.max(guard.timeoutMs ?? 8_000, 500), 60_000)

  if (guard.urlIncludes && guard.urlIncludes.length > 0) {
    return waitForUrlMatch(target, { urlIncludes: guard.urlIncludes, timeoutMs }, sleep)
  }

  if (guard.selectors && guard.selectors.length > 0) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (target.isDestroyed()) {
        return { ok: false, detail: 'sessao encerrada durante a pos-condicao' }
      }
      const probe = await safeExecute<RecipeActionResult>(
        target,
        buildWaitScript(guard.selectors, 1_500),
        3_000,
      )
      if (probe?.ok) return { ok: true, detail: 'marcador pós-ação encontrado' }
      await sleep(250)
    }
    return { ok: false, detail: 'timeout aguardando marcador pós-ação' }
  }

  return { ok: true, detail: 'pós-condição vazia' }
}

export async function runRecipe(options: RunRecipeOptions): Promise<RecipeRunResult> {
  const { recipe, values, target, allowedDomains } = options
  const sleep = options.sleep ?? defaultSleep
  let currentUrl = target.getURL()

  if (recipe.steps.length === 0) {
    return {
      status: 'awaiting_login',
      message: 'Receita sem passos; navegue manualmente.',
      failedStep: null,
      captchaDetected: false,
      twoFactorDetected: false,
      lastUrl: currentUrl,
      failureCode: null,
    }
  }

  for (let index = 0; index < recipe.steps.length; index += 1) {
    if (target.isDestroyed()) {
      return {
        status: 'error',
        message: 'A sessao foi encerrada durante a receita.',
        failedStep: index,
        captchaDetected: false,
        twoFactorDetected: false,
        lastUrl: currentUrl,
        failureCode: 'probe-error',
      }
    }
    const step = recipe.steps[index] as RecipeStep
    options.onProgress?.(index, recipe.steps.length)

    const interstitial = await detectInterstitial(recipe, target)
    if (interstitial.captcha || interstitial.twoFactor) {
      return {
        status: 'manual',
        message: interstitial.captcha
          ? 'CAPTCHA detectado. Conclua manualmente no portal.'
          : 'Verificacao em duas etapas detectada. Conclua manualmente no portal.',
        failedStep: index,
        captchaDetected: interstitial.captcha,
        twoFactorDetected: interstitial.twoFactor,
        lastUrl: target.getURL(),
        failureCode: null,
      }
    }

    if (step.action === 'goto') {
      const validation = validateGoto(step, allowedDomains)
      if (validation) {
        return {
          status: 'manual',
          message: validation,
          failedStep: index,
          captchaDetected: false,
          twoFactorDetected: false,
          lastUrl: currentUrl,
          failureCode: null,
        }
      }
      try {
        await target.loadURL(step.url as string)
        currentUrl = target.getURL()
      } catch {
        return {
          status: 'error',
          message: 'Falha ao navegar para a URL da receita.',
          failedStep: index,
          captchaDetected: false,
          twoFactorDetected: false,
          lastUrl: redactUrl(step.url as string),
          failureCode: 'probe-error',
        }
      }
      continue
    }

    if (step.action === 'sleep') {
      await sleep(Math.min(step.timeoutMs ?? 1000, 30_000))
      continue
    }

    if (step.action === 'waitForURL') {
      const waitResult = await waitForUrlMatch(target, step, sleep)
      if (!waitResult.ok) {
        if (step.optional) {
          options.onProgress?.(index, recipe.steps.length)
          continue
        }
        return {
          status: 'manual',
          message: `Receita parou no passo ${index + 1}: ${waitResult.detail}`,
          failedStep: index,
          captchaDetected: false,
          twoFactorDetected: false,
          lastUrl: target.getURL(),
          failureCode: 'element-not-found',
        }
      }
      continue
    }

    // Sessão por certificado não tem credencial para preencher. Pular o passo
    // em vez de falhar com campo vazio (ex.: abrir Redesim, cuja receita é
    // de senha, com certificado).
    if (step.action === 'fill') {
      const resolved = resolveRecipeTemplate(step.value ?? '', values)
      if (!resolved) continue
    }

    const beforeUrl = target.getURL()
    const script = buildActionScript(step, values)
    let result = await safeExecute<RecipeActionResult>(target, script, step.timeoutMs)
    if (!result) {
      await sleep(200)
      const afterUrl = target.getURL()
      if (afterUrl !== beforeUrl && (step.action === 'click' || step.action === 'press')) {
        result = { ok: true, selector: null, detail: 'navegacao iniciada' }
      }
    }
    if (!result?.ok) {
      if (step.optional) continue
      return {
        status: 'manual',
        message: `Receita parou no passo ${index + 1}: ${result?.detail ?? 'a pagina nao respondeu no tempo esperado'}`,
        failedStep: index,
        captchaDetected: false,
        twoFactorDetected: false,
        lastUrl: target.getURL(),
        failureCode: 'element-not-found',
      }
    }
    currentUrl = target.getURL()

    // Pós-condição (Fase 1, simples): só se o passo traz `expectedAfter`
    // (gravado pela Gravação Assistida). Receitas builtin/auto não trazem —
    // comportamento inalterado. Falha ⇒ PAUSAR (nunca chutar).
    if (step.expectedAfter) {
      const check = await verifyExpectedAfter(step, target, sleep)
      if (!check.ok) {
        if (step.optional) continue
        return {
          status: 'manual',
          message: `Após '${step.label ?? 'ação'}' o portal não chegou onde esperávamos. Pausamos para você.`,
          failedStep: index,
          captchaDetected: false,
          twoFactorDetected: false,
          lastUrl: target.getURL(),
          failureCode: 'post-condition-failed',
        }
      }
    }
  }

  if (recipe.autoSubmit) {
    const submit = await safeExecute<RecipeActionResult>(target, buildAutoSubmitScript())
    if (!submit?.ok) {
      return {
        status: 'manual',
        message: 'Nao foi possivel enviar o formulario automaticamente.',
        failedStep: recipe.steps.length - 1,
        captchaDetected: false,
        twoFactorDetected: false,
        lastUrl: target.getURL(),
        failureCode: null,
      }
    }
  }

  const waitMs =
    recipe.autoSubmit || recipe.auth === 'certificate'
      ? recipe.postLogin.timeoutMs
      : Math.min(recipe.postLogin.timeoutMs, 12_000)
  const postLogin = await safeExecute<RecipeActionResult>(
    target,
    buildPostLoginScript(recipe.postLogin.selectors, waitMs, recipe.postLogin),
    waitMs + 1_000,
  )
  if (postLogin?.ok) {
    return {
      status: 'authenticated',
      message: 'Login detectado.',
      failedStep: null,
      captchaDetected: false,
      twoFactorDetected: false,
      lastUrl: target.getURL(),
      failureCode: null,
    }
  }

  // Antes de desistir, uma ultima checagem de interstitials (2FA/captcha) —
  // eles podem ter aparecido depois do clique e exigem interacao humana.
  const interstitial = await detectInterstitial(recipe, target)
  if (interstitial.captcha || interstitial.twoFactor) {
    return {
      status: 'manual',
      message: interstitial.captcha
        ? 'Verificacao anti-bot detectada. Conclua o desafio na tela aberta.'
        : 'Verificacao em duas etapas detectada. Conclua o codigo na tela aberta.',
      failedStep: null,
      captchaDetected: interstitial.captcha,
      twoFactorDetected: interstitial.twoFactor,
      lastUrl: target.getURL(),
      failureCode: null,
    }
  }

  return {
    status: 'awaiting_login',
    message:
      recipe.auth === 'certificate'
        ? 'Aguardando autenticacao no portal...'
        : recipe.autoSubmit
          ? 'O portal nao confirmou o login no tempo esperado. Use o modo manual se necessario.'
          : 'Campos preparados. Conclua o login no portal; a sessao sera monitorada.',
    failedStep: null,
    captchaDetected: false,
    twoFactorDetected: false,
    lastUrl: target.getURL(),
    failureCode: null,
  }
}

export async function checkPostLogin(
  recipe: RecipeDefinition,
  target: RecipeTarget,
  timeoutMs = 1200,
): Promise<boolean> {
  if (target.isDestroyed()) return false
  const result = await safeExecute<RecipeActionResult>(
    target,
    buildPostLoginScript(recipe.postLogin.selectors, timeoutMs, recipe.postLogin),
  )
  return result?.ok === true
}
