// @vitest-environment jsdom
/**
 * Recorder in-page (jsdom) — o script é um IIFE autocontido avaliado via eval;
 * acessamos os globais do jsdom via `globalThis` tipado como any para o tsc
 * (o projeto de testes roda sem a lib DOM).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDrainScript,
  buildRecorderScript,
  buildTeardownScript,
  type RecordedDrain,
} from '../../electron/main/recipes/recorder'

/* eslint-disable @typescript-eslint/no-explicit-any */
const G = globalThis as any
const doc = (): any => G.document

const TOKEN = 'test-token'

function evalScript(script: string): any {
  return (0, eval)(script)
}

function drain(): RecordedDrain {
  return evalScript(buildDrainScript(TOKEN)) as RecordedDrain
}

function setBody(html: string): void {
  doc().body.innerHTML = html
}

function qs(selector: string): any {
  return doc().querySelector(selector)
}

function click(el: any): void {
  el.dispatchEvent(new G.MouseEvent('click', { bubbles: true, composed: true }))
}

function inputEvent(el: any): void {
  el.dispatchEvent(new G.Event('input', { bubbles: true }))
}

function focusout(el: any): void {
  el.dispatchEvent(new G.FocusEvent('focusout', { bubbles: true }))
}

function pressEnter(el: any): void {
  el.dispatchEvent(new G.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

beforeEach(() => {
  doc().body.innerHTML = ''
  if (G.__aurumbitRec) delete G.__aurumbitRec
  // jsdom não faz layout: stub de rect não-zero para o checador de visibilidade.
  G.Element.prototype.getBoundingClientRect = function getBoundingClientRect(): any {
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
    }
  }
})

describe('recorder in-page — captura de eventos', () => {
  it('arma o script e retorna ok; clique em botão interativo é gravado', () => {
    setBody('<button id="btn-entrar">Entrar</button>')
    const arm = evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    expect(arm.ok).toBe(true)

    click(qs('#btn-entrar'))

    const out = drain()
    expect(out.ok).toBe(true)
    expect(out.events).toHaveLength(1)
    const event = out.events[0] as any
    expect(event?.t).toBe('click')
    expect(out.secrets).toHaveLength(0)
    expect(event.label).toBe('Entrar')
    expect(event.candidates.some((c: any) => c.sel === '#btn-entrar')).toBe(true)
  })

  it('clique em div não interativa é descartado', () => {
    setBody('<div id="decor">Decor</div>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(qs('#decor'))
    expect(drain().events).toHaveLength(0)
  })

  it('id dinâmico (ember123) é rejeitado como candidato; cai para [name] ou text=', () => {
    setBody('<button id="ember12345" name="entrar">Entrar</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(qs('#ember12345'))
    const out = drain()
    const event = out.events[0] as any
    expect(event?.t).toBe('click')
    const sels = event.candidates.map((c: any) => c.sel)
    expect(sels.some((s: string) => s.startsWith('#ember'))).toBe(false)
    expect(sels.some((s: string) => s === '[name="entrar"]' || s === 'text=Entrar')).toBe(true)
  })

  it('double-click humano no mesmo alvo vira 1 etapa', () => {
    setBody('<button id="go">Continuar</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(qs('#go'))
    click(qs('#go'))
    expect(drain().events.filter((e) => e.t === 'click')).toHaveLength(1)
  })

  it('fills: input coalescado por debounce de 400ms (1 fill por campo)', () => {
    vi.useFakeTimers()
    try {
      setBody('<input id="cpf" name="cpf" type="text" />')
      evalScript(buildRecorderScript({ token: TOKEN, screen: 'T2' }))
      const input = qs('#cpf')
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
    const input = qs('#u')
    input.value = 'joao'
    inputEvent(input)
    focusout(input)
    const out = drain()
    expect(out.events.filter((e) => e.t === 'fill')).toHaveLength(1)
    expect(out.secrets).toEqual(['joao'])
  })

  it('drain esvazia buffers; segundo drain devolve vazio', () => {
    setBody('<button id="x">Ok</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    click(qs('#x'))
    expect(drain().events).toHaveLength(1)
    expect(drain().events).toHaveLength(0)
  })

  it('Enter em input dentro de form grava press; solto no body, não grava', () => {
    setBody('<form id="f"><input id="u" type="text" /></form>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T2' }))
    pressEnter(qs('#u'))
    pressEnter(doc().body)
    expect(drain().events.filter((e) => e.t === 'press')).toHaveLength(1)
  })

  it('teardown remove listeners e limpa o buffer', () => {
    setBody('<button id="btn">Ok</button>')
    evalScript(buildRecorderScript({ token: TOKEN, screen: 'T1' }))
    const disposed = evalScript(buildTeardownScript(TOKEN))
    expect(disposed.ok).toBe(true)
    click(qs('#btn'))
    expect(drain().ok).toBe(false)
  })
})
