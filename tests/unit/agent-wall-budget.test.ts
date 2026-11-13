/**
 * Orçamento de parede (120 s) do `runAgenticLogin` — impede laço eterno em
 * portal patológico. Usa `vi.useFakeTimers` + `vi.setSystemTime` para
 * avançar o relógio do sistema dentro do loop.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentValues, runAgenticLogin } from '../../electron/main/recipes/agent'
import type { RecipeTarget } from '../../electron/main/recipes/runner'

const noSleep = async () => undefined
const values = agentValues({
  username: 'u',
  password: 'p',
  document: '',
  clientName: '',
})

const observeEmpty = {
  href: 'https://portal.exemplo.gov.br/login',
  userPresent: false,
  passPresent: false,
  userFilled: false,
  passFilled: false,
  buttons: [],
  captcha: false,
  twoFactor: false,
  loggedIn: false,
}

const quietProbe = {
  readyState: 'complete',
  busyVisible: false,
  recentResourceCount: 0,
  href: observeEmpty.href,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('runAgenticLogin — orçamento de parede', () => {
  it('excedido 120 s → manual com mensagem de limite, sem tocar em nada', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    let evaluateCalls = 0
    const target: RecipeTarget = {
      async executeJavaScript<T = unknown>(code: string): Promise<T> {
        evaluateCalls += 1
        // Cada evaluate custa 60 s de relógio — depois de 2 iterações o
        // orçamento de 120 s estoura, independente do número de iterações.
        vi.setSystemTime(1_000_000 + evaluateCalls * 60_000)
        if (code.includes('getEntriesByType')) return quietProbe as unknown as T
        return observeEmpty as unknown as T
      },
      async loadURL() {},
      getURL: () => observeEmpty.href,
      isDestroyed: () => false,
    }
    const result = await runAgenticLogin({ values, target, sleep: noSleep, maxIterations: 24 })
    expect(result.status).toBe('manual')
    expect(result.message).toBe(
      'O acesso demorou mais que o esperado. Pausamos para você concluir.',
    )
    expect(result.captchaDetected).toBe(false)
    expect(result.twoFactorDetected).toBe(false)
    expect(result.iterations).toBeLessThan(24)
    expect(result.lastUrl).toBe(observeEmpty.href)
  })

  it('iteração 0 continua funcionando normalmente (sem checagem de orçamento falsa)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(5_000_000)
    const target: RecipeTarget = {
      async executeJavaScript<T = unknown>(code: string): Promise<T> {
        if (code.includes('getEntriesByType')) return quietProbe as unknown as T
        return { ...observeEmpty, loggedIn: true } as unknown as T
      },
      async loadURL() {},
      getURL: () => observeEmpty.href,
      isDestroyed: () => false,
    }
    const result = await runAgenticLogin({ values, target, sleep: noSleep, maxIterations: 24 })
    expect(result.status).toBe('authenticated')
  })
})
