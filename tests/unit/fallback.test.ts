import { describe, expect, it } from 'vitest'
import { shouldFallbackToAgent } from '../../electron/main/recipes/fallback'
import type { RecipeRunResult } from '../../electron/main/recipes/runner'

function result(
  failureCode: RecipeRunResult['failureCode'],
  failedStep: number | null,
): RecipeRunResult {
  return {
    status: 'manual',
    message: 'parou',
    failedStep,
    captchaDetected: false,
    twoFactorDetected: false,
    lastUrl: 'https://portal.exemplo.gov.br/',
    failureCode,
  }
}

describe('shouldFallbackToAgent (C7/D6)', () => {
  it('element-not-found no passo 0 → true (portal mudou; agente reaprende)', () => {
    expect(shouldFallbackToAgent(result('element-not-found', 0))).toBe(true)
  })

  it('element-not-found em qualquer outro passo → false', () => {
    expect(shouldFallbackToAgent(result('element-not-found', 1))).toBe(false)
    expect(shouldFallbackToAgent(result('element-not-found', 5))).toBe(false)
  })

  it.each([
    'selector-not-found',
    'readiness-timeout',
    'post-condition-failed',
    'probe-error',
    'budget-exhausted',
  ] as const)('%s no passo 0 → false (PAUSAR, nunca double-submit)', (code) => {
    expect(shouldFallbackToAgent(result(code, 0))).toBe(false)
  })

  it('failureCode null (captcha/2FA/config) → false', () => {
    expect(shouldFallbackToAgent(result(null, 0))).toBe(false)
    expect(shouldFallbackToAgent(result(null, null))).toBe(false)
  })
})
