import { describe, expect, it } from 'vitest'
import { runAgenticLogin, agentValues } from '../../electron/main/recipes/agent'
import type { RecipeTarget } from '../../electron/main/recipes/runner'

interface FakeCall {
  kind: 'observe' | 'click-cta' | 'fill' | 'advance' | 'submit' | 'unknown'
  detail: string
}

function makeFakeTarget(script: Array<Record<string, unknown>>) {
  const calls: FakeCall[] = []
  let index = 0
  const observeMap = new Map(script.entries())
  const target: RecipeTarget & { calls: FakeCall[] } = {
    calls,
    async executeJavaScript<T = unknown>(code: string): Promise<T> {
      if (code.includes('passPresent')) {
        // Observação: consumindo estados sequenciais.
        const state = observeMap.get(Math.min(index++, script.length - 1)) as T
        calls.push({ kind: 'observe', detail: `state ${Math.min(index, script.length) - 1}` })
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
})
