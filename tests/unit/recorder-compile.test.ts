import { describe, expect, it } from 'vitest'
import {
  compileRecording,
  normalizeFieldKey,
  type CompileContext,
  type RecordedEvent,
} from '../../electron/main/recipes/recorder'
import { isSensitiveStep } from '../../electron/main/recipes/core'
import { recipeDefinitionSchema } from '../../shared/recipe'

const BASE_THUMB = 'a'.repeat(64)
const OTHER_THUMB = 'b'.repeat(64)

function makeContext(overrides: Partial<CompileContext> = {}): CompileContext {
  return {
    service: 'portal-exemplo',
    auth: 'password',
    autoSubmit: true,
    clientDocument: '529.982.247-25',
    fingerprintTargetId: 'cred-1',
    credentials: [{ id: 'cred-1', passwordFingerprint: BASE_THUMB, username: 'joao.silva' }],
    navigations: [],
    previousRecipe: {
      version: 1,
      service: 'portal-exemplo',
      auth: 'password',
      steps: [{ action: 'sleep', timeoutMs: 100 }],
      postLogin: {
        selectors: ['text=Sair'],
        timeoutMs: 45_000,
        urlIncludes: ['fortaleza.gov.br'],
        urlExcludes: ['autenticacao'],
      },
      autoSubmit: true,
      onFailure: 'manual',
      captchaSelectors: ['.g-recaptcha'],
      twoFactorSelectors: ["input[autocomplete='one-time-code']"],
    },
    vault: {
      fingerprintPassword: (value: string) => (value === 'senha-certa' ? BASE_THUMB : OTHER_THUMB),
    },
    now: () => Date.parse('2026-11-13T18:20:11.000Z'),
    ...overrides,
  }
}

function clickEvent(label: string, at: number, screen = 'T1', sel = '#btn'): RecordedEvent {
  return {
    t: 'click',
    at,
    seq: at,
    label,
    tag: 'button',
    screen,
    candidates: [{ sel, confidence: 'high', matchCount: 1 }],
  }
}

function fillPassword(valueRef: number, at: number, screen = 'T2'): RecordedEvent {
  return {
    t: 'fill',
    at,
    seq: at,
    valueRef,
    field: {
      type: 'password',
      name: 'senha',
      id: 'senha',
      autocomplete: 'current-password',
      ariaLabel: '',
      placeholder: '',
      labelText: 'Senha',
    },
    screen,
  }
}

function fillUnknown(valueRef: number, at: number): RecordedEvent {
  return {
    t: 'fill',
    at,
    seq: at,
    valueRef,
    field: {
      type: 'text',
      name: 'agencia',
      id: 'agencia',
      autocomplete: '',
      ariaLabel: '',
      placeholder: '',
      labelText: 'Agência',
    },
    screen: 'T2',
  }
}

function fillOtp(valueRef: number, at: number): RecordedEvent {
  return {
    t: 'fill',
    at,
    seq: at,
    valueRef,
    field: {
      type: 'text',
      name: 'codigo',
      id: 'otp',
      autocomplete: 'one-time-code',
      ariaLabel: '',
      placeholder: '',
      labelText: 'Código',
    },
    screen: 'T2',
  }
}

describe('compileRecording — placeholders e segredos (D4/C2)', () => {
  it('fingerprint igual → {{credential.password}} sem warning', () => {
    const { definition, warnings } = compileRecording(
      [fillPassword(0, 1000)],
      ['senha-certa'],
      makeContext(),
    )
    const step = definition.steps[0]
    expect(step?.value).toBe('{{credential.password}}')
    expect(warnings).toHaveLength(0)
  })

  it('fingerprint diferente → placeholder + warning credential-mismatch, nunca o literal', () => {
    const { definition, warnings } = compileRecording(
      [fillPassword(0, 1000)],
      ['senha-errada'],
      makeContext(),
    )
    const step = definition.steps[0]
    expect(step?.value).toBe('{{credential.password}}')
    expect(JSON.stringify(definition)).not.toContain('senha-errada')
    expect(warnings.map((w) => w.code)).toContain('credential-mismatch')
  })

  it('sem credencial vinculada → fingerprint NÃO é invocado e warning no-credential-bound (N2/C2)', () => {
    let fingerprintCalled = 0
    const ctx = makeContext({
      fingerprintTargetId: null,
      vault: {
        fingerprintPassword: () => {
          fingerprintCalled += 1
          return BASE_THUMB
        },
      },
    })
    const { definition, warnings } = compileRecording([fillPassword(0, 1000)], ['qualquer'], ctx)
    expect(fingerprintCalled).toBe(0)
    expect(definition.steps[0]?.value).toBe('{{credential.password}}')
    expect(warnings.map((w) => w.code)).toContain('no-credential-bound')
  })

  it('campo usuário com documento do cliente → {{client.document}}', () => {
    const { definition } = compileRecording(
      [
        {
          t: 'fill',
          at: 1000,
          seq: 1,
          valueRef: 0,
          field: {
            type: 'text',
            name: 'cpf',
            id: 'cpf',
            autocomplete: 'username',
            ariaLabel: '',
            placeholder: '',
            labelText: 'CPF',
          },
          screen: 'T2',
        },
      ],
      ['529.982.247-25'],
      makeContext(),
    )
    expect(definition.steps[0]?.value).toBe('{{client.document}}')
  })

  it('campo desconhecido → aprendido como nomeado ({{credential.f_…}}) + value-not-recorded', () => {
    const { definition, warnings } = compileRecording(
      [fillUnknown(0, 1000)],
      ['1234'],
      makeContext(),
    )
    const step = definition.steps[0]
    expect(step?.value).toMatch(/^\{\{credential\.f_agencia\}\}$/)
    expect(step?.optional).toBe(true)
    expect(warnings.map((w) => w.code)).toContain('value-not-recorded')
    const spec = definition.fields?.find((field) => field.key === 'f_agencia')
    expect(spec?.kind).toBe('text')
    expect(spec?.label).toBe('Agência')
  })

  it('one-time-code → value "" opcional + otp-not-recorded', () => {
    const { definition, warnings } = compileRecording([fillOtp(0, 1000)], ['123456'], makeContext())
    const step = definition.steps[0]
    expect(step?.value).toBe('')
    expect(step?.optional).toBe(true)
    expect(JSON.stringify(definition)).not.toContain('123456')
    expect(warnings.map((w) => w.code)).toContain('otp-not-recorded')
  })
})

describe('compileRecording — campos nomeados aprendidos', () => {
  it('registra username/password como campos nomeados do serviço', () => {
    const { definition } = compileRecording(
      [
        fillPassword(0, 1000),
        {
          t: 'fill',
          at: 500,
          seq: 1,
          valueRef: 0,
          field: {
            type: 'text',
            name: 'cpf',
            id: 'cpf',
            autocomplete: 'username',
            ariaLabel: '',
            placeholder: '',
            labelText: 'CPF',
          },
          screen: 'T2',
        },
      ],
      ['senha-certa', '52998224725'],
      makeContext(),
    )
    const keys = (definition.fields ?? []).map((field) => field.key).sort()
    expect(keys).toContain('username')
    expect(keys).toContain('password')
  })

  it('normaliza nomes de campo para placeholders válidos', () => {
    expect(normalizeFieldKey('Código da empresa')).toBe('codigo_da_empresa')
    expect(normalizeFieldKey('inscrição estadual')).toBe('inscricao_estadual')
    expect(normalizeFieldKey('__x!!')).toBe('x')
    expect(normalizeFieldKey('3campos')).toBe('campos')
    expect(normalizeFieldKey('')).toBe('campo')
  })

  it('nunca persiste valores literais — só placeholders e metadados', () => {
    const { definition } = compileRecording(
      [fillPassword(0, 1000), fillUnknown(1, 2000)],
      ['senha-certa', 'VALOR-SECRETO-EMPRESA'],
      makeContext(),
    )
    expect(JSON.stringify(definition)).not.toContain('VALOR-SECRETO-EMPRESA')
    expect(JSON.stringify(definition)).not.toContain('senha-certa')
  })
})

describe('compileRecording — navegação e telas (D5)', () => {
  it('navegação solta vira waitForURL standalone (sem query volátil)', () => {
    const { definition } = compileRecording(
      [clickEvent('Fazer login', 1000, 'T1')],
      [],
      makeContext({
        navigations: [
          { at: 9000, toUrl: 'https://sso.acesso.gov.br/authorize?session_code=abc&state=xyz' },
        ],
      }),
    )
    const waitStep = definition.steps.find((step) => step.action === 'waitForURL')
    expect(waitStep?.urlIncludes?.[0]).toBe('sso.acesso.gov.br/authorize')
  })

  it('navegação ≤5s pós-clique funde expectedAfter no clique (sem criar etapa)', () => {
    const { definition } = compileRecording(
      [clickEvent('Fazer login', 1000, 'T1')],
      [],
      makeContext({
        navigations: [{ at: 2000, toUrl: 'https://sso.acesso.gov.br/authorize?cid=12345' }],
      }),
    )
    const click = definition.steps.find((step) => step.action === 'click')
    expect(click?.expectedAfter?.urlIncludes?.[0]).toBe('sso.acesso.gov.br/authorize')
    expect(definition.steps.some((step) => step.action === 'waitForURL')).toBe(false)
  })

  it('navegação com query volátil não persiste cid/session_code na receita', () => {
    const { definition } = compileRecording(
      [clickEvent('Entrar', 1000, 'T1')],
      [],
      makeContext({
        navigations: [
          { at: 2000, toUrl: 'https://portal.exemplo.gov.br/area?cid=999&session_code=abc' },
        ],
      }),
    )
    const raw = JSON.stringify(definition)
    expect(raw).not.toContain('session_code=abc')
    expect(raw).not.toContain('cid=999')
  })
})

describe('compileRecording — formato da receita (C1)', () => {
  it('origem recorded, steps com source recorded e telas numeradas', () => {
    const { definition } = compileRecording(
      [clickEvent('Entrar', 1000, 'T1'), fillPassword(0, 2000, 'T2')],
      ['senha-certa'],
      makeContext(),
    )
    expect(definition.origin).toBe('recorded')
    expect(definition.recordedScreens).toBe(2)
    expect(definition.steps.every((step) => step.source === 'recorded')).toBe(true)
    // schema zod valida o resultado (round-trip implícito do parse)
    expect(recipeDefinitionSchema.parse(definition)).toBeTruthy()
  })

  it('reutiliza postLogin/captcha/2fa da receita anterior (C1)', () => {
    const { definition } = compileRecording([clickEvent('Entrar', 1000, 'T1')], [], makeContext())
    expect(definition.postLogin.selectors).toEqual(['text=Sair'])
    expect(definition.postLogin.urlExcludes).toEqual(['autenticacao'])
    expect(definition.captchaSelectors).toEqual(['.g-recaptcha'])
    expect(definition.twoFactorSelectors).toEqual(["input[autocomplete='one-time-code']"])
    expect(definition.steps.map((s) => s.action)).toEqual(['click'])
  })

  it('sem receita anterior → postLoginGeneric e selectors genéricos', () => {
    const { definition } = compileRecording(
      [clickEvent('Entrar', 1000, 'T1')],
      [],
      makeContext({ previousRecipe: null }),
    )
    expect(definition.postLogin.selectors.length).toBeGreaterThan(0)
    expect(definition.captchaSelectors?.length).toBeGreaterThan(0)
  })

  it('isSensitiveStep reconhece os fills gravados', () => {
    const { definition } = compileRecording([fillPassword(0, 1000)], ['senha-certa'], makeContext())
    const fill = definition.steps.find((step) => step.action === 'fill')
    expect(fill && isSensitiveStep(fill)).toBe(true)
  })
})
