import { describe, expect, it } from 'vitest'
import { runRecipe, type RecipeTarget } from '../../electron/main/recipes/runner'
import type { RecipeDefinition } from '../../shared/recipe'

interface ScriptedTarget extends RecipeTarget {
  urls: string[]
}

function makeTarget(handlers: {
  onScript?: (script: string) => unknown
  urlSequence?: string[]
}): ScriptedTarget {
  const target: ScriptedTarget = {
    urls: [...(handlers.urlSequence ?? ['https://portal.exemplo.gov.br/'])],
    async executeJavaScript<T>(script: string): Promise<T> {
      return (handlers.onScript?.(script) ?? { ok: true, selector: null, detail: 'ok' }) as T
    },
    async loadURL(url: string) {
      target.urls.push(url)
    },
    getURL() {
      return target.urls[target.urls.length - 1] as string
    },
    isDestroyed() {
      return false
    },
    stop() {},
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

function recipeWith(step: RecipeDefinition['steps'][number]): RecipeDefinition {
  return { ...baseRecipe, steps: [step] }
}

describe('expectedAfter (Fase 1)', () => {
  it('clique cuja URL pós-ação passa a conter o host esperado → receita prossegue', async () => {
    const target = makeTarget({
      urlSequence: ['https://portal.exemplo.gov.br/', 'https://sso.acesso.gov.br/authorize'],
      onScript: (script) =>
        script.includes('text=Sair')
          ? { ok: true, selector: 'text=Sair', detail: 'ok' }
          : { ok: true, selector: null, detail: 'ok' },
    })
    const result = await runRecipe({
      recipe: recipeWith({
        action: 'click',
        selectors: ['#btn-entrar'],
        label: 'Fazer login',
        source: 'recorded',
        screen: 'T1',
        confidence: 'high',
        expectedAfter: { urlIncludes: ['sso.acesso.gov.br/authorize'], timeoutMs: 1_000 },
      }),
      values: { username: 'u', password: 'p', document: '', clientName: '' },
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: async () => undefined,
    })
    expect(result.status).not.toBe('manual')
    expect(result.failureCode).toBeNull()
  })

  it('pós-condição nunca confirmada → manual + post-condition-failed + failedStep (PAUSAR)', async () => {
    const target = makeTarget({
      urlSequence: ['https://portal.exemplo.gov.br/'],
      onScript: () => ({ ok: true, selector: null, detail: 'ok' }),
    })
    const result = await runRecipe({
      recipe: recipeWith({
        action: 'click',
        selectors: ['#btn-entrar'],
        label: 'Entrar',
        source: 'recorded',
        screen: 'T1',
        confidence: 'high',
        expectedAfter: { urlIncludes: ['destino.que.nunca.chega.gov.br'], timeoutMs: 500 },
      }),
      values: { username: 'u', password: 'p', document: '', clientName: '' },
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: async () => undefined,
    })
    expect(result.status).toBe('manual')
    expect(result.failureCode).toBe('post-condition-failed')
    expect(result.failedStep).toBe(0)
    expect(result.message).toContain('Entrar')
  })

  it('passo sem expectedAfter não paga o custo da checagem (builtins intactos)', async () => {
    const target = makeTarget({
      onScript: (script) =>
        script.includes('text=Sair')
          ? { ok: true, selector: 'text=Sair', detail: 'ok' }
          : { ok: true, selector: null, detail: 'ok' },
    })
    const result = await runRecipe({
      recipe: recipeWith({ action: 'sleep', timeoutMs: 100 }),
      values: { username: 'u', password: 'p', document: '', clientName: '' },
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: async () => undefined,
    })
    expect(result.failureCode).toBeNull()
    expect(['authenticated', 'awaiting_login']).toContain(result.status)
  })

  it('falha de seletor → failureCode element-not-found (alimenta o fallback C7)', async () => {
    const target = makeTarget({
      onScript: () => ({ ok: false, selector: null, detail: 'elemento nao encontrado' }),
    })
    const result = await runRecipe({
      recipe: recipeWith({ action: 'waitFor', selectors: ['#nunca'], timeoutMs: 100 }),
      values: { username: 'u', password: 'p', document: '', clientName: '' },
      target,
      allowedDomains: ['portal.exemplo.gov.br'],
      sleep: async () => undefined,
    })
    expect(result.status).toBe('manual')
    expect(result.failureCode).toBe('element-not-found')
    expect(result.failedStep).toBe(0)
  })
})
