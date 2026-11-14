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
import { probeReadiness, type ReadinessProbeSample } from './readiness'
import {
  humanClickElement,
  humanFillLoginPair,
  type HumanInputTarget,
} from './human-input'

/** Teto de parede do ciclo do agente (uma sessão de login). */
const AGENT_WALL_BUDGET_MS = 120_000

/** Pronta segundo a probe mínima (readyState completo, sem ocupador, rede quieta)? */
function minimalProbeReady(sample: ReadinessProbeSample | null): boolean {
  return Boolean(
    sample &&
    sample.recognized &&
    sample.readyState === 'complete' &&
    !sample.busyVisible &&
    sample.recentResourceCount === 0,
  )
}

export interface AgentFieldSpec {
  /** Legenda (texto visível ao lado do campo no portal) usada para localizar o
   * input. Ex.: 'Usuário', 'CPF', 'Código da empresa'. */
  name: string
  kind: 'username' | 'password' | 'text'
}

export interface AgentValues {
  username: string
  password: string
  document: string
  clientName: string
  /** Campos declarados na credencial (legenda + papel). O robô os localiza na
   * página pela legenda. Ausentes/vazio = comportamento legado (usuário e
   * senha por heurística). */
  fields?: AgentFieldSpec[]
  /** Valores dos campos nomeados do serviço (`{{credential.<key>}}`). */
  extraValues?: Record<string, string>
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
    inputs: inputs.length,
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

/** Linha pronta para procura na página: o valor JÁ resolvido (coluna do
 * cofre ou extra cifrada) — nada de segredo trafega para a página antes do
 * momento do fill. */
export interface FieldFillRow {
  name: string
  kind: 'username' | 'password' | 'text'
  value: string
}

/** Resolve as linhas que o robô deve procurar: usuário/senha vêm das colunas
 * da credencial; os demais vêm do cofre (`extraValues`). Linhas sem valor são
 * descartadas (nada a preencher, nada a cobrar). */
export function buildFieldRows(values: AgentValues): FieldFillRow[] {
  const extras = values.extraValues ?? {}
  return (values.fields ?? [])
    .map((field) => {
      const value =
        field.kind === 'username'
          ? values.username
          : field.kind === 'password'
            ? values.password
            : (extras[field.name] ?? '')
      return { name: field.name, kind: field.kind, value }
    })
    .filter((row) => row.value.length > 0)
}

/**
 * Preenche os campos declarados na credencial localizando cada um pela
 * LEGENDA (o texto visível ao lado do input — label, aria-label, placeholder,
 * name, id ou o texto do contêiner). Determinístico: pontuação por campo,
 * atribuição gulosa global por pontuação, desempate estável pela ordem do
 * documento. NUNCA sobrescreve um campo que já tem valor; NUNCA "chuta" um
 * campo sem confiança mínima — devolve `missing` com as legendas não
 * localizadas e o chamador decide (pausa humana com mensagem acionável).
 */
const FIELD_FILL_SCRIPT = (rows: FieldFillRow[]) => String.raw`
/* field-match-fill: localiza inputs pela legenda e preenche */
(function(){
  const norm = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const visible = (el) => {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const labelText = (el) => {
    let out = '';
    if (el.id) {
      const l = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
      if (l) out += ' ' + (l.innerText || l.textContent || '');
    }
    const wrap = el.closest('label');
    if (wrap) out += ' ' + (wrap.innerText || wrap.textContent || '');
    const al = el.getAttribute('aria-label');
    if (al) out += ' ' + al;
    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const id of lb.split(/\s+/)) { const n = document.getElementById(id); if (n) out += ' ' + (n.innerText || n.textContent || ''); }
    return norm(out);
  };
  const containerText = (el) => {
    const container = el.closest('.form-group,.form-field,.field,li,tr,td,p,div');
    return container ? norm((container.innerText || container.textContent || '').slice(0, 300)) : '';
  };
  const setValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const rows = ${JSON.stringify(rows)};
  const inputs = Array.from(document.querySelectorAll('input,textarea')).filter((el) => {
    if (!visible(el) || el.disabled || el.readOnly) return false;
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return !['hidden', 'submit', 'button', 'image', 'file', 'checkbox', 'radio'].includes(t);
  });
  const meta = inputs.map((el) => ({
    type: (el.getAttribute('type') || 'text').toLowerCase(),
    autocomplete: norm(el.getAttribute('autocomplete') || ''),
    name: norm(el.name || ''),
    id: norm(el.id || ''),
    placeholder: norm(el.placeholder || ''),
    aria: norm(el.getAttribute('aria-label') || ''),
    label: labelText(el),
    container: containerText(el),
  }));
  const score = (field, m) => {
    if (field.kind !== 'password' && m.type === 'password') return -1000;
    let s = 0;
    if (field.kind === 'password') {
      if (m.type === 'password') s += 80;
      if (m.autocomplete.includes('current password') || m.autocomplete.includes('new password')) s += 30;
    } else if (field.kind === 'username') {
      if (m.autocomplete.includes('username')) s += 40;
      else if (m.autocomplete.includes('current password')) s -= 100;
      if (m.type === 'email') s += 10;
    }
    const leg = norm(field.name);
    if (leg) {
      const exact = (v, base) => {
        if (!v) return;
        if (v === leg) s += base;
        else if (v.includes(leg) || (leg.length >= 4 && leg.includes(v) && v.length >= 3)) s += Math.floor(base * 0.6);
      };
      exact(m.label, 70);
      exact(m.placeholder, 50);
      exact(m.aria, 55);
      exact(m.name, 45);
      exact(m.id, 40);
      if (m.container.includes(leg)) s += 15;
    }
    return s;
  };
  const MIN = 30;
  const pairs = [];
  rows.forEach((field, fi) => {
    meta.forEach((m, mi) => {
      const sc = score(field, m);
      if (sc >= MIN) pairs.push({ fi, mi, sc });
    });
  });
  pairs.sort((a, b) => b.sc - a.sc || a.mi - b.mi);
  const assignedRow = new Map();
  const usedInput = new Set();
  for (const p of pairs) {
    if (assignedRow.has(p.fi) || usedInput.has(p.mi)) continue;
    assignedRow.set(p.fi, p.mi);
    usedInput.add(p.mi);
  }
  const filled = [];
  const already = [];
  const missing = [];
  rows.forEach((field, fi) => {
    const mi = assignedRow.get(fi);
    if (mi === undefined) { missing.push(field.name); return; }
    const el = inputs[mi];
    if ((el.value || '').trim().length > 0) { already.push(field.name); return; }
    try { setValue(el, field.value); filled.push(field.name); } catch { missing.push(field.name); }
  });
  const coreReady = rows.every((field, fi) => field.kind === 'text' || assignedRow.has(fi));
  return {
    ok: missing.length === 0,
    missing,
    filled,
    already,
    coreReady,
    detail: filled.length ? 'preenchido: ' + filled.join('+') : (already.length ? 'campos ja preenchidos' : 'nada a preencher'),
  };
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

const CTA_CANDIDATES = [
  'fazer login',
  'acessar',
  'acessar o sistema',
  'entrar com gov.br',
  'entrar',
  'login',
]

// Seletores tentados em ordem para o clique final de "Entrar".
const SUBMIT_SELECTORS = [
  '#botao-entrar',
  'button[type="submit"]',
  'input[type="submit"]',
  'input[type="image"]',
  'text=Entrar',
]

/** Tenta clicar o primeiro seletor que existir como um humano. */
async function clickFirstHuman(
  target: HumanInputTarget,
  selectors: string[],
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: boolean; detail: string }> {
  for (const selector of selectors) {
    const clicked = await humanClickElement(target, [selector], { sleep })
    if (clicked.ok) return clicked
  }
  return { ok: false, detail: 'nenhum seletor de clique funcionou' }
}

export async function runAgenticLogin(options: AgentOptions): Promise<AgentResult> {
  const { values, target } = options
  const maxIterations = options.maxIterations ?? 24
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const autoSubmit = options.autoSubmit !== false
  const startUrl = target.getURL()
  // Sequencia de observacoes sem nada a fazer (ex.: pagina pos-login carregou
  // enquanto o agente esperava o formulario). Apos algumas, o loop encerra e
  // delega a confirmacao ao watcher de pos-login — em vez de queimar todas as
  // iteracoes em paginas sem formulario.
  let noWorkStreak = 0
  // Orçamento de parede (120 s) — impede laço eterno em portal patológico.
  const startedAt = Date.now()

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

    if (Date.now() - startedAt >= AGENT_WALL_BUDGET_MS) {
      return {
        status: 'manual',
        message: 'O acesso demorou mais que o esperado. Pausamos para você concluir.',
        twoFactorDetected: false,
        captchaDetected: false,
        iterations: index,
        lastUrl: target.getURL(),
      }
    }
    options.onProgress?.(index, maxIterations)

    // Probe MÍNIMA antes do OBSERVE (a partir da 2ª iteração). Nunca bloqueia:
    // se a página não estiver pronta, dorme 400 ms e re-proba uma vez; ainda
    // assim segue — o loop desiste sozinho nas iterações/no orçamento de
    // parede. Usa timeout curto (2 s por amostra) e 1 amostra por vez.
    if (index > 0) {
      const first = await probeReadiness(target, { timeoutMs: 2_000 })
      if (!minimalProbeReady(first)) {
        await sleep(400)
        await probeReadiness(target, { timeoutMs: 2_000 })
      }
    }

    const obs = await safeExecute<{
      href: string
      userPresent: boolean
      passPresent: boolean
      userFilled: boolean
      passFilled: boolean
      inputs?: number
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
    // Duas portas para o mesmo desfecho: com campos declarados na credencial,
    // o robô localiza cada um pela LEGENDA (route determinística); sem eles,
    // cai na heurística legada (usuário = primeiro campo texto, senha =
    // password). Em nenhum dos dois casos "chuta": o que não localiza vira
    // pausa humana com a legenda no recado.
    const formPresent = obs.userPresent || obs.passPresent || (obs.inputs ?? 0) > 0
    if (formPresent) {
      const rows = buildFieldRows(values)
      if (rows.length > 0) {
        const filled = await safeExecute<{
          ok: boolean
          missing: string[]
          filled: string[]
          already: string[]
          coreReady: boolean
          detail: string
        }>(target, FIELD_FILL_SCRIPT(rows), 8_000)
        if (!filled) {
          // A página não respondeu — espera e reavalia (mesmo padrão do fill legado).
          await sleep(500)
          continue
        }
        if (filled.ok) {
          if (filled.filled.length > 0) {
            // Preencheu algo agora — reavalia na próxima iteração (o envio
            // acontece quando não há mais nada a preencher).
            noWorkStreak = 0
            await sleep(350)
            continue
          }
          // Todos os campos declarados já estão no lugar.
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
        // Faltou localizar ao menos um campo declarado.
        if (filled.filled.length > 0) {
          noWorkStreak = 0
          await sleep(350)
          continue
        }
        // Fluxo em duas etapas (ex.: CPF primeiro): usuário já preenchido e a
        // senha ainda não apareceu — avança a etapa em vez de falhar.
        if (obs.userFilled && !obs.passPresent) {
          noWorkStreak = 0
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
        // Página estável e o campo não aparece: pausa com a legenda exata.
        noWorkStreak += 1
        if (noWorkStreak >= 4) {
          return {
            status: 'manual',
            message: `Não localizei na tela: ${filled.missing.join(', ')}. Ajuste a legenda desses campos no cadastro da credencial.`,
            twoFactorDetected: false,
            captchaDetected: false,
            iterations: index + 1,
            lastUrl: obs.href,
          }
        }
        await sleep(600)
        continue
      }
      noWorkStreak = 0
      if (!obs.userFilled || !obs.passFilled) {
        const humanTarget = target as HumanInputTarget
        if (typeof humanTarget?.sendInputEvent === 'function') {
          const filled = await humanFillLoginPair(humanTarget, values, { sleep })
          if (filled.ok) {
            await sleep(350)
            continue
          }
          // Heurística não achou candidatos — tenta pelo caminho legado.
          await safeExecute(target, FILL_SCRIPT(values.username, values.password), 6_000)
          await sleep(350)
          continue
        }
        await safeExecute(target, FILL_SCRIPT(values.username, values.password), 6_000)
        await sleep(350)
        continue
      }
      // Ambos preenchidos: envia (se permitido) ou espera o clique do usuário.
      if (autoSubmit) {
        const humanTarget = target as HumanInputTarget
        if (typeof humanTarget?.sendInputEvent === 'function') {
          const clicked = await clickFirstHuman(humanTarget, SUBMIT_SELECTORS, sleep)
          if (clicked.ok) {
            await sleep(1_500)
            continue
          }
        }
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
    const cta = CTA_CANDIDATES.find((candidate) =>
      obs.buttons.some((label) => label === candidate || label.includes(candidate)),
    )
    if (cta) {
      noWorkStreak = 0
      const humanTarget = target as HumanInputTarget
      if (typeof humanTarget?.sendInputEvent === 'function') {
        const clicked = await clickFirstHuman(
          humanTarget,
          [
            'input[type="image"]',
            'button[type="submit"]',
            'input[type="submit"]',
            `text=${cta}`,
          ],
          sleep,
        )
        if (clicked.ok) {
          await sleep(800)
          continue
        }
      }
      await safeExecute(target, CLICK_CTA_SCRIPT(cta), 6_000)
      await sleep(800)
      continue
    }

    // 3) Há botão de avanço (CPF preenchido em duas etapas)?
    if (obs.userFilled && !obs.passPresent) {
      noWorkStreak = 0
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

    // 4) Nada a fazer ainda (página navegando/renderizando). Se a página pós-
    // login já carregou (form sumiu sem vestígios de login pendente), encerra
    // e deixa o watcher de pós-login confirmar a autenticação.
    noWorkStreak += 1
    if (noWorkStreak >= 4) {
      return {
        status: 'awaiting_login',
        message:
          'O portal não confirmou o login no tempo esperado. Use a tela aberta para concluir.',
        twoFactorDetected: false,
        captchaDetected: false,
        iterations: index + 1,
        lastUrl: obs.href,
      }
    }
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
  fields?: AgentFieldSpec[]
  extraValues?: Record<string, string>
}): AgentValues {
  return {
    username: input.username ?? '',
    password: input.password ?? '',
    document: input.document ?? '',
    clientName: input.clientName ?? '',
    ...(input.fields ? { fields: input.fields } : {}),
    ...(input.extraValues ? { extraValues: input.extraValues } : {}),
  }
}
