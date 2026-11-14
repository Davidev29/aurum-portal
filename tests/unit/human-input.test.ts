import { describe, expect, it, vi } from 'vitest'
import {
  humanClickElement,
  humanFillElement,
  humanFillLoginPair,
  humanPressKey,
  type HumanInputEvent,
  type HumanInputTarget,
} from '../../electron/main/recipes/human-input'

function makeTarget(
  rect: Record<string, unknown> | null,
  input = true,
): HumanInputTarget & {
  events: HumanInputEvent[]
} {
  const events: HumanInputEvent[] = []
  let calls = 0
  const target = {
    events,
    async executeJavaScript<T>(code: string): Promise<T> {
      calls += 1
      void calls
      if (code.includes('__huFind')) {
        return { found: rect !== null, x: 200, y: 150, ...rect } as T
      }
      return rect as T
    },
    async loadURL() {
      return undefined
    },
    getURL() {
      return 'https://portal.example/login'
    },
    isDestroyed() {
      return false
    },
    stop() {
      return undefined
    },
  } as HumanInputTarget & { events: HumanInputEvent[] }
  if (input) {
    target.sendInputEvent = (event: HumanInputEvent) => {
      events.push(event)
    }
  }
  return target
}

const opts = { sleep: async () => undefined, random: () => 0.5 }

describe('human-input — pipeline de eventos confiáveis (hCaptcha)', () => {
  it('click: move o mouse em arco, depois mouseDown/mouseUp esquerdo', async () => {
    const target = makeTarget({ x: 200, y: 150, width: 100, height: 40 })
    const result = await humanClickElement(target, ['#entrar'], opts)
    expect(result.ok).toBe(true)
    const moves = target.events.filter((e) => e.type === 'mouseMove')
    expect(moves.length).toBeGreaterThanOrEqual(6)
    const lastMove = moves[moves.length - 1] as HumanInputEvent
    expect(Math.abs((lastMove.x ?? 0) - 200)).toBeLessThanOrEqual(2)
    const lastTwo = target.events.slice(-2)
    expect(lastTwo.map((e) => e.type)).toEqual(['mouseDown', 'mouseUp'])
    expect(lastTwo[0]?.button).toBe('left')
    expect(lastTwo[1]?.button).toBe('left')
  })

  it('click sem sendInputEvent → não emite nada', async () => {
    const target = makeTarget({ x: 100, y: 100 }, false)
    const result = await humanClickElement(target, ['#entrar'], opts)
    expect(result.ok).toBe(false)
    expect(target.events).toHaveLength(0)
  })

  it('click sem elemento → nenhum evento emitido', async () => {
    const target = makeTarget(null)
    const result = await humanClickElement(target, ['#nao-existe'], opts)
    expect(result.ok).toBe(false)
    expect(target.events).toHaveLength(0)
  })

  it('fill: digita caractere a caractere com eventos char', async () => {
    const target = makeTarget({ x: 200, y: 150, width: 200, height: 30 })
    const result = await humanFillElement(target, ['#cpf'], '52998224725', opts)
    expect(result.ok).toBe(true)
    const chars = target.events.filter((e) => e.type === 'char').map((e) => e.keyCode)
    expect(chars).toEqual('52998224725'.split(''))
  })

  it('fill com senha usa exatamente os chars da senha, sem vazamento de transformação', async () => {
    const target = makeTarget({ x: 200, y: 150, width: 200, height: 30 })
    await humanFillElement(target, ['#senha'], 'SenhaE2E!2026#', opts)
    const chars = target.events.filter((e) => e.type === 'char').map((e) => e.keyCode)
    expect(chars.join('')).toBe('SenhaE2E!2026#')
  })

  it('press: Enter envia keyDown + keyUp', async () => {
    const target = makeTarget({ x: 10, y: 10 })
    const result = await humanPressKey(target, 'Enter', opts)
    expect(result.ok).toBe(true)
    expect(target.events.map((e) => e.type)).toEqual(['keyDown', 'keyUp'])
    expect(target.events[0]?.keyCode).toBe('Enter')
  })

  it('login-pair: preenche usuário e depois senha, respeitando ordem do DOM', async () => {
    // Primeiro probe: user+pass retangulados; subsequentes respeitam a mesma forma.
    const target = makeTarget({ x: 200, y: 150, width: 100, height: 30 })
    vi.spyOn(target, 'executeJavaScript').mockImplementation(async (code: string) => {
      if (code.includes('password') && code.includes('user')) {
        return {
          user: { x: 100, y: 150, width: 200, height: 30, tagName: 'input' },
          pass: { x: 100, y: 220, width: 200, height: 30, tagName: 'input' },
        } as never
      }
      if (code.includes('__huFind')) {
        return { found: true, x: 100, y: 150 } as never
      }
      return null as never
    })
    const result = await humanFillLoginPair(
      target,
      { username: '52998224725', password: 'Secret!' },
      opts,
    )
    expect(result.ok).toBe(true)
    const chars = target.events.filter((e) => e.type === 'char').map((e) => e.keyCode)
    expect(chars.join('')).toBe('52998224725Secret!')
  })

  it('login-pair: sem campos reconhecidos → não digita nada', async () => {
    const target = makeTarget({})
    vi.spyOn(target, 'executeJavaScript').mockResolvedValue({ user: null, pass: null } as never)
    const result = await humanFillLoginPair(target, { username: 'u', password: 'p' }, opts)
    expect(result.ok).toBe(false)
    expect(target.events).toHaveLength(0)
  })
})
