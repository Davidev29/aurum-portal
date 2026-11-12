import { describe, expect, it, vi } from 'vitest'
import { safeExecute, waitForUrlMatch, type RecipeTarget } from '../../electron/main/recipes/runner'

function fakeTarget(urls: string[]): RecipeTarget & { advance(): void } {
  let index = 0
  const target = {
    executeJavaScript: async <T = unknown>() => null as T,
    loadURL: async () => undefined,
    getURL: () => urls[Math.min(index, urls.length - 1)] ?? '',
    isDestroyed: () => false,
    advance: () => {
      index += 1
    },
  }
  return target
}

const noSleep = async () => undefined

describe('waitForUrlMatch', () => {
  it('passa imediatamente quando a URL satisfaz as guardas', async () => {
    const target = fakeTarget(['https://contas.acesso.gov.br/seguranca'])
    const result = await waitForUrlMatch(
      target,
      { urlIncludes: ['contas.acesso.gov.br'], urlExcludes: ['autenticacao'], timeoutMs: 1_000 },
      noSleep,
    )
    expect(result.ok).toBe(true)
  })

  it('recusa páginas excluídas mesmo satisfazendo a inclusão', async () => {
    const target = fakeTarget(['https://cav.receita.fazenda.gov.br/autenticacao/login'])
    const result = await waitForUrlMatch(
      target,
      {
        urlIncludes: ['cav.receita.fazenda.gov.br'],
        urlExcludes: ['autenticacao/'],
        timeoutMs: 200,
      },
      noSleep,
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('timeout')
  })

  it('espera a navegação sair da interstitial sem injeção no documento', async () => {
    const target = fakeTarget([
      'https://cav.receita.fazenda.gov.br/autenticacao/login',
      'https://cav.receita.fazenda.gov.br/autenticacao/login',
      'https://contas.acesso.gov.br/inicializacao-autenticacao-openid',
    ])
    let polls = 0
    const sleep = async () => {
      polls += 1
      if (polls === 1) target.advance()
      if (polls === 2) target.advance()
    }
    const result = await waitForUrlMatch(
      target,
      {
        urlIncludes: [
          'cav.receita.fazenda.gov.br',
          'contas.acesso.gov.br',
          'sso.acesso.gov.br',
          'certificado.sso.acesso.gov.br',
        ],
        urlExcludes: ['autenticacao/'],
        timeoutMs: 5_000,
      },
      sleep,
    )
    expect(result.ok).toBe(true)
    expect(polls).toBe(2)
  })

  it('falha quando o documento some durante a espera', async () => {
    const target = {
      ...fakeTarget(['about:blank']),
      isDestroyed: () => true,
    }
    const result = await waitForUrlMatch(target, { timeoutMs: 1_000 }, noSleep)
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('encerrada')
  })

  it('trata URL maiúscula e mixed case corretamente', async () => {
    const target = fakeTarget(['HTTPS://SSO.ACESSO.GOV.BR/Login'])
    const result = await waitForUrlMatch(
      target,
      { urlIncludes: ['sso.acesso.gov.br'], timeoutMs: 1_000 },
      noSleep,
    )
    expect(result.ok).toBe(true)
  })
})

describe('safeExecute (limite duro de tempo)', () => {
  const baseTarget = (override: Partial<RecipeTarget>): RecipeTarget => ({
    executeJavaScript: async <T = unknown>() => null as T,
    loadURL: async () => undefined,
    getURL: () => 'https://portal.gov.br/',
    isDestroyed: () => false,
    ...override,
  })

  it('retorna o resultado do script quando ele responde a tempo', async () => {
    const value = { ok: true, selector: null, detail: 'clique' }
    const target = baseTarget({
      executeJavaScript: async <T = unknown>() => value as unknown as T,
    })
    const result = await safeExecute(target, 'script', 1_000)
    expect(result).toEqual(value)
  })

  it('retorna null quando o script rejeita (pagina destruida)', async () => {
    const target = baseTarget({
      executeJavaScript: async () => {
        throw new Error('context destroyed')
      },
    })
    const result = await safeExecute(target, 'script', 1_000)
    expect(result).toBeNull()
  })

  it('aborta a página e retorna null quando o evaluate fica suspenso para sempre', async () => {
    const stopped = vi.fn()
    const target = baseTarget({
      executeJavaScript: () => new Promise(() => {}), // nunca resolve (suspenso até a página parar de carregar)
      stop: stopped,
    })
    const started = Date.now()
    const result = await safeExecute(target, 'script', 80)
    const elapsed = Date.now() - started
    expect(result).toBeNull()
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(elapsed).toBeLessThan(5_000)
  })
})
