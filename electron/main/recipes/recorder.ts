/**
 * Gravação Assistida (Fase 1) — recorder da página + compilador de eventos.
 *
 * Dois lados:
 *
 * 1) SCRIPTS INJETADOS (`buildRecorderScript`/`buildDrainScript`/
 *    `buildTeardownScript`) — rodados na própria página via
 *    `webContents.executeJavaScript` (mesmo canal do runner; a view remota
 *    NUNCA ganha IPC). Listeners em fase de captura no `document`; o portal
 *    não percebe diferença (passivo, nunca preventDefault). Valores digitados
 *    vão para um side-buffer `secrets[]` — os eventos só carregam um índice
 *    (`valueRef`).
 *
 * 2) COMPILADOR (`compileRecording`) — função pura (Vault injetado) que
 *    transforma os eventos drenados em `RecipeDefinition` com placeholders
 *    (`{{credential.*}}` / `{{client.document}}`). Nenhum valor literal de
 *    campo de credencial sobrevive — nem em segredo, nem em log (§8).
 *
 * Shadow DOM: fora do MVP (Fase 4, condicional E3) — `event.composedPath()`
 * atravessa raízes abertas na captura, mas o replay de elementos internos a
 * shadow root exige o prefixo `pierce:` (Fase 4).
 */
import {
  recipeDefinitionSchema,
  type PostLogin,
  type RecipeDefinition,
  type RecipeStep,
} from '../../../shared/recipe'
import {
  GENERIC_CAPTCHA_SELECTORS,
  GENERIC_TWO_FACTOR_SELECTORS,
  postLoginGeneric,
} from '../../../shared/builtins'
import { stripVolatileQueryParams } from '../../../shared/custom-service'
import type { WizardWarning, WizardWarningCode } from '../../../shared/types'
export type { WizardWarning, WizardWarningCode }

// ---------------------------------------------------------------------------
// Tipos compartilhados com o main
// ---------------------------------------------------------------------------

export interface RecorderCandidate {
  sel: string
  confidence: 'high' | 'medium' | 'low'
  matchCount: number
}

export interface RecordedFieldMeta {
  type: string
  name: string
  id: string
  autocomplete: string
  ariaLabel: string
  placeholder: string
  labelText: string
}

export type RecordedEvent =
  | {
      t: 'click'
      at: number
      seq: number
      label: string
      tag: string
      screen: string
      candidates: RecorderCandidate[]
    }
  | {
      t: 'fill'
      at: number
      seq: number
      valueRef: number
      field: RecordedFieldMeta
      screen: string
      commit?: string
    }
  | {
      t: 'press'
      at: number
      seq: number
      key: string
      label: string
      screen: string
      candidates: RecorderCandidate[]
    }
  | { t: 'submit'; at: number; seq: number; screen: string }

export interface RecordedDrain {
  ok: boolean
  reason?: string
  events: RecordedEvent[]
  secrets: Array<string | null>
  url: string
  title: string
  readyState: string
  screen: string
}

const MAX_STEPS = 60
const FUSION_WINDOW_MS = 5_000

// ---------------------------------------------------------------------------
// 1) Scripts injetados
// ---------------------------------------------------------------------------

/** Script de captura (idempotente: re-arme preserva buffer e atualiza tela). */
export function buildRecorderScript(arm: { token: string; screen: string }): string {
  const token = JSON.stringify(arm.token)
  const screen = JSON.stringify(arm.screen)
  return `(function () {
  var TOKEN = ${token}, SCREEN = ${screen};
  var state = window.__aurumbitRec;
  if (state && state.token === TOKEN) { state.screen = SCREEN; return { ok: true, rearmed: true }; }
  state = { token: TOKEN, screen: SCREEN, seq: 0, events: [], secrets: [], pending: null,
            fieldIds: new WeakMap(), fieldValues: new WeakMap(), disposables: [], lastClick: { sig: '', at: 0 } };
  window.__aurumbitRec = state;

  function visible(el) {
    try { var s = window.getComputedStyle(el); if (!s || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (e) { return false; }
  }
  function tagOf(el) { return String(el.tagName || '').toLowerCase(); }
  function interactive(el) {
    if (!el || !el.tagName) return false;
    var t = tagOf(el);
    if (t === 'a' || t === 'button' || t === 'select' || t === 'textarea' || t === 'summary') return true;
    if (t === 'input') { var i = norm(el.getAttribute('type')).toLowerCase() || 'text'; return i !== 'hidden' && i !== 'file'; }
    var role = norm(el.getAttribute('role')).toLowerCase();
    return ['button','link','tab','menuitem','checkbox','radio','switch','option'].indexOf(role) !== -1;
  }
  function norm(t) { return String(t == null ? '' : t).replace(/\\s+/g, ' ').trim(); }
  function labelOf(el) {
    var t = norm(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || '');
    return t.slice(0, 80);
  }
  function fieldLabel(el) {
    var t = '';
    try {
      var labels = el.labels;
      if (labels && labels.length) t = norm(labels[0].innerText || labels[0].textContent || '');
      if (!t) { var lb = el.getAttribute('aria-labelledby'); if (lb) { var ref = document.getElementById(lb); if (ref) t = norm(ref.innerText || ref.textContent || ''); } }
      if (!t) { var p = el.closest('label'); if (p) t = norm(p.innerText || p.textContent || ''); }
    } catch (e) { }
    return t.slice(0, 80);
  }
  function fieldMeta(el) {
    return {
      type: (norm(el.getAttribute('type')).toLowerCase()) || (tagOf(el) === 'textarea' ? 'textarea' : tagOf(el)),
      name: norm(el.getAttribute('name')).slice(0, 120),
      id: norm(el.id).slice(0, 120),
      autocomplete: norm(el.getAttribute('autocomplete')).toLowerCase().slice(0, 60),
      ariaLabel: norm(el.getAttribute('aria-label')).slice(0, 80),
      placeholder: norm(el.getAttribute('placeholder')).slice(0, 80),
      labelText: fieldLabel(el),
    };
  }
  function escapeCss(s) { return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&'); }
  function visibleCount(sel) {
    try { var list = document.querySelectorAll(sel); var n = 0; for (var i = 0; i < list.length && i < 40; i++) { if (visible(list[i])) n++; } return n; } catch (e) { return -1; }
  }
  var DYNAMIC = /(ember\\d+|:r[0-9]+:|:R[0-9a-z]+:|ng-\\d+|__\\d{6,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\\d{6,})/i;
  function candidates(el) {
    var out = [];
    function push(sel, confidence) {
      if (!sel || sel.length > 500) return;
      for (var i = 0; i < out.length; i++) if (out[i].sel === sel) return;
      var count = visibleCount(sel);
      if (count === -1) return;
      out.push({ sel: sel, confidence: confidence, matchCount: count });
    }
    var id = el.id ? String(el.id) : '';
    if (id && /^[A-Za-z][A-Za-z0-9_:-]{1,63}$/.test(id) && !DYNAMIC.test(id) && visibleCount('#' + escapeCss(id)) === 1) push('#' + escapeCss(id), 'high');
    var name = el.getAttribute && el.getAttribute('name');
    if (name) push('[name="' + String(name).replace(/"/g, '\\\\"') + '"]', 'high');
    var testAttrs = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'data-automation-id'];
    for (var i = 0; i < testAttrs.length; i++) { var v = el.getAttribute(testAttrs[i]); if (v) push('[' + testAttrs[i] + '="' + String(v).replace(/"/g, '\\\\"') + '"]', 'high'); }
    var role = norm(el.getAttribute('role')).toLowerCase(); var aria = norm(el.getAttribute('aria-label'));
    if (role && aria) push('[role="' + role + '"][aria-label="' + aria.replace(/"/g, '\\\\"') + '"]', 'high');
    else if (aria) push('[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]', 'high');
    var ph = norm(el.getAttribute('placeholder'));
    if (ph) push(tagOf(el) + '[placeholder="' + ph.replace(/"/g, '\\\\"') + '"]', 'medium');
    var txt = labelOf(el);
    if (txt) push('text=' + txt, 'medium');
    try {
      var parts = []; var cur = el; var depth = 0;
      while (cur && cur.nodeType === 1 && depth < 8) {
        var tag = tagOf(cur);
        if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
        var seg = tag;
        var parent = cur.parentElement;
        if (parent) {
          var same = 0, idx = 1;
          for (var j = 0; j < parent.children.length; j++) { var child = parent.children[j]; if (child.tagName === cur.tagName) { if (child === cur) idx = same + 1; same++; } }
          if (same > 1) seg += ':nth-of-type(' + idx + ')';
        }
        parts.unshift(seg);
        cur = cur.parentElement; depth++;
      }
      if (parts.length) push(parts.join(' > '), 'low');
    } catch (e) { }
    return out.slice(0, 6);
  }
  function record(evt) { evt.seq = ++state.seq; state.events.push(evt); }
  function fieldKey(el) { var k = state.fieldIds.get(el); if (!k) { k = state.fieldIds.size + 1; state.fieldIds.set(el, k); } return k; }
  function secretFor(el) { var v = state.fieldValues.get(el); if (v == null) return -1; return state.secrets.push(String(v)) - 1; }
  function commitFill(el, kind) {
    if (state.pending && state.pending.timer) clearTimeout(state.pending.timer);
    state.pending = null;
    record({ t: 'fill', at: Date.now(), valueRef: secretFor(el), field: fieldMeta(el), commit: kind, screen: state.screen });
  }
  function schedulePending(el) {
    var key = fieldKey(el);
    if (state.pending && state.pending.timer) clearTimeout(state.pending.timer);
    var timer = setTimeout(function () { if (state.pending && state.pending.key === key) commitFill(el, 'debounce'); }, 400);
    state.pending = { key: key, el: el, timer: timer };
  }
  function commitPending() { if (state.pending && state.pending.el) { if (state.pending.timer) clearTimeout(state.pending.timer); commitFill(state.pending.el, 'drain'); } }

  function onClick(e) {
    var path = (typeof e.composedPath === 'function') ? e.composedPath() : [e.target];
    var el = path && path[0];
    if (!el || !el.tagName || !interactive(el)) return;
    var label = labelOf(el);
    var cands = candidates(el);
    var sig = (cands.length ? cands[0].sel : '') + '|' + tagOf(el) + '|' + label;
    var now = Date.now();
    if (state.lastClick.sig === sig && now - state.lastClick.at < 800) return;
    state.lastClick = { sig: sig, at: now };
    record({ t: 'click', at: now, label: label, tag: tagOf(el), candidates: cands, screen: state.screen });
  }
  function onInput(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var t = tagOf(el);
    if (t !== 'input' && t !== 'textarea') return;
    state.fieldValues.set(el, String(el.value == null ? '' : el.value));
    schedulePending(el);
  }
  function onChange(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var t = tagOf(el);
    if (t === 'select') { state.fieldValues.set(el, String(el.value == null ? '' : el.value)); commitFill(el, 'change'); return; }
    if (t === 'input') {
      var type = norm(el.getAttribute('type')).toLowerCase();
      if (type === 'checkbox' || type === 'radio') return;
      state.fieldValues.set(el, String(el.value == null ? '' : el.value));
      commitFill(el, 'change');
    }
  }
  function onKeydown(e) {
    if (e.key !== 'Enter') return;
    commitPending();
    var el = e.target;
    var inField = el && el.tagName && (tagOf(el) === 'input' || tagOf(el) === 'textarea' || (el.closest && el.closest('form')));
    if (!inField) return;
    record({ t: 'press', at: Date.now(), key: 'Enter', label: el ? labelOf(el) : '', candidates: el ? candidates(el) : [], screen: state.screen });
  }
  function onFocusout(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    if (state.pending && state.pending.el === el) commitFill(el, 'blur');
  }
  function onSubmit() { record({ t: 'submit', at: Date.now(), screen: state.screen }); }
  function onPagehide() { commitPending(); }

  var pairs = [['click', onClick], ['input', onInput], ['change', onChange], ['keydown', onKeydown], ['focusout', onFocusout], ['submit', onSubmit]];
  for (var i = 0; i < pairs.length; i++) {
    document.addEventListener(pairs[i][0], pairs[i][1], true);
    state.disposables.push([pairs[i][0], pairs[i][1]]);
  }
  window.addEventListener('pagehide', onPagehide, true);
  state.disposables.push(['pagehide', onPagehide]);
  state.__flush = commitPending;
  return { ok: true, armed: true };
})()`
}

/** Drenagem: devolve eventos + segredos e limpa os buffers da página. */
export function buildDrainScript(token: string): string {
  const safeToken = JSON.stringify(token)
  return `(function () {
  var s = window.__aurumbitRec;
  if (!s || s.token !== ${safeToken}) return { ok: false, reason: 'not-armed' };
  try { if (typeof s.__flush === 'function') s.__flush(); } catch (e) { }
  var events = s.events.splice(0, s.events.length);
  var secrets = s.secrets.splice(0, s.secrets.length);
  return { ok: true, events: events, secrets: secrets, url: String(location.href), title: String(document.title || ''), readyState: String(document.readyState), screen: s.screen };
})()`
}

/** Remove listeners e o buffer — best-effort (a página pode já ter morrido). */
export function buildTeardownScript(token: string): string {
  const safeToken = JSON.stringify(token)
  return `(function () {
  var s = window.__aurumbitRec;
  if (!s) return { ok: true, disposed: false };
  if (s.token !== ${safeToken}) return { ok: false, reason: 'token-mismatch' };
  try { (s.disposables || []).forEach(function (pair) { try { document.removeEventListener(pair[0], pair[1], true); } catch (e) { try { window.removeEventListener(pair[0], pair[1], true); } catch (e2) { } } }); } catch (e) { }
  try { delete window.__aurumbitRec; } catch (e) { window.__aurumbitRec = undefined; }
  return { ok: true, disposed: true };
})()`
}

// ---------------------------------------------------------------------------
// 2) Compilador: eventos drenados -> RecipeDefinition (puro; Vault injetado)
// ---------------------------------------------------------------------------

export interface CompileCredential {
  id: string
  passwordFingerprint: string
  username: string
}

export interface CompileVault {
  fingerprintPassword(value: string): string
  /** Compara hex de HMAC. Default: igualdade simples (HMAC é determinístico). */
  constantTimeEqualHex?(left: string, right: string): boolean
}

export interface CompileContext {
  service: string
  auth: 'certificate' | 'password'
  /** Entrar sozinho — vem do toggle da revisão (ou default da receita anterior). */
  autoSubmit: boolean
  clientDocument?: string | null
  clientName?: string | null
  /**
   * Credencial-alvo da gravação (quando o usuário vinculou). AUSENTE/null ⇒
   * fingerprint NÃO é avaliado; fills de senha viram {{credential.password}} +
   * warning `no-credential-bound` (C2/N2). Nunca usar "a primeira do cliente".
   */
  fingerprintTargetId?: string | null
  credentials: CompileCredential[]
  /** Navegações observadas pelo main durante a gravação (para expectedAfter). */
  navigations: Array<{ at: number; toUrl: string }>
  /** Receita corrente (automática recém-gerada ou de antes em re-record). */
  previousRecipe?: RecipeDefinition | null
  vault?: CompileVault
  now?: () => number
}

export interface CompiledRecording {
  definition: RecipeDefinition
  warnings: WizardWarning[]
}

function normalizeDocument(value: string): string {
  return String(value).replace(/\D+/g, '')
}

function normalizeUsername(value: string): string {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase()
}

function hostPathOf(rawUrl: string): string | null {
  try {
    const stripped = stripVolatileQueryParams(rawUrl).url
    const parsed = new URL(stripped)
    if (parsed.protocol !== 'https:') return null
    const path = parsed.pathname || '/'
    return `${parsed.host}${path}`
  } catch {
    return null
  }
}

function rankConfidence(confidence: 'high' | 'medium' | 'low'): number {
  return confidence === 'high' ? 2 : confidence === 'medium' ? 1 : 0
}

function demote(confidence: 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
  if (confidence === 'high') return 'medium'
  if (confidence === 'medium') return 'low'
  return 'low'
}

/**
 * Ordena candidatos: matchCount === 1 vence; depois confiança. matchCount > 1
 * rebaixa a confiança (múltiplos matches visíveis = frágil).
 */
function normalizeCandidates(candidates: RecorderCandidate[]): {
  selectors: string[]
  confidence: 'high' | 'medium' | 'low'
} {
  const viable = (candidates ?? [])
    .filter((candidate) => candidate.sel && candidate.sel.length <= 500 && candidate.matchCount >= 1)
    .map((candidate) => ({
      ...candidate,
      confidence: candidate.matchCount > 1 ? demote(candidate.confidence) : candidate.confidence,
    }))
    .sort((left, right) => {
      const uniqueLeft = left.matchCount === 1 ? 1 : 0
      const uniqueRight = right.matchCount === 1 ? 1 : 0
      if (uniqueLeft !== uniqueRight) return uniqueRight - uniqueLeft
      return rankConfidence(right.confidence) - rankConfidence(left.confidence)
    })
  const selectors = viable.slice(0, 6).map((candidate) => candidate.sel)
  const best = viable[0]?.confidence ?? 'low'
  return { selectors, confidence: best }
}

export function compileRecording(
  events: RecordedEvent[],
  secrets: Array<string | null>,
  ctx: CompileContext,
): CompiledRecording {
  const warnings: WizardWarning[] = []
  const warn = (warning: WizardWarning): void => {
    if (warnings.some((item) => item.code === warning.code && item.detail === warning.detail)) return
    warnings.push(warning)
  }
  const now = ctx.now ?? Date.now
  const vault = ctx.vault
  const targetCredential = ctx.fingerprintTargetId
    ? (ctx.credentials.find((credential) => credential.id === ctx.fingerprintTargetId) ?? null)
    : null

  const navigations = [...(ctx.navigations ?? [])].sort((left, right) => left.at - right.at)

  interface StepDraft {
    step: RecipeStep
    at: number
  }
  const drafts: StepDraft[] = []

  const usedNavigationIndexes = new Set<number>()
  const fuseTarget = new Map<number, number[]>()

  // Casa navegações pós-clique/press com o passo que as disparou.
  for (let navigationIndex = 0; navigationIndex < navigations.length; navigationIndex += 1) {
    const nav = navigations[navigationIndex]
    if (!nav) continue
    let best = -1
    let bestDelta = Number.POSITIVE_INFINITY
    for (const [eventIndex, event] of events.entries()) {
      if (event.at > nav.at) continue
      if (event.t !== 'click' && event.t !== 'press') continue
      const delta = nav.at - event.at
      if (delta >= 0 && delta <= FUSION_WINDOW_MS && delta < bestDelta) {
        best = eventIndex
        bestDelta = delta
      }
    }
    if (best >= 0) {
      usedNavigationIndexes.add(navigationIndex)
      const list = fuseTarget.get(best) ?? []
      list.push(navigationIndex)
      fuseTarget.set(best, list)
    }
  }

  const lastDraft = (): StepDraft | undefined => drafts[drafts.length - 1]

  const attachExpectedAfter = (eventIndex: number): void => {
    const navigationIndexes = fuseTarget.get(eventIndex)
    if (!navigationIndexes) return
    const last = lastDraft()
    if (!last) return
    for (const navigationIndex of navigationIndexes) {
      const nav = navigations[navigationIndex]
      if (!nav) continue
      const hostPath = hostPathOf(nav.toUrl)
      if (hostPath) {
        last.step.expectedAfter = { urlIncludes: [hostPath], timeoutMs: 10_000 }
      }
    }
  }

  for (const [index, event] of events.entries()) {
    if (event.t === 'submit') continue

    if (event.t === 'click') {
      const { selectors, confidence } = normalizeCandidates(event.candidates)
      if (selectors.length === 0) {
        warn({
          code: 'low-confidence',
          detail: `Etapa descartada: nenhum seletor utilizável para "${event.label.slice(0, 60)}".`,
        })
        continue
      }
      drafts.push({
        step: {
          action: 'click',
          selectors,
          label: event.label || undefined,
          source: 'recorded',
          screen: event.screen,
          confidence,
        },
        at: event.at,
      })
      if (confidence === 'low') {
        warn({
          code: 'low-confidence',
          detail: `Etapa "${event.label.slice(0, 60)}" usa seletor frágil — prefira regravar se o portal é dinâmico.`,
        })
      }
      attachExpectedAfter(index)
      continue
    }

    if (event.t === 'press') {
      const { selectors, confidence } = normalizeCandidates(event.candidates)
      drafts.push({
        step: {
          action: 'press',
          key: event.key,
          selectors: selectors.length > 0 ? selectors : undefined,
          label: event.label || undefined,
          source: 'recorded',
          screen: event.screen,
          confidence,
        },
        at: event.at,
      })
      attachExpectedAfter(index)
      continue
    }

    // ----------------------------------------------------------------- fill
    const meta = event.field
    const rawSecret = event.valueRef >= 0 ? (secrets[event.valueRef] ?? null) : null
    const value = rawSecret == null ? '' : rawSecret
    const haystack = [
      meta.type,
      meta.name,
      meta.id,
      meta.autocomplete,
      meta.ariaLabel,
      meta.placeholder,
      meta.labelText,
    ]
      .join(' ')
      .toLowerCase()

    // c) one-time-code / OTP — nunca gravado
    const looksOtp =
      meta.autocomplete === 'one-time-code' ||
      /otp|one.?time|c[oó]digo|2fa|token|verifica/i.test(haystack)
    if (looksOtp) {
      warn({
        code: 'otp-not-recorded',
        detail: `Código de uma vez em "${(meta.name || meta.id || 'campo').slice(0, 60)}" — não gravado; no replay este passo é opcional.`,
      })
      drafts.push({
        step: {
          action: 'fill',
          selectors: fillSelectors(meta),
          value: '',
          label: meta.labelText || meta.name || 'Código',
          source: 'recorded',
          screen: event.screen,
          confidence: 'medium',
          optional: true,
        },
        at: event.at,
      })
      continue
    }

    // a) campo de senha
    const looksPassword =
      meta.type === 'password' ||
      meta.autocomplete === 'current-password' ||
      meta.autocomplete === 'new-password' ||
      /pass|senha|pwd/i.test(haystack)
    if (looksPassword) {
      if (!targetCredential) {
        warn({
          code: 'no-credential-bound',
          detail:
            'Nenhuma credencial vinculada — usuário e senha viraram referências; vincule uma credencial em Editar → Credenciais.',
        })
      } else if (vault && value) {
        const fingerprint = vault.fingerprintPassword(value)
        const equal = vault.constantTimeEqualHex
          ? vault.constantTimeEqualHex(fingerprint, targetCredential.passwordFingerprint)
          : fingerprint === targetCredential.passwordFingerprint
        if (!equal) {
          warn({
            code: 'credential-mismatch',
            detail:
              'A senha digitada não confere com a credencial salva — a etapa usará a credencial vinculada ao acesso.',
          })
        }
      }
      drafts.push({
        step: {
          action: 'fill',
          selectors: fillSelectors(meta),
          value: '{{credential.password}}',
          label: meta.labelText || meta.name || 'Senha',
          source: 'recorded',
          screen: event.screen,
          confidence: 'high',
        },
        at: event.at,
      })
      continue
    }

    // b) campo de usuário — hint do nome/autocomplete (type solto não basta)
    const hasUserHint =
      /user|login|cpf|cnpj|e-?mail|matr|insc|conta|document|ident/i.test(haystack)
    const looksUsername = meta.autocomplete === 'username' || hasUserHint
    if (looksUsername) {
      let resolved = '{{credential.username}}'
      const typedDocument = normalizeDocument(value)
      const clientDocument = normalizeDocument(ctx.clientDocument ?? '')
      if (clientDocument && typedDocument && clientDocument === typedDocument) {
        resolved = '{{client.document}}'
      } else if (targetCredential) {
        if (normalizeUsername(value) === normalizeUsername(targetCredential.username)) {
          resolved = '{{credential.username}}'
        }
      }
      drafts.push({
        step: {
          action: 'fill',
          selectors: fillSelectors(meta),
          value: resolved,
          label: meta.labelText || meta.name || 'Usuário',
          source: 'recorded',
          screen: event.screen,
          confidence: 'high',
        },
        at: event.at,
      })
      continue
    }

    // d) campo desconhecido — valor descartado (§14-B)
    warn({
      code: 'value-not-recorded',
      detail: `O campo "${(meta.labelText || meta.name || 'sem nome').slice(0, 60)}" não foi gravado (não é um dado que guardamos). Preencha-o manualmente ao entrar.`,
    })
    drafts.push({
      step: {
        action: 'fill',
        selectors: fillSelectors(meta),
        value: '',
        label: meta.labelText || meta.name || 'Campo',
        source: 'recorded',
        screen: event.screen,
        confidence: 'medium',
        optional: true,
      },
      at: event.at,
    })
  }

  // Navegações "soltas" (não fundidas) viram waitForURL na linha do tempo.
  const standaloneNavs = navigations.filter((_, index) => !usedNavigationIndexes.has(index))
  const timeline = [
    ...drafts,
    ...standaloneNavs.map((nav) => {
      const hostPath = hostPathOf(nav.toUrl)
      const step: RecipeStep = {
        action: 'waitForURL',
        urlIncludes: hostPath ? [hostPath] : [],
        timeoutMs: 15_000,
        label: 'Aguardar navegação do portal',
        source: 'recorded',
        screen: screenAt(drafts, nav.at),
        confidence: 'high',
      }
      return { step, at: nav.at }
    }),
  ].sort((left, right) => left.at - right.at)

  // Dedupe consecutivo (mesmo action + mesmo primeiro seletor âncora).
  const deduped: RecipeStep[] = []
  for (const { step } of timeline) {
    const previous = deduped[deduped.length - 1]
    if (
      previous &&
      previous.action === step.action &&
      (previous.selectors?.[0] ?? '') === (step.selectors?.[0] ?? '') &&
      previous.key === step.key &&
      previous.value === step.value
    ) {
      continue
    }
    deduped.push(step)
  }

  // Limite de 60 etapas (C5): corta e sinaliza — o excedente sai na revisão (N3).
  let steps = deduped
  if (steps.length > MAX_STEPS) {
    warn({
      code: 'step-cap-reached',
      detail: `A gravação excedeu ${MAX_STEPS} etapas — estas são etapas parciais: remova as que não pertencem ao fluxo antes de testar.`,
    })
    steps = steps.slice(0, MAX_STEPS)
  }

  const screenNumbers = new Set<number>()
  for (const event of events) {
    const match = /^T(\d{1,2})$/.exec(event.screen ?? '')
    if (match) screenNumbers.add(Number(match[1]))
  }
  const recordedScreens = screenNumbers.size > 0 ? Math.max(...screenNumbers) : 0

  // C1: reutiliza postLogin/captcha/2fa da receita anterior; substitui só steps/origin/recordedAt/recordedScreens.
  const previous: PostLogin | null = ctx.previousRecipe?.postLogin ?? null
  const postLogin: PostLogin = previous
    ? { ...previous, selectors: [...previous.selectors] }
    : { ...postLoginGeneric, selectors: [...postLoginGeneric.selectors] }
  const captchaSelectors = ctx.previousRecipe?.captchaSelectors
    ? [...ctx.previousRecipe.captchaSelectors]
    : [...GENERIC_CAPTCHA_SELECTORS]
  const twoFactorSelectors = ctx.previousRecipe?.twoFactorSelectors
    ? [...ctx.previousRecipe.twoFactorSelectors]
    : [...GENERIC_TWO_FACTOR_SELECTORS]

  const definition = recipeDefinitionSchema.parse({
    version: 1,
    service: ctx.service,
    auth: ctx.auth,
    steps,
    postLogin,
    autoSubmit: ctx.autoSubmit,
    onFailure: 'manual',
    captchaSelectors,
    twoFactorSelectors,
    origin: 'recorded',
    recordedAt: new Date(now()).toISOString(),
    recordedScreens,
  })

  return { definition, warnings }
}

function fillSelectors(meta: RecordedFieldMeta): string[] {
  const out: string[] = []
  const push = (sel: string): void => {
    if (sel.length <= 500 && !out.includes(sel)) out.push(sel)
  }
  const escAttr = (value: string): string => value.replace(/"/g, '\\"')
  if (/^[A-Za-z][A-Za-z0-9_:-]{1,63}$/.test(meta.id) && !/\d{6,}/.test(meta.id)) push(`#${meta.id}`)
  if (meta.name) push(`[name="${escAttr(meta.name)}"]`)
  if (meta.autocomplete) push(`input[autocomplete="${escAttr(meta.autocomplete)}"]`)
  if (meta.type) push(`input[type="${escAttr(meta.type)}"]`)
  if (out.length === 0) push(meta.type === 'password' ? 'input[type="password"]' : 'input')
  return out.slice(0, 6)
}

function screenAt(drafts: Array<{ step: RecipeStep; at: number }>, at: number): string {
  let screen = 'T1'
  for (const draft of drafts) {
    if (draft.at <= at && draft.step.screen) screen = draft.step.screen
  }
  return screen
}
