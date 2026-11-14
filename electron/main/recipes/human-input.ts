/**
 * Entrada "humana" — IPC sintético tem comportamento robótico óbvio (valor
 * setado instantaneamente, `.click()` direto, `KeyboardEvent` artificial).
 * hCaptcha/reCAPTCHA comportamentais e "selenium sniffing" reagem a isso:
 * o login dispara captcha mesmo sem captcha visível na página.
 *
 * Este módulo desvia os passos de interação (click/fill/press) para os
 * eventos CONFIÁVEIS do Electron (`webContents.sendInputEvent`), que passam
 * pelo pipeline de input do Chromium e, consequentemente, pelo que o
 * hCaptcha observa: movimento real de mouse terminando no alvo, sequência
 * down/up humana, e digitação char-a-char com cadência irregular.
 *
 * Compatibilidade: targets sem `sendInputEvent` caem para o caminho JS
 * legado (scripts injetados) — unit tests atuais seguem verdes por construção.
 */
import type { RecipeTarget } from './runner'

export interface HumanInputEvent {
  type: 'mouseMove' | 'mouseDown' | 'mouseUp' | 'char' | 'keyDown' | 'keyUp'
  x?: number
  y?: number
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
  keyCode?: string
}

export interface HumanInputTarget extends RecipeTarget {
  sendInputEvent?(event: HumanInputEvent): void
}

export interface HumanOptions {
  /** Injeção de relógio para testes. Padrão: setTimeout real. */
  sleep?: (ms: number) => Promise<void>
  /** Injeção de PRNG para testes. Padrão: Math.random. */
  random?: () => number
}

interface ProbeResult {
  found: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  disabled?: boolean
  readOnly?: boolean
  tagName?: string
  editable?: boolean
}

const SELECTOR_TYPES_BODY = `
  function __huVisible(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (!s || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function __huTextElements(text) {
    const target = text.replace(/\\s+/g, ' ').trim().toLowerCase();
    const nodes = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (['SCRIPT','STYLE','NOSCRIPT','HTML','BODY'].includes(el.tagName)) return false;
      const value = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      return value === target && __huVisible(el);
    });
    return nodes;
  }
  function __huFind(selectors) {
    for (const selector of selectors) {
      try {
        if (selector.startsWith('text=')) {
          const found = __huTextElements(selector.slice(5));
          if (found.length) return found[0];
          continue;
        }
        const hasText = selector.match(/^(.*?):has-text\\((['"])(.*?)\\2\\)$/);
        if (hasText) {
          const base = hasText[1].trim() || '*';
          const needle = hasText[3].toLowerCase();
          const found = Array.from(document.querySelectorAll(base)).find((el) => {
            const value = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            return value.includes(needle) && __huVisible(el);
          });
          if (found) return found;
          continue;
        }
        const el = document.querySelector(selector);
        if (el && __huVisible(el)) return el;
      } catch { /* seletor inválido — tenta o próximo */ }
    }
    return null;
  }
`

function buildProbeScript(selectors: string[]): string {
  return `(() => {
    ${SELECTOR_TYPES_BODY}
    const el = __huFind(${JSON.stringify(selectors)});
    if (!el) return { found: false };
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return {
      found: true,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      width: rect.width,
      height: rect.height,
      disabled: Boolean(el.disabled),
      readOnly: Boolean(el.readOnly),
      editable: !(el.disabled || el.readOnly),
      tagName: String(el.tagName || '').toLowerCase(),
    };
  })()`
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function randBetween(random: () => number, min: number, max: number): number {
  return Math.floor(min + random() * (max - min))
}

// Posição do "último mouse" — simulação de que o cursor já existia antes do clique
// (humano não aparece clicando num ponto sem ter vindo de algum lugar).
const lastPointerPosition = new WeakMap<object, { x: number; y: number }>()
const DEFAULT_POINTER = { x: 320, y: 240 }

function pointerFor(
  target: HumanInputTarget,
  random: () => number,
): { x: number; y: number } {
  let position = lastPointerPosition.get(target as unknown as object)
  if (!position) {
    position = {
      x: DEFAULT_POINTER.x + randBetween(random, 0, 420),
      y: DEFAULT_POINTER.y + randBetween(random, 0, 260),
    }
    lastPointerPosition.set(target as unknown as object, position)
  }
  return position
}

function setPointer(target: HumanInputTarget, position: { x: number; y: number }): void {
  lastPointerPosition.set(target as unknown as object, { ...position })
}

/** Curva de Bézier cúbica — o mouse humano não vai em reta. */
function bezierPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  random: () => number,
  steps: number,
): Array<{ x: number; y: number }> {
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const wobble = Math.min(240, Math.max(80, distance * 0.22))
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const normal = angle + Math.PI / 2
  // Pontos de controle fora da reta, cada um para um lado alternado
  const c1 = {
    x: from.x + (to.x - from.x) * 0.28 + Math.cos(normal) * wobble * (random() - 0.5) * 2,
    y: from.y + (to.y - from.y) * 0.28 + Math.sin(normal) * wobble * (random() - 0.5) * 2,
  }
  const c2 = {
    x: from.x + (to.x - from.x) * 0.72 + Math.cos(normal) * wobble * (random() - 0.5) * 2,
    y: from.y + (to.y - from.y) * 0.72 + Math.sin(normal) * wobble * (random() - 0.5) * 2,
  }
  const points: Array<{ x: number; y: number }> = []
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps
    const oneMinus = 1 - t
    const x =
      oneMinus ** 3 * from.x + 3 * oneMinus ** 2 * t * c1.x + 3 * oneMinus * t ** 2 * c2.x + t ** 3 * to.x
    const y =
      oneMinus ** 3 * from.y + 3 * oneMinus ** 2 * t * c1.y + 3 * oneMinus * t ** 2 * c2.y + t ** 3 * to.y
    points.push({ x: Math.round(x), y: Math.round(y) })
  }
  return points
}

async function probeElement(
  target: HumanInputTarget,
  selectors: string[],
): Promise<ProbeResult> {
  try {
    const result = (await target.executeJavaScript<ProbeResult | null>(
      buildProbeScript(selectors),
    )) as ProbeResult | null | undefined
    return result && typeof result === 'object' && result.found ? result : { found: false }
  } catch {
    // executeJavaScript rejeitou (página ocupada) — probe impossível.
    return { found: false }
  }
}

/** Movimento humano até um ponto: sequência de mouseMoves + chegada. */
async function moveMouseTo(
  target: HumanInputTarget,
  to: { x: number; y: number },
  random: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const send = target.sendInputEvent?.bind(target)
  if (!send) return
  const from = pointerFor(target, random)
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  const steps = Math.max(6, Math.min(26, Math.floor(distance / 38) + 4))
  const path = bezierPoints(from, to, random, steps)
  for (const point of path) {
    send({ type: 'mouseMove', x: point.x, y: point.y })
    await sleep(randBetween(random, 9, distance > 500 ? 26 : 42))
  }
  setPointer(target, to)
}

async function clickAt(
  target: HumanInputTarget,
  at: { x: number; y: number },
  opts: HumanOptions,
): Promise<void> {
  const send = target.sendInputEvent?.bind(target)
  if (!send) return
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? realSleep
  await moveMouseTo(target, at, random, sleep)
  await sleep(randBetween(random, 70, 165))
  send({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 })
  await sleep(randBetween(random, 45, 110))
  send({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 })
}

const AGENT_PICK_INPUTS_SCRIPT = `(function(){
  const visible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isTextLike = (el) => {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (/^(text|email|tel|number|search|cpf)$/.test(t)) return true;
    const hint = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
    return /(user|login|cpf|cnpj|email|conta|usuario|matricula|inscricao|documento|identi|acesso)/.test(hint);
  };
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const pass = inputs.find((el) => el.getAttribute('type') === 'password') || null;
  const user = inputs.find((el) => el !== pass && isTextLike(el)) || null;
  const pick = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height, tagName: String(el.tagName || '').toLowerCase() };
  };
  return { user: pick(user), pass: pick(pass) };
})()`

export interface ProbeInputPoint {
  x: number
  y: number
  width: number
  height: number
  tagName: string
}

// ---------------- humanTypeIntoPoint ----------------

export interface PointInputProbe {
  user: ProbeInputPoint | null
  pass: ProbeInputPoint | null
}

/** Encontra (via heurística de página) os campos de usuário/senha visíveis. */
export async function probeLoginInputs(
  target: HumanInputTarget,
): Promise<PointInputProbe> {
  try {
    const result = (await target.executeJavaScript<PointInputProbe | null>(
      AGENT_PICK_INPUTS_SCRIPT,
    )) as PointInputProbe | null
    if (!result) return { user: null, pass: null }
    return { user: result.user ?? null, pass: result.pass ?? null }
  } catch {
    return { user: null, pass: null }
  }
}

/** Move o mouse até um ponto e clica, como um humano. */
export async function humanClickPoint(
  target: HumanInputTarget,
  point: { x: number; y: number },
  opts: HumanOptions = {},
): Promise<{ ok: boolean; detail: string }> {
  const send = target.sendInputEvent?.bind(target)
  if (!send) return { ok: false, detail: 'sem sendInputEvent' }
  await clickAt(target, { x: Math.round(point.x), y: Math.round(point.y) }, opts)
  return { ok: true, detail: 'click-humano' }
}

/** Digita um valor char a char num ponto focado (mesmo ritmo do fill humano). */
export async function humanTypeValue(
  target: HumanInputTarget,
  value: string,
  opts: HumanOptions = {},
): Promise<{ ok: boolean; detail: string }> {
  const send = target.sendInputEvent?.bind(target)
  if (!send) return { ok: false, detail: 'sem sendInputEvent' }
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? realSleep
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string
    send({ type: 'char', keyCode: char })
    const roll = random()
    if (roll < 0.09) {
      await sleep(randBetween(random, 160, 420))
    } else {
      await sleep(randBetween(random, 26, 112))
    }
  }
  await sleep(randBetween(random, 110, 220))
  return { ok: true, detail: 'digitacao-humana' }
}

/** Preenche usuário e/ou senha via eventos confiáveis (pipe Chromium). */
export async function humanFillLoginPair(
  target: HumanInputTarget,
  values: { username?: string; password?: string },
  opts: HumanOptions = {},
): Promise<{ ok: boolean; detail: string }> {
  const probe = await probeLoginInputs(target)
  if (!probe.user && !probe.pass) {
    return { ok: false, detail: 'inputs de login nao encontrados' }
  }
  const filled: string[] = []
  if (probe.user && values.username) {
    const clicked = await humanClickPoint(target, probe.user, opts)
    if (clicked.ok) {
      const typed = await humanTypeValue(target, values.username, opts)
      if (typed.ok) filled.push('usuario')
    }
  }
  if (probe.pass && values.password) {
    const clicked = await humanClickPoint(target, probe.pass, opts)
    if (clicked.ok) {
      const typed = await humanTypeValue(target, values.password, opts)
      if (typed.ok) filled.push('senha')
    }
  }
  if (filled.length > 0) return { ok: true, detail: 'preenchido: ' + filled.join('+') }
  return { ok: false, detail: 'nada a preencher' }
}

/**
 * Clica num elemento como um humano: move o mouse em curva até o alvo e
 * faz mouseDown/mouseUp com cadência natural. Retorna `found: false` quando
 * o alvo não existe/visível — o chamador cai no caminho legado.
 */
export async function humanClickElement(
  target: HumanInputTarget,
  selectors: string[],
  opts: HumanOptions = {},
): Promise<{ ok: boolean; detail: string }> {
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? realSleep
  const send = target.sendInputEvent?.bind(target)
  if (!send) return { ok: false, detail: 'cíclico sem sendInputEvent' }
  const probe = await probeElement(target, selectors)
  if (!probe.found) return { ok: false, detail: 'elemento nao encontrado' }
  await clickAt(target, { x: Math.round(probe.x ?? 0), y: Math.round(probe.y ?? 0) }, opts)
  return { ok: true, detail: 'click-humano' }
}

/**
 * Digita um valor em um elemento como um humano: clica no campo, depois
 * emite char por char com cadência irregular (base ~55ms ± jitter, com
 * pausas de "reflexão" ocasionais).
 */
export async function humanFillElement(
  target: HumanInputTarget,
  selectors: string[],
  value: string,
  opts: HumanOptions = {},
): Promise<{ ok: boolean; detail: string }> {
  const send = target.sendInputEvent?.bind(target)
  if (!send) return { ok: false, detail: 'sem sendInputEvent' }
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? realSleep
  const clicked = await humanClickElement(target, selectors, opts)
  if (!clicked.ok) return clicked
  await sleep(randBetween(random, 140, 260))
  const probe = await probeElement(target, selectors)
  if (!probe.found) return { ok: false, detail: 'campo sumiu após clique' }
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] as string
    send({ type: 'char', keyCode: char })
    const roll = random()
    if (roll < 0.09) {
      await sleep(randBetween(random, 160, 420))
    } else {
      await sleep(randBetween(random, 26, 112))
    }
  }
  await sleep(randBetween(random, 120, 240))
  return { ok: true, detail: 'fill-humano' }
}

const KEY_CODES: Record<string, string> = {
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  ArrowDown: 'Down',
  ArrowUp: 'Up',
}

/** Pressiona uma tecla como um humano (keyDown/keyUp com cadência natural). */
export async function humanPressKey(
  target: HumanInputTarget,
  key: string,
  opts: HumanOptions = {},
): Promise<{ ok: boolean; detail: string }> {
  const send = target.sendInputEvent?.bind(target)
  if (!send) return { ok: false, detail: 'sem sendInputEvent' }
  const keyCode = KEY_CODES[key] ?? key
  const random = opts.random ?? Math.random
  const sleep = opts.sleep ?? realSleep
  send({ type: 'keyDown', keyCode })
  await sleep(randBetween(random, 55, 128))
  send({ type: 'keyUp', keyCode })
  return { ok: true, detail: 'press-humano' }
}
