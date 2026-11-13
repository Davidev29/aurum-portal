import type { RecipeDefinition, RecipeStep } from '../../../shared/recipe'
import { resolveRecipeTemplate } from '../../../shared/recipe'

export interface RecipeValues {
  username: string
  password: string
  document: string
  clientName: string
  /** Valores dos campos nomeados do serviço (ex.: {{credential.codigo_empresa}}),
   * descriptografados em memória a cada abertura de sessão. */
  extraValues?: Record<string, string>
}

export interface RecipeActionResult {
  ok: boolean
  selector: string | null
  detail: string
}

export interface InterstitialDetection {
  captcha: boolean
  twoFactor: boolean
}

// String.raw: sem isso, `\s` do regex vira apenas `s` no JavaScript final
// injetado na página (quebrando o casamento de texto e a normalização de
// espaços em todos os seletores `text=`).
const FINDER = String.raw`
function __pvVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
function __pvTextElements(text) {
  const target = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const nodes = Array.from(document.querySelectorAll('body *')).filter((el) => {
    if (['SCRIPT','STYLE','NOSCRIPT','HTML','BODY'].includes(el.tagName)) return false;
    const value = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return value === target && __pvVisible(el);
  });
  if (nodes.length > 0) return nodes;
  return Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"]')).filter((el) => {
    const value = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return value.includes(target) && __pvVisible(el);
  });
}
function __pvFind(selectors) {
  for (const selector of selectors) {
    try {
      if (selector.startsWith('text=')) {
        const found = __pvTextElements(selector.slice(5));
        if (found.length) return found[0];
        continue;
      }
      const hasText = selector.match(/^(.*?):has-text\((['"])(.*?)\2\)$/);
      if (hasText) {
        const base = hasText[1].trim() || '*';
        const needle = hasText[3].toLowerCase();
        const found = Array.from(document.querySelectorAll(base)).find((el) => {
          const value = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return value.includes(needle) && __pvVisible(el);
        });
        if (found) return found;
        continue;
      }
      const found = Array.from(document.querySelectorAll(selector)).find(__pvVisible);
      if (found) return found;
    } catch (_) {
      // Selector invalido: tenta o proximo candidato.
    }
  }
  return null;
}
function __pvSetValue(el, value) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
  } else if (el instanceof HTMLSelectElement) {
    const option = Array.from(el.options).find((item) => item.value === value || item.text.trim() === value);
    el.value = option ? option.value : value;
  } else if (el.isContentEditable) {
    el.textContent = value;
  } else {
    el.value = value;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
`

function wrap(body: string): string {
  return `(async () => { ${FINDER}\n${body}\n})()`
}

export function buildWaitScript(selectors: string[], timeoutMs: number): string {
  return `(async () => {
    ${FINDER}
    const selectors = ${JSON.stringify(selectors)};
    const deadline = Date.now() + ${Math.max(100, timeoutMs)};
    while (Date.now() < deadline) {
      if (__pvFind(selectors)) return { ok: true, selector: null, detail: 'elemento encontrado' };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { ok: false, selector: null, detail: 'timeout aguardando seletor' };
  })()`
}

export function buildActionScript(step: RecipeStep, values: RecipeValues): string {
  const selectors = step.selectors ?? []
  if (step.action === 'waitFor') return buildWaitScript(selectors, step.timeoutMs ?? 30_000)
  if (step.action === 'sleep') return wrap('return { ok: true, selector: null, detail: "sleep" }')
  if (step.action === 'evaluate') {
    // Contrato oficial: o script evaluate e o CORPO de uma funcao async
    // (mesma convencao de waitFor/buildPostLoginScript). Pode conter `await`
    // no nivel superior e `return 'string'` para detalhar o resultado.
    //
    // Placeholders ({{credential.username}} etc.) sao substituidos por
    // LITERAIS JSON no momento da compilacao (com aspas): o script deve usar
    // `const PV_PASS = {{credential.password}};` — nunca entre aspas proprias.
    // Segredos nunca sao interpolados como texto cru (evita injecao).
    const resolved = resolveRecipeTemplate(
      step.script ?? 'true',
      {
        username: JSON.stringify(values.username ?? ''),
        password: JSON.stringify(values.password ?? ''),
        document: JSON.stringify(values.document ?? ''),
        clientName: JSON.stringify(values.clientName ?? ''),
      },
      values.extraValues
        ? Object.fromEntries(
            Object.entries(values.extraValues).map(([k, v]) => [k, JSON.stringify(v ?? '')]),
          )
        : undefined,
    )
    return wrap(`
      try {
        const value = await (async () => { ${resolved} })();
        return { ok: true, selector: null, detail: typeof value === 'string' ? value.slice(0, 800) : 'evaluate ok' };
      } catch (error) {
        return { ok: false, selector: null, detail: String(error?.message || error).slice(0, 800) };
      }
    `)
  }
  if (step.action === 'assert') {
    const script = step.script ?? ''
    return wrap(`
      const el = __pvFind(${JSON.stringify(selectors)});
      if (el) return { ok: true, selector: null, detail: 'assert por seletor' };
      if (${JSON.stringify(Boolean(script))}) {
        try { return { ok: Boolean((function(){ ${script} })()), selector: null, detail: 'assert por script' }; }
        catch (error) { return { ok: false, selector: null, detail: String(error?.message || error).slice(0, 200) }; }
      }
      return { ok: false, selector: null, detail: 'assert falhou' };
    `)
  }
  if (step.action === 'click') {
    return wrap(`
      const el = __pvFind(${JSON.stringify(selectors)});
      if (!el) return { ok: false, selector: null, detail: 'elemento nao encontrado' };
      try {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        if (typeof el.focus === 'function') el.focus();
        el.click();
        return { ok: true, selector: null, detail: 'click' };
      } catch (error) {
        return { ok: false, selector: null, detail: String(error?.message || error).slice(0, 200) };
      }
    `)
  }
  if (step.action === 'fill') {
    const resolved = resolveRecipeTemplate(step.value ?? '', values, values.extraValues)
    return wrap(`
      const el = __pvFind(${JSON.stringify(selectors)});
      if (!el) return { ok: false, selector: null, detail: 'campo nao encontrado' };
      if (el.disabled || el.readOnly) return { ok: false, selector: null, detail: 'campo desabilitado' };
      try {
        __pvSetValue(el, ${JSON.stringify(resolved)});
        return { ok: true, selector: null, detail: 'fill' };
      } catch (error) {
        return { ok: false, selector: null, detail: String(error?.message || error).slice(0, 200) };
      }
    `)
  }
  if (step.action === 'press') {
    const key = step.key ?? 'Enter'
    return wrap(`
      const el = __pvFind(${JSON.stringify(selectors)}) || document.activeElement;
      if (!el) return { ok: false, selector: null, detail: 'elemento nao encontrado' };
      const init = { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      el.dispatchEvent(new KeyboardEvent('keypress', init));
      el.dispatchEvent(new KeyboardEvent('keyup', init));
      if (${JSON.stringify(key)} === 'Enter' && el.form && typeof el.form.requestSubmit === 'function') {
        el.form.requestSubmit();
      }
      return { ok: true, selector: null, detail: 'press' };
    `)
  }
  return wrap('return { ok: false, selector: null, detail: "acao nao suportada" }')
}

export function buildDetectScript(recipe: RecipeDefinition): string {
  return wrap(`
    const captchaSelectors = ${JSON.stringify(recipe.captchaSelectors ?? [])};
    const twoFactorSelectors = ${JSON.stringify(recipe.twoFactorSelectors ?? [])};
    return {
      captcha: Boolean(__pvFind(captchaSelectors)),
      twoFactor: Boolean(__pvFind(twoFactorSelectors)),
    };
  `)
}

export interface PostLoginUrlGuard {
  urlIncludes?: string[] | undefined
  urlExcludes?: string[] | undefined
}

export function buildPostLoginScript(
  selectors: string[],
  timeoutMs: number,
  urlGuard?: PostLoginUrlGuard,
): string {
  const includes = JSON.stringify(urlGuard?.urlIncludes ?? [])
  const excludes = JSON.stringify(urlGuard?.urlExcludes ?? [])
  const hasGuard =
    (urlGuard?.urlIncludes?.length ?? 0) > 0 || (urlGuard?.urlExcludes?.length ?? 0) > 0
  if (!hasGuard) return buildWaitScript(selectors, timeoutMs)
  return `(async () => {
    ${FINDER}
    const selectors = ${JSON.stringify(selectors)};
    const includes = ${includes};
    const excludes = ${excludes};
    const deadline = Date.now() + ${Math.max(100, timeoutMs)};
    const passUrl = () => {
      const href = location.href;
      if (includes.length > 0 && !includes.some((needle) => href.includes(needle))) return false;
      if (excludes.some((needle) => href.includes(needle))) return false;
      return true;
    };
    while (Date.now() < deadline) {
      if (passUrl() && __pvFind(selectors)) {
        return { ok: true, selector: null, detail: 'elemento encontrado' };
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return { ok: false, selector: null, detail: 'timeout aguardando seletor' };
  })()`
}

export function buildAutoSubmitScript(): string {
  return wrap(`
    const password = __pvFind(['input[type="password"]']);
    if (!password) return { ok: false, selector: null, detail: 'campo de senha nao encontrado' };
    const form = password.form;
    if (form && typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return { ok: true, selector: null, detail: 'auto-submit' };
    }
    password.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    password.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    return { ok: true, selector: null, detail: 'auto-submit por Enter' };
  `)
}

export function recipeValues(input: {
  username?: string
  password?: string
  document?: string
  clientName?: string
  extraValues?: Record<string, string>
}): RecipeValues {
  return {
    username: input.username ?? '',
    password: input.password ?? '',
    document: input.document ?? '',
    clientName: input.clientName ?? '',
    extraValues: input.extraValues,
  }
}

export function pickStepTimeout(step: RecipeStep): number {
  return Math.min(Math.max(step.timeoutMs ?? 30_000, 100), 120_000)
}

export function isSensitiveStep(step: RecipeStep): boolean {
  if (step.action === 'fill') {
    return (step.value ?? '').includes('{{credential.password}}')
  }
  if (step.action === 'evaluate') {
    return (step.script ?? '').includes('{{credential.password}}')
  }
  return false
}
