/**
 * Teste de integração do runner (`runRecipe`) com a Fase 2 (prontidão).
 *
 * O fake de `RecipeTarget` distingue três famílias de script pelo conteúdo:
 *  - sonda de prontidão (contém `getEntriesByType`);
 *  - ação de clique (contém `el.click()`);
 *  - demais (buildWaitScript/checkPostLogin/etc. — sempre `ok`).
 * A URL muda quando o clique "navega" (simula o portal reagindo ao clique).
 */
import { describe, expect, it } from 'vitest'
import { runRecipe, type RecipeTarget } from '../../electron/main/recipes/runner'
import type { RecipeDefinition } from '../../shared/recipe'

interface MakeTargetOptions {
  probe: (callIndex: number) => unknown
  urlAtEntry?: string
  /** URL para onde o clique "navega" (simula o side-effect da navegação). */
  clickNavigatesTo?: string
  actionResult?: unknown
}

function makeTarget(opts: MakeTargetOptions) {
  let currentUrl = opts.urlAtEntry ?? 'https://portal.exemplo.gov.br/login'
  let probeCalls = 0
  const actionScripts: string[] = []
  const target: RecipeTarget & {
    actionScripts: string[]
    probeCalls: () => number
    currentUrl: () => string
  } = {
    actionScripts,
    async executeJavaScript<T = unknown>(code: string): Promise<T> {
      if (code.includes('getEntriesByType')) {
        const raw = opts.probe(probeCalls)
        probeCalls += 1
        return raw as T
      }
      actionScripts.push(code)
      if (code.includes('el.click()') && opts.clickNavigatesTo) {
        currentUrl = opts.clickNavigatesTo
      }
      return (opts.actionResult ?? { ok: true, selector: null, detail: 'acao ok' }) as T
    },
    async loadURL(url: string) {
      currentUrl = url
    },
    getURL: () => currentUrl,
    isDestroyed: () => false,
    stop() {},
    probeCalls: () => probeCalls,
    currentUrl: () => currentUrl,
  }
  return target
}

const baseRecipe: Omit<RecipeDefinition, 'steps'> = {
  version: 1,
  service: 'portal-exemplo',
  auth: 'password',
  postLogin: { selectors: ['text=Sair'], timeoutMs: 45_000 },
  autoSubmit: false,
  onFailure: 'manual',
}

const recipeWith = (steps: RecipeDefinition['steps']): RecipeDefinition => ({
  ...baseRecipe,
  steps,
})

const noSleep = async () => undefined
const values = { username: 'u', password: 'p', document: '', clientName: '' }

const loadingSample = {
  readyState: 'interactive',
  busyVisible: true,
  recentResourceCount: 4,
  href: 'https://portal.exemplo.gov.br/login',
}
const readySample = {
  readyState: 'complete',
  busyVisible: false,
  recentResourceCount: 0,
  href: 'https://portal.exemplo.gov.br/login',
}

describe('runRecipe + readiness (Fase 2)', () => {
  it('carregando 2 amostras → pronta → clica → URL muda → expectedAfter confirma', async () => {
    const seq = [loadingSample, loadingSample, readySample]
    const target = makeTarget({
      probe: (call) => seq[Math.min(call, seq.length - 1)],
      clickNavigatesTo: 'https://portal.exemplo.gov.br/painel',
    })
    const result = await runRecipe({
      recipe: recipeWith([
        {
          action: 'click',
          selectors: ['#entrar'],
          label: 'Entrar',
          source: 'recorded',
          screen: 'T1',
          confidence: 'high',
          expectedAfter: { urlIncludes: ['portal.exemplo.gov.br/painel'], timeoutMs: 2_000 },
        },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).not.toBe('manual')
    expect(result.failureCode).toBeNull()
    expect(target.currentUrl()).toBe('https://portal.exemplo.gov.br/painel')
    expect(target.actionScripts.some((s) => s.includes('el.click()'))).toBe(true)
    expect(target.probeCalls()).toBeGreaterThanOrEqual(3)
  })

  it('ocupador some na 3ª amostra → clica igualmente (paciente, não preguiçoso)', async () => {
    const seq = [loadingSample, loadingSample, readySample, readySample]
    const target = makeTarget({ probe: (call) => seq[Math.min(call, seq.length - 1)] })
    const result = await runRecipe({
      recipe: recipeWith([
        { action: 'click', selectors: ['#entrar'], label: 'Entrar', timeoutMs: 5_000 },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).not.toBe('manual')
    expect(target.actionScripts.some((s) => s.includes('el.click()'))).toBe(true)
  })

  it('expectedAfter nunca confirma → manual + post-condition-failed + failedStep', async () => {
    const target = makeTarget({ probe: () => readySample })
    const result = await runRecipe({
      recipe: recipeWith([
        {
          action: 'click',
          selectors: ['#entrar'],
          label: 'Entrar',
          expectedAfter: { urlIncludes: ['destino.que.nunca.chega.gov.br'], timeoutMs: 500 },
        },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).toBe('manual')
    expect(result.failureCode).toBe('post-condition-failed')
    expect(result.failedStep).toBe(0)
    expect(result.message).toContain('Entrar')
  })

  it('readiness eterna → manual + readiness-timeout + NENHUM clique despacha após a espera', async () => {
    const target = makeTarget({ probe: () => loadingSample })
    const result = await runRecipe({
      recipe: recipeWith([{ action: 'click', selectors: ['#entrar'], label: 'Entrar' }]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).toBe('manual')
    expect(result.failureCode).toBe('readiness-timeout')
    expect(result.failedStep).toBe(0)
    expect(result.message).toBe(
      'A página do portal não estabilizou. Pausamos aqui para você concluir com segurança.',
    )
    // Duas sondas+ amostras aconteceram, nenhuma ação foi despachada.
    expect(target.probeCalls()).toBeGreaterThan(0)
    expect(target.actionScripts).toHaveLength(0)
  })

  it('probe impossível (evaluate morre) 2× consecutivas → manual + probe-error + nenhum clique', async () => {
    const target = makeTarget({ probe: () => null })
    const result = await runRecipe({
      recipe: recipeWith([{ action: 'click', selectors: ['#entrar'], label: 'Entrar' }]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).toBe('manual')
    expect(result.failureCode).toBe('probe-error')
    expect(result.failedStep).toBe(0)
    expect(result.message).toBe('O portal não está respondendo à automação. Use o modo manual.')
    expect(target.actionScripts).toHaveLength(0)
  })

  it('passo optional + readiness eterna → PULA o passo e segue (log; nunca pausa)', async () => {
    const target = makeTarget({ probe: () => loadingSample })
    const result = await runRecipe({
      recipe: recipeWith([
        {
          action: 'click',
          selectors: ['#aviso-opcional'],
          label: 'Aviso opcional',
          optional: true,
        },
        { action: 'sleep', timeoutMs: 100 },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).not.toBe('manual')
    expect(result.failureCode).toBeNull()
    // O clique opcional nunca foi despachado (o pós-login final pode ter sido).
    expect(target.actionScripts.some((s) => s.includes('el.click()'))).toBe(false)
  })

  it('passo optional + probe-error → PULA o passo e segue', async () => {
    const target = makeTarget({ probe: () => null })
    const result = await runRecipe({
      recipe: recipeWith([
        { action: 'click', selectors: ['#entrar'], label: 'Entrar', optional: true },
        { action: 'sleep', timeoutMs: 100 },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).not.toBe('manual')
    expect(target.actionScripts.some((s) => s.includes('el.click()'))).toBe(false)
  })

  it('goto NÃO passa pela sonda (loadURL é a espera dele)', async () => {
    const target = makeTarget({ probe: () => readySample })
    const result = await runRecipe({
      recipe: recipeWith([{ action: 'goto', url: 'https://portal.exemplo.gov.br/login' }]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.failureCode).toBeNull()
    expect(target.probeCalls()).toBe(0)
  })

  it('sleep NÃO passa pela sonda', async () => {
    const target = makeTarget({ probe: () => readySample })
    const result = await runRecipe({
      recipe: recipeWith([{ action: 'sleep', timeoutMs: 100 }]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.failureCode).toBeNull()
    expect(target.probeCalls()).toBe(0)
  })

  it('waitForURL NÃO passa pela sonda', async () => {
    const target = makeTarget({ probe: () => readySample })
    const result = await runRecipe({
      recipe: recipeWith([
        { action: 'waitForURL', urlIncludes: ['portal.exemplo.gov.br'], timeoutMs: 1_000 },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.failureCode).toBeNull()
    expect(target.probeCalls()).toBe(0)
  })

  it('readiness timeout na segunda etapa falha apenas esse passo (failedStep correto)', async () => {
    const seq = [readySample, loadingSample]
    const target = makeTarget({ probe: (call) => seq[Math.min(call, seq.length - 1)] })
    const result = await runRecipe({
      recipe: recipeWith([
        { action: 'click', selectors: ['#primeiro'], label: 'Primeiro' },
        { action: 'click', selectors: ['#segundo'], label: 'Segundo' },
      ]),
      values,
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: noSleep,
    })
    expect(result.status).toBe('manual')
    expect(result.failureCode).toBe('readiness-timeout')
    expect(result.failedStep).toBe(1)
    // O primeiro clique aconteceu; o segundo nunca foi despachado.
    expect(target.actionScripts.some((s) => s.includes('#primeiro'))).toBe(true)
    expect(target.actionScripts.some((s) => s.includes('#segundo'))).toBe(false)
  })
})
