/**
 * Fluxo agêntico de login — autonomia limitada, totalmente local.
 *
 * Em vez de uma lista fixa de passos, o agente roda um ciclo:
 *   PERCEBER (captura a tela) → DECIDIR (o que fazer agora?) → AGIR → repetir
 *
 * Até que: o login seja detectado, a sessão exija ação humana (captcha/2FA),
 * a credencial não sirva mais (página mudou), ou o orçamento de iterações
 * se esgote. Nunca envia dados para fora do portal — nenhum texto da página
 * sai da estação; só CSS/Text-content/inputs, avaliados localmente.
 *
 * Objetivo operacional: entrar em portais cujo login seja "página pública →
 * botão Fazer login → formulário CPF/CNPJ + senha → Entrar" (ex.: ISS
 * Fortaleza, e-SEFIN, gov.br SSO), sem seletor fixo configurado pelo usuário.
 */
import { safeExecute, type RecipeTarget } from './runner'

export interface AgentValues {
  username: string
  password: string
  document: string
  clientName: string
}

export type AgentStatus = 'authenticated' | 'manual' | 'awaiting_login' | 'error'

export interface AgentResult {
  status: AgentStatus
  message: string
  twoFactorDetected: boolean
  captchaDetected: boolean
  iterations: number
  lastUrl: string
}

export interface AgentOptions {
  values: AgentValues
  target: RecipeTarget
  onProgress?: (stepIndex: number, total: number) => void
  sleep?: (ms: number) => Promise<void>
  /** Máx. de iterações do ciclo perceber→agir. Padrão 24. */
  maxIterations?: number
  /** Envia o formulário ao final (padrão true). Falso = apenas preenche. */
  autoSubmit?: boolean
}

/** Captura de tela estado da página — seguro, sem efeitos colaterais. */
const OBSERVE_SCRIPT = String.raw`
(function(){
  const visible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const isTextLike = (el) => {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (/^(text|email|tel|number|search|cpf)$/.test(t)) return true;
    const hint = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')].filter(Boolean).join(' ').toLowerCase();
    return /(user|login|cpf|cnpj|email|conta|usuario|matricula|inscricao|documento|identi|acesso)/.test(hint);
  };
  const password = inputs.find((el) => (el.getAttribute('type') || '').toLowerCase() === 'password') || null;
  const user = inputs.find((el) => el !== password && isTextLike(el)) || null;
  const buttons = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="image"]')).filter(visible).map(textOf).filter((t) => t && t.length <= 80).slice(0, 60);
  const captcha = Boolean(document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,[class*="captcha" i]'));
  const twoFactor = Boolean(document.querySelector('input[autocomplete="one-time-code"],input[name*="otp" i],input[name*="codigo" i]'));
  const bodyText = (document.body && document.body.innerText) || '';
  const loggedIn = Boolean(document.querySelector('a[href*="logout" i],a[href*="signout" i],a[href*="sair" i],button[aria-label*="Sair" i]')) || /\b(sair da conta|meus serviços|minha conta|alterar perfil de acesso|certidões)\b/i.test(bodyText.slice(0, 4000));
  return {
    href: location.href,
    userPresent: Boolean(user),
    passPresent: Boolean(password),
    userFilled: user ? user.value.trim().length > 0 : false,
    passFilled: password ? password.value.trim().length > 0 : false,
    buttons,
    captcha,
    twoFactor,
    loggedIn,
  };
})()`

/** Encontra e clica o melhor CTA de entrada visível; retorna o rótulo ou null. */
const CLICK_CTA_SCRIPT = (target: string) => String.raw`
(function(){
  const visible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const want = ${JSON.stringify(target.toLowerCase())};
  const candidates = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="image"]')).filter(visible);
  const exact = candidates.find((el) => textOf(el) === want);
  const fuzzy = candidates.find((el) => textOf(el).includes(want));
  const el = exact || fuzzy;
  if (!el) return { ok: false, detail: 'cta nao encontrado: ' + want };
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
  try { el.click(); } catch {}
  return { ok: true, detail: 'clicado: ' + textOf(el).slice(0, 80) };
})()`

/** Preenche usuário e/ou senha (campos vazios). Retorna o que preencheu. */
const FILL_SCRIPT = (username: string, password: string) => String.raw`
(function(){
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
  const setter = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const pass = inputs.find((el) => (el.getAttribute('type') || '').toLowerCase() === 'password') || null;
  const user = inputs.find((el) => el !== pass && isTextLike(el)) || null;
  const done = [];
  if (user && ${JSON.stringify(username)} && !user.value) { try { setter(user, ${JSON.stringify(username)}); done.push('usuario'); } catch {} }
  if (pass && ${JSON.stringify(password)} && !pass.value) { try { setter(pass, ${JSON.stringify(password)}); done.push('senha'); } catch {} }
  return { ok: true, detail: done.length ? 'preenchido: ' + done.join('+') : 'nada a preencher' };
})()`

/** Clica "Avançar/Continuar/Próximo" visível (fluxos CPF em duas etapas). */
const ADVANCE_SCRIPT = String.raw`
(function(){
  const visible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const candidates = Array.from(document.querySelectorAll('a,button,[role="button"],input[type="submit"],input[type="image"]')).filter(visible);
  const match = candidates.find((el) => /^(avan[cç]ar|continuar|pr[oó]ximo|prosseguir|ir para|enviar)$/.test(textOf(el)));
  if (!match) return { ok: false, detail: 'botao de avancar nao encontrado' };
  try { match.scrollIntoView({ block: 'center' }); } catch {}
  try { match.click(); } catch {}
  return { ok: true, detail: 'clicado: ' + textOf(match).slice(0, 60) };
})()`

/** Submete o formulário de senha (requestSubmit no form da senha). */
const SUBMIT_SCRIPT = String.raw`
(function(){
  const password = (function(){
    const els = Array.from(document.querySelectorAll('input[type="password"]'));
    return els.find((el) => {
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    }) || null;
  })();
  if (!password) return { ok: false, detail: 'campo de senha nao encontrado' };
  const form = password.form;
  if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(); return { ok: true, detail: 'requestSubmit' }; }
  const btn = form ? form.querySelector('button[type="submit"],input[type="submit"],#botao-entrar') : null;
  if (btn && typeof btn.click === 'function') { btn.click(); return { ok: true, detail: 'clique no botao Entrar' }; }
  return { ok: false, detail: 'formulario sem requestSubmit nem botao submit' };
})()`

const CTA_CANDIDATES = ['fazer login', 'acessar', 'acessar o sistema', 'entrar com gov.br', 'entrar', 'login']

export async function runAgenticLogin(options: AgentOptions): Promise<AgentResult> {
  const { values, target } = options
  const maxIterations = options.maxIterations ?? 24
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const autoSubmit = options.autoSubmit !== false
  const startUrl = target.getURL()

  for (let index = 0; index < maxIterations; index += 1) {
    if (target.isDestroyed()) {
      return {
        status: 'error',
        message: 'A sessão foi encerrada durante a automação.',
        twoFactorDetected: false,
        captchaDetected: false,
        iterations: index,
        lastUrl: startUrl,
      }
    }
    options.onProgress?.(index, maxIterations)

    const obs = await safeExecute<{
      href: string
      userPresent: boolean
      passPresent: boolean
      userFilled: boolean
      passFilled: boolean
      buttons: string[]
      captcha: boolean
      twoFactor: boolean
      loggedIn: boolean
    }>(target, OBSERVE_SCRIPT, 8_000)

    if (!obs) {
      await sleep(500)
      continue
    }

    if (obs.loggedIn) {
      return {
        status: 'authenticated',
        message: 'Login detectado.',
        twoFactorDetected: false,
        captchaDetected: false,
        iterations: index + 1,
        lastUrl: obs.href,
      }
    }

    if (obs.captcha || obs.twoFactor) {
      return {
        status: 'manual',
        message: obs.captcha
          ? 'CAPTCHA detectado no portal. Conclua o desafio na tela aberta.'
          : 'Verificação em duas etapas detectada. Conclua o código na tela aberta.',
        twoFactorDetected: obs.twoFactor,
        captchaDetected: obs.captcha,
        iterations: index + 1,
        lastUrl: obs.href,
      }
    }

    // 1) Há formulário de login? Preenche / confirma.
    if (obs.userPresent || obs.passPresent) {
      if (!obs.userFilled || !obs.passFilled) {
        await safeExecute(target, FILL_SCRIPT(values.username, values.password), 6_000)
        await sleep(350)
        continue
      }
      // Ambos preenchidos: envia (se permitido) ou espera o clique do usuário.
      if (autoSubmit) {
        const result = await safeExecute<{ ok: boolean; detail: string }>(
          target,
          SUBMIT_SCRIPT,
          6_000,
        )
        if (!result?.ok) {
          return {
            status: 'manual',
            message: `Não foi possível enviar o formulário (${result?.detail ?? 'sem resposta'}).`,
            twoFactorDetected: false,
            captchaDetected: false,
            iterations: index + 1,
            lastUrl: obs.href,
          }
        }
        await sleep(1_500)
        continue
      }
      // autoSubmit=false: campos prontos; usuário clica em Entrar.
      return {
        status: 'awaiting_login',
        message: 'Campos preenchidos. Conclua o login no portal.',
        twoFactorDetected: false,
        captchaDetected: false,
        iterations: index + 1,
        lastUrl: obs.href,
      }
    }

    // 2) Sem formulário visível: existe CTA para entrar?
    const cta = CTA_CANDIDATES.find((candidate) => obs.buttons.some((label) => label === candidate || label.includes(candidate)))
    if (cta) {
      await safeExecute(target, CLICK_CTA_SCRIPT(cta), 6_000)
      await sleep(800)
      continue
    }

    // 3) Há botão de avanço (CPF preenchido em duas etapas)?
    if (obs.userFilled && !obs.passPresent) {
      const advanced = await safeExecute<{ ok: boolean; detail: string }>(
        target,
        ADVANCE_SCRIPT,
        6_000,
      )
      if (advanced?.ok) {
        await sleep(800)
        continue
      }
    }

    // 4) Nada a fazer ainda (página navegando/renderizando).
    await sleep(600)
  }

  return {
    status: 'awaiting_login',
    message: 'O portal não confirmou o login no tempo esperado. Use a tela aberta para concluir.',
    twoFactorDetected: false,
    captchaDetected: false,
    iterations: maxIterations,
    lastUrl: target.getURL(),
  }
}

export function agentValues(input: {
  username?: string
  password?: string
  document?: string
  clientName?: string
}): AgentValues {
  return {
    username: input.username ?? '',
    password: input.password ?? '',
    document: input.document ?? '',
    clientName: input.clientName ?? '',
  }
}
