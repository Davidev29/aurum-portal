import { describe, expect, it } from 'vitest'
import {
  buildActionScript,
  buildAutoSubmitScript,
  buildDetectScript,
  buildPostLoginScript,
  buildWaitScript,
  isSensitiveStep,
  pickStepTimeout,
  recipeValues,
} from '../../electron/main/recipes/core'
import type { RecipeDefinition, RecipeStep } from '../../shared/recipe'

const values = recipeValues({
  username: '52998224725',
  password: 'senha-secreta',
  document: '11222333000181',
  clientName: 'Empresa Exemplo',
})

function step(input: Partial<RecipeStep>): RecipeStep {
  return { action: 'fill', ...input } as RecipeStep
}

describe('scripts de receita', () => {
  it('monta script de espera com seletores e timeout minimo', () => {
    const script = buildWaitScript(['#login', 'text=Entrar'], 10)
    expect(script).toContain('"#login"')
    expect(script).toContain('"text=Entrar"')
    expect(script).toContain('Date.now() + 100')
    expect(script).toContain('timeout')
  })

  it('preenche campos resolvendo placeholders sem vazar senha no seletor', () => {
    const script = buildActionScript(
      step({ selectors: ['#user'], value: '{{credential.username}}' }),
      values,
    )
    expect(script).toContain('52998224725')
    expect(script).toContain('__pvSetValue')
    expect(script).toContain('dispatchEvent')
  })

  it('evaluate gera corpo async e aguarda a Promise do script (polling interno)', () => {
    const script = buildActionScript(
      step({ action: 'evaluate', script: 'const v = await Promise.resolve("ok"); return v' }),
      values,
    )
    expect(script).toContain('(async () => {')
    expect(script).toContain('await (async () => {')
  })

  it('evaluate com throw devolve mensagem real do erro', () => {
    const script = buildActionScript(
      step({ action: 'evaluate', script: 'throw new Error("bruto")' }),
      values,
    )
    expect(script).toContain('error?.message')
  })

  it('gera scripts de click, press, sleep, evaluate e assert', () => {
    expect(buildActionScript(step({ action: 'click', selectors: ['#btn'] }), values)).toContain(
      'el.click()',
    )
    expect(
      buildActionScript(step({ action: 'press', selectors: ['#user'], key: 'Tab' }), values),
    ).toContain('"Tab"')
    expect(buildActionScript(step({ action: 'sleep' }), values)).toContain('"sleep"')
    expect(
      buildActionScript(step({ action: 'evaluate', script: 'return 1 + 1' }), values),
    ).toContain('evaluate')
    expect(buildActionScript(step({ action: 'assert', selectors: ['#ok'] }), values)).toContain(
      'assert por seletor',
    )
  })

  it('usa defaults seguros para press e evaluate', () => {
    expect(buildActionScript(step({ action: 'press' }), values)).toContain('"Enter"')
    expect(buildActionScript(step({ action: 'evaluate' }), values)).toContain('true')
  })

  it('retorna falha para acao desconhecida', () => {
    const script = buildActionScript({ action: 'goto' } as RecipeStep, values)
    expect(script).toContain('acao nao suportada')
  })

  it('detecta captcha e 2FA por seletores declarados', () => {
    const recipe = {
      version: 1,
      service: 'portal',
      auth: 'password',
      steps: [],
      postLogin: { selectors: ['body'], timeoutMs: 1000 },
      autoSubmit: false,
      onFailure: 'manual',
      captchaSelectors: ['#captcha'],
      twoFactorSelectors: ['#otp'],
    } satisfies RecipeDefinition
    const script = buildDetectScript(recipe)
    expect(script).toContain('"#captcha"')
    expect(script).toContain('"#otp"')
    expect(script).toContain('captcha:')
    expect(script).toContain('twoFactor:')
  })

  it('usa listas vazias quando nao ha seletores de captcha/2FA', () => {
    const recipe = {
      version: 1,
      service: 'portal',
      auth: 'certificate',
      steps: [],
      postLogin: { selectors: ['body'], timeoutMs: 1000 },
      autoSubmit: false,
      onFailure: 'manual',
    } satisfies RecipeDefinition
    const script = buildDetectScript(recipe)
    expect(script).toContain('[]')
  })

  it('reaproveita o script de espera no pos-login', () => {
    expect(buildPostLoginScript(['text=Sair'], 5000)).toContain('"text=Sair"')
  })

  it('aplica guarda de URL no pos-login quando configurada (webguard include/exclude)', () => {
    const script = buildPostLoginScript(['text=Sair'], 5000, {
      urlIncludes: ['cav.receita.fazenda.gov.br'],
      urlExcludes: ['autenticacao'],
    })
    expect(script).toContain('cav.receita.fazenda.gov.br')
    expect(script).toContain('autenticacao')
    expect(script).toContain('passUrl')
    expect(script).toContain('location.href')
    expect(script).toContain('"text=Sair"')
  })

  it('mantem o pós-login simples quando nao ha guarda configurada', () => {
    const script = buildPostLoginScript(['text=Sair'], 5000, {})
    expect(script).not.toContain('passUrl')
    expect(script).toContain('"text=Sair"')
  })

  it('gera auto-submit apenas via requestSubmit ou Enter', () => {
    const script = buildAutoSubmitScript()
    expect(script).toContain('input[type="password"]')
    expect(script).toContain('requestSubmit')
    expect(script).toContain('KeyboardEvent')
  })

  it('normaliza valores ausentes para string vazia', () => {
    expect(recipeValues({})).toEqual({
      username: '',
      password: '',
      document: '',
      clientName: '',
    })
  })

  it('limita timeout do passo entre 100ms e 120s', () => {
    expect(pickStepTimeout(step({ timeoutMs: 1 }))).toBe(100)
    expect(pickStepTimeout(step({ timeoutMs: 5000 }))).toBe(5000)
    expect(pickStepTimeout(step({ timeoutMs: 999_999 }))).toBe(120_000)
    expect(pickStepTimeout(step({}))).toBe(30_000)
  })

  it('marca apenas fill com senha como passo sensivel', () => {
    expect(isSensitiveStep(step({ action: 'fill', value: '{{credential.password}}' }))).toBe(true)
    expect(isSensitiveStep(step({ action: 'fill', value: '{{credential.username}}' }))).toBe(false)
    expect(isSensitiveStep(step({ action: 'click', value: '{{credential.password}}' }))).toBe(false)
  })

  it('FINDER preserva \\s nos scripts injetados (String.raw)', () => {
    // Regressão: `\s` em template normal colapsa para `s` no JS executado na
    // página, quebrando todos os seletores text= e a normalização de espaços.
    const script = buildActionScript(step({ action: 'click', selectors: ['text=Sair'] }), values)
    expect(script).toContain('\\s+')
    expect(script).not.toContain('/s+/g')
  })
})
