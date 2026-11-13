// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDrainScript,
  buildRecorderScript,
  buildTeardownScript,
  type RecordedDrain,
} from '../../electron/main/recipes/recorder'

const TOKEN = 'test-token'

function evalScript(script: string): unknown {
  // O script é um IIFE autocontido; executa no escopo global do jsdom.
  return (0, eval)(script)
}

function drain(): RecordedDrain {
  return evalScript(buildDrainScript(TOKEN)) as RecordedDrain
}

function setBody(html: string): void {
  document.body.innerHTML = html
}

function click(el: Element): void {
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }))
}

function inputEvent(el: HTMLInputElement): void {
  el.dispatchEvent(new window.Event('input', { bubbles: true }))
}

function focusout(el: Element): void {
  el.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
}

function pressEnter(el: Element): void {
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = ''
  delete (window as unknown as { __aurumbitRec?: unknown }).__aurumbitRec
  // jsdom não faz layout: stub de rect não-zero para o checador de visibilidade.
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      right: 100,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect
  }
})

describe('recorder in-page — captura de eventos', () => {
  it('arma o script e retorna ok; clique em botão interativo é gravado', () => {
    setBody('<button id="btn-entrar">Entrar</button>')
    const arm = evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' })) as { ok: boolean }
    expect(arm.ok).toBe(true)

    click(document.querySelector('#btn-entrar') as Element)

    const out = drain()
    expect(out.ok).toBe(true)
    expect(out.events).toHaveLength(1)
    const event = out.events[0]
    expect(event?.t).toBe('click')
    expect(out.secrets).toHaveLength(0)
    if (event?.t === 'click') {
      expect(event.label).toBe('Entrar')
      expect(event.candidates.some((c) => c.sel === '#btn-entrar')).toBe(true)
    }
  })

  it('clique em div não interativa é descartado', () => {
    setBody('<div id="decor">Decor</div>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(document.querySelector('#decor') as Element)
    expect(drain().events).toHaveLength(0)
  })

  it('id dinâmico (ember123) é rejeitado como candidato; cai para [name] ou text=', () => {
    setBody('<button id="ember12345" name="entrar">Entrar</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(document.querySelector('#ember12345') as Element)
    const out = drain()
    const event = out.events[0]
    if (event?.t === 'click') {
      const sels = event.candidates.map((c) => c.sel)
      expect(sels.some((s) => s.startsWith('#ember'))).toBe(false)
      expect(sels.some((s) => s === '[name="entrar"]' || s === 'text=Entrar')).toBe(true)
    } else {
      throw new Error('esperado evento click')
    }
  })

  it('double-click humano no mesmo alvo vira 1 etapa', () => {
    setBody('<button id="go">Continuar</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    const el = document.querySelector('#go') as Element
    click(el)
    click(el)
    expect(drain().events.filter((e) => e.t === 'click')).toHaveLength(1)
  })

  it('fills: input coalescado por debounce de 400ms (1 fill por campo)', () => {
    vi.useFakeTimers()
    try {
      setBody('<input id="cpf" name="cpf" type="text" />')
      evalScript(buildRecorderScript({ token: TOKEN, screen: 'T2' }))
      const input = document.querySelector('#cpf') as HTMLInputElement
      input.value = '5'
      inputEvent(input)
      input.value = '52'
      inputEvent(input)
      input.value = '529'
      inputEvent(input)
      vi.advanceTimersByTime(450)

      const out = drain()
      const fills = out.events.filter((e) => e.t === 'fill')
      expect(fills).toHaveLength(1)
      expect(out.secrets).toEqual(['529'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('fills: blur commita (sem esperar o debounce)', () => {
    setBody('<input id="u" name="user" type="text" />')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T2' }))
    const input = document.querySelector('#u') as HTMLInputElement
    input.value = 'joao'
    inputEvent(input)
    focusout(input)
    const out = drain()
    expect(out.events.filter((e) => e.t === 'fill')).toHaveLength(1)
    expect(out.secrets).toEqual(['joao'])
  })

  it('drain esvazia buffers; seq continua monotônico no re-arme', () => {
    setBody('<button id="x">Ok</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(document.querySelector('#x') as Element)
    const first = drain()
    expect(first.events.length).toBe(1)
    const second = drain()
    expect(second.events).toHaveLength(0)
  })

  it('Enter em input dentro de form grava press; solto no body, não grava', () => {
    setBody('<form id="f"><input id="u" type="text" /></form>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T2' }))
    pressEnter(document.querySelector('#u') as Element)
    pressEnter(document.body)
    const out = drain()
    expect(out.events.filter((e) => e.t === 'press')).toHaveLength(1)
  })

  it('teardown remove listeners e limpa o buffer', () => {
    setBody('<button id="btn">Ok</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    const disposed = evalScript(buildTeardownScript(TOKEN)) as { ok: boolean }
    expect(disposed.ok).toBe(true)
    click(document.querySelector('#btn') as Element)
    expect(drain().ok).toBe(false)
  })
})
