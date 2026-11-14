import { describe, expect, it } from 'vitest'
import { runAgenticLogin, agentValues, buildFieldRows } from '../../electron/main/recipes/agent'
import type { RecipeTarget } from '../../electron/main/recipes/runner'

interface FakeCall {
  kind: 'observe' | 'click-cta' | 'fill' | 'field-fill' | 'advance' | 'submit' | 'unknown'
  detail: string
}

function makeFakeTarget(
  script: Array<Record<string, unknown>>,
  fills?: Array<Record<string, unknown>>,
) {
  const calls: FakeCall[] = []
  let index = 0
  const observeMap = new Map(script.entries())
  const fillQueue = [...(fills ?? [])]
  const fillOk = {
    ok: true,
    missing: [] as string[],
    filled: [] as string[],
    already: [] as string[],
    coreReady: true,
    detail: 'campos ja preenchidos',
  }
  const target: RecipeTarget & { calls: FakeCall[] } = {
    calls,
    async executeJavaScript<T = unknown>(code: string): Promise<T> {
      if (code.includes('passPresent')) {
        // Observação: consumindo estados sequenciais.
        const state = observeMap.get(Math.min(index++, script.length - 1)) as T
        calls.push({ kind: 'observe', detail: `state ${Math.min(index, script.length) - 1}` })
        return state
      }
      if (code.includes('field-match-fill')) {
        const state = (fillQueue.shift() ?? fillOk) as unknown as T
        calls.push({ kind: 'field-fill', detail: 'field-fill' })
        return state
      }
      if (code.includes('botao de avancar')) {
        calls.push({ kind: 'advance', detail: 'advance' })
        return { ok: true, detail: 'clicado: avançar' } as unknown as T
      }
      if (code.includes('cta nao encontrado')) {
        calls.push({ kind: 'click-cta', detail: 'click cta' })
        return { ok: true, detail: 'clicado: Fazer login' } as unknown as T
      }
      if (code.includes('requestSubmit')) {
        calls.push({ kind: 'submit', detail: 'submit' })
        return { ok: true, detail: 'requestSubmit' } as unknown as T
      }
      if (code.includes('done.push')) {
        calls.push({ kind: 'fill', detail: 'fill' })
        return { ok: true, detail: 'preenchido: usuario+senha' } as unknown as T
      }
      calls.push({ kind: 'unknown', detail: code.slice(0, 40) })
      return { ok: true, detail: 'unknown' } as unknown as T
    },
    async loadURL() {},
    getURL() {
      return 'https://iss.example.test/grpfor/login.seam'
    },
    isDestroyed() {
      return false
    },
  }
  return target
}

const noSleep = async () => undefined
const values = agentValues({
  username: '52998224725',
  password: 'senha-secreta',
  document: '52998224725',
  clientName: 'Cliente X',
})

describe('runAgenticLogin', () => {
  it('landing com CTA → clique; KC → preenche e envia; detecta login', async () => {
    const target = makeFakeTarget([
      // 1. Observa landing pública (nenhum campo, botão "Fazer login")
      {
        href: 'https://iss.example.test/grpfor/login.seam',
        userPresent: false,
        passPresent: false,
        userFilled: false,
        passFilled: false,
        buttons: ['fazer login', 'esqueceu a senha?', 'primeiro acesso'],
        captcha: false,
        twoFactor: false,
        loggedIn: false,
      },
      // 2. Após clique, observa formulário KC vazio
      {
        href: 'https://idp.example.test/realms/sefin/login-actions/authenticate',
        userPresent: true,
        passPresent: true,
        userFilled: false,
        passFilled: false,
        buttons: ['entrar', 'esqueci a senha'],
        captcha: false,
        twoFactor: false,
        loggedIn: false,
      },
      // 3. Observa formulário já preenchido
      {
        href: 'https://idp.example.test/realms/sefin/login-actions/authenticate',
        userPresent: true,
        passPresent: true,
        userFilled: true,
        passFilled: true,
        buttons: ['entrar', 'esqueci a senha'],
        captcha: false,
        twoFactor: false,
        loggedIn: false,
      },
      // 4. Observa como autenticado
      {
        href: 'https://iss.example.test/grpfor/home.seam',
        userPresent: false,
        passPresent: false,
        userFilled: false,
        passFilled: false,
        buttons: ['sair', 'notas fiscais'],
        captcha: false,
        twoFactor: false,
        loggedIn: true,
      },
    ])

    const result = await runAgenticLogin({
      values,
      target,
      sleep: noSleep,
      onProgress: () => undefined,
    })

    expect(result.status).toBe('authenticated')
    const kinds = target.calls.map((c) => c.kind)
    expect(kinds).toContain('click-cta')
    expect(kinds).toContain('fill')
    expect(kinds).toContain('submit')
    expect(kinds[kinds.length - 1]).toBe('observe')
  })

  it('para com 2FA e devolve para intervenção humana', async () => {
    const target = makeFakeTarget([
      {
        href: 'https://idp.example.test/login',
        userPresent: true,
        passPresent: true,
        userFilled: true,
        passFilled: true,
        buttons: ['entrar'],
        captcha: false,
        twoFactor: true,
        loggedIn: false,
      },
    ])
    const result = await runAgenticLogin({ values, target, sleep: noSleep })
    expect(result.status).toBe('manual')
    expect(result.twoFactorDetected).toBe(true)
  })

  it('para com captcha e devolve para intervenção humana', async () => {
    const target = makeFakeTarget([
      {
        href: 'https://idp.example.test/login',
        userPresent: true,
        passPresent: true,
        userFilled: false,
        passFilled: false,
        buttons: ['entrar'],
        captcha: true,
        twoFactor: false,
        loggedIn: false,
      },
    ])
    const result = await runAgenticLogin({ values, target, sleep: noSleep })
    expect(result.captchaDetected).toBe(true)
  })

  it('só preenche quando autoSubmit=false (usuário clica em Entrar)', async () => {
    const target = makeFakeTarget([
      {
        href: 'https://idp.example.test/login',
        userPresent: true,
        passPresent: true,
        userFilled: false,
        passFilled: false,
        buttons: ['entrar'],
        captcha: false,
        twoFactor: false,
        loggedIn: false,
      },
      {
        href: 'https://idp.example.test/login',
        userPresent: true,
        passPresent: true,
        userFilled: true,
        passFilled: true,
        buttons: ['entrar'],
        captcha: false,
        twoFactor: false,
        loggedIn: false,
      },
    ])
    const result = await runAgenticLogin({ values, target, sleep: noSleep, autoSubmit: false })
    expect(result.status).toBe('awaiting_login')
    expect(target.calls.map((c) => c.kind)).not.toContain('submit')
  })

  const fieldValues = agentValues({
    username: '52998224725',
    password: 'senha-secreta',
    document: '52998224725',
    clientName: 'Cliente X',
    fields: [
      { name: 'CPF', kind: 'username' },
      { name: 'Senha', kind: 'password' },
      { name: 'Código da empresa', kind: 'text' },
    ],
    extraValues: { 'Código da empresa': '123456' },
  })

  const emptyForm = {
    href: 'https://portal.example.test/login',
    userPresent: true,
    passPresent: true,
    userFilled: false,
    passFilled: false,
    inputs: 3,
    buttons: ['entrar'],
    captcha: false,
    twoFactor: false,
    loggedIn: false,
  }
  const filledForm = { ...emptyForm, userFilled: true, passFilled: true }

  it('preenche por legenda (usuário+senha+extra) e envia; autentica', async () => {
    const target = makeFakeTarget(
      [
        emptyForm,
        filledForm,
        {
          href: 'https://portal.example.test/home',
          userPresent: false,
          passPresent: false,
          userFilled: false,
          passFilled: false,
          inputs: 0,
          buttons: ['sair'],
          captcha: false,
          twoFactor: false,
          loggedIn: true,
        },
      ],
      [
        {
          ok: true,
          missing: [],
          filled: ['CPF', 'Senha', 'Código da empresa'],
          already: [],
          coreReady: true,
          detail: 'preenchido: CPF+Senha+Código da empresa',
        },
        {
          ok: true,
          missing: [],
          filled: [],
          already: ['CPF', 'Senha', 'Código da empresa'],
          coreReady: true,
          detail: 'campos ja preenchidos',
        },
      ],
    )
    const result = await runAgenticLogin({
      values: fieldValues,
      target,
      sleep: noSleep,
    })
    expect(result.status).toBe('authenticated')
    const kinds = target.calls.map((c) => c.kind)
    expect(kinds).toContain('field-fill')
    expect(kinds).toContain('submit')
    expect(kinds).not.toContain('fill') // caminho legado não é usado
  })

  it('legenda não localizada → pausa manual com a legenda no recado (nunca chuta)', async () => {
    const target = makeFakeTarget(
      [emptyForm],
      [
        {
          ok: false,
          missing: ['Código da empresa'],
          filled: ['CPF', 'Senha'],
          already: [],
          coreReady: true,
          detail: 'preenchido: CPF+Senha',
        },
        {
          ok: false,
          missing: ['Código da empresa'],
          filled: [],
          already: ['CPF', 'Senha'],
          coreReady: true,
          detail: 'nada a preencher',
        },
        {
          ok: false,
          missing: ['Código da empresa'],
          filled: [],
          already: ['CPF', 'Senha'],
          coreReady: true,
          detail: 'nada a preencher',
        },
        {
          ok: false,
          missing: ['Código da empresa'],
          filled: [],
          already: ['CPF', 'Senha'],
          coreReady: true,
          detail: 'nada a preencher',
        },
        {
          ok: false,
          missing: ['Código da empresa'],
          filled: [],
          already: ['CPF', 'Senha'],
          coreReady: true,
          detail: 'nada a preencher',
        },
      ],
    )
    const result = await runAgenticLogin({
      values: fieldValues,
      target,
      sleep: noSleep,
    })
    expect(result.status).toBe('manual')
    expect(result.message).toContain('Código da empresa')
    const kinds = target.calls.map((c) => c.kind)
    expect(kinds).not.toContain('submit')
  })

  it('autoSubmit=false: preenche por legenda e espera o clique do usuário', async () => {
    const target = makeFakeTarget(
      [emptyForm, filledForm],
      [
        {
          ok: true,
          missing: [],
          filled: ['CPF', 'Senha', 'Código da empresa'],
          already: [],
          coreReady: true,
          detail: 'preenchido',
        },
        {
          ok: true,
          missing: [],
          filled: [],
          already: ['CPF', 'Senha', 'Código da empresa'],
          coreReady: true,
          detail: 'campos ja preenchidos',
        },
      ],
    )
    const result = await runAgenticLogin({
      values: fieldValues,
      target,
      sleep: noSleep,
      autoSubmit: false,
    })
    expect(result.status).toBe('awaiting_login')
    expect(target.calls.map((c) => c.kind)).not.toContain('submit')
  })

  it('buildFieldRows: usuário/senha vêm das colunas; extras sem valor são descartados', () => {
    const rows = buildFieldRows(
      agentValues({
        username: 'u@example.com',
        password: 'segredo',
        fields: [
          { name: 'E-mail', kind: 'username' },
          { name: 'Senha', kind: 'password' },
          { name: 'Código', kind: 'text' },
          { name: 'Vazio', kind: 'text' },
        ],
        extraValues: { Código: '999' },
      }),
    )
    expect(rows).toEqual([
      { name: 'E-mail', kind: 'username', value: 'u@example.com' },
      { name: 'Senha', kind: 'password', value: 'segredo' },
      { name: 'Código', kind: 'text', value: '999' },
    ])
  })
})
