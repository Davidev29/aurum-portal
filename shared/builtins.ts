import type { RecipeDefinition, PostLogin, RecipeStep } from './recipe'
import type { AuthMethod, ServiceCategory } from './constants'

export interface BuiltinServiceSeed {
  id: string
  slug: string
  name: string
  category: ServiceCategory
  baseUrl: string
  allowedDomains: string[]
  authMethods: AuthMethod[]
  defaultAuth: AuthMethod
  notes: string
  /**
   * Logomarca empacotada em `public/portals/` (servida pelo app).
   * Usada como fallback quando o serviço nativo ainda não tem `logoPath`
   * customizado (data: URL) no banco. Não vai para o banco.
   */
  logoAsset?: string | null
  recipe: RecipeDefinition
}

/**
 * Pré-login para portais gov.br genéricos (hub www.gov.br, esocial, etc.).
 * Usa marcadores de área logada do gov.br como evidência de sessão; URL não
 * é usada como critério (a página de acesso já tem paths legitimamente
 * públicos, como /empresas-e-negocios/login_cidadao).
 *
 * Exportado para reuso por serviços personalizados (ver shared/custom-service.ts).
 */
export const postLoginGovBrHub: PostLogin = {
  selectors: [
    'text=Sair',
    'text=Sair do gov.br',
    'text=Sair da conta',
    'a[href*="logout"]',
    'a[href*="signout"]',
    'button[aria-label*="Sair" i]',
    'button[aria-label*="Logout" i]',
    '[aria-label*="Sair" i]',
    'text=Meus Serviços',
    'text=Meus serviços',
    'text=Minha conta',
    'text=Minha página',
    '[data-testid="logout"]',
  ],
  timeoutMs: 60_000,
  urlExcludes: ['login', 'autenticacao', 'auth/realms'],
}

/**
 * Primitivos de login assistido por usuário/senha para portais externos
 * (não gov.br): smart entry (clique em "Fazer login") + smart fill
 * (preenchimento inteligente do formulário). Ficam aqui em builtins.ts —
 * o módulo base — para que tanto os serviços personalizados (custom-service)
 * quanto os portais nativos de senha (ex.: Prefeituras SpeedGov) usem o
 * mesmo fluxo sem dependência circular.
 */
export const GENERIC_CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '[class*="captcha"]',
  '#hcaptcha',
]

export const GENERIC_TWO_FACTOR_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'text=Verificação em duas etapas',
  'text=Verificacao em duas etapas',
  'text=Código de acesso',
  'text=Codigo de acesso',
]

/** Pós-login genérico: marcadores de área autenticada (nunca `body`, que
 * casaria também na tela de login). */
export const postLoginGeneric: PostLogin = {
  selectors: [
    'text=Sair',
    'text=Sair da conta',
    'text=Minha conta',
    'a[href*="logout"]',
    'a[href*="signout"]',
    'button[aria-label*="Sair" i]',
    '[data-testid="logout"]',
  ],
  timeoutMs: 45_000,
  urlExcludes: ['login', 'signin', 'autentic'],
}

/**
 * "Smart entry": porta de entrada comum de portais (página pública com botão
 * "Fazer login", "Acessar", "Entrar com gov.br"…). Se o formulário de login
 * já está visível, não faz nada (o preenchimento vem no passo seguinte); caso
 * contrário, clica no melhor botão de entrada visível. Nunca clica em botões
 * "em nuvem", links de ajuda, ou "primeiro acesso"/"esqueci a senha". Avaliação
 * assistida, sem segredos — usa só a estrutura da página.
 */
export const SMART_ENTRY_SCRIPT = String.raw`
try {
  const visible = (el) => { try { return __pvVisible(el); } catch { return false; } };
  const hasLoginForm =
    Array.from(document.querySelectorAll('input[type="password"]')).some(visible) ||
    Array.from(document.querySelectorAll('input#username, input[name="username"], input#cpf, input[autocomplete="username"], input[name="cpf"]')).some(visible);
  if (hasLoginForm) return { ok: true, selector: null, detail: 'smart-entry: formulario ja visivel' };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clickable = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="image"]')).filter(visible);
  const rank = (t) => {
    if (!t) return -1;
    if (/fazer login|realizar login|acessar o sistema|acessar sistema/.test(t)) return 110;
    if (/entrar com gov|acessar com gov|acesso gov\.?br|entrar com gov\.?br/.test(t)) return 105;
    if (/^(entrar|acessar|login)$/.test(t)) return 90;
    if (/entrar|acessar|login/.test(t) && t.length <= 32) return 40;
    return -1;
  };
  let best = null, bestScore = -1;
  for (const el of clickable) {
    const score = rank(textOf(el));
    if (score > bestScore) { bestScore = score; best = el; }
  }
  if (best && bestScore >= 40) {
    const label = textOf(best).slice(0, 60);
    try { best.scrollIntoView({ block: 'center' }); } catch {}
    try { best.click(); } catch {}
    return { ok: true, selector: null, detail: 'smart-entry: clicado "' + label + '"' };
  }
  return { ok: true, selector: null, detail: 'smart-entry: nada a clicar' };
} catch (error) {
  return { ok: true, selector: null, detail: 'smart-entry: ignorado (' + String((error && error.message) || error).slice(0, 160) + ')' };
}
`

/** Seletor de "campos de login" usado para espera opcional antes do preenchimento. */
export const LOGIN_FIELDS_SELECTORS = [
  'input#username',
  'input[name="username"]',
  'input#password',
  'input[type="password"]',
  'input[autocomplete="username"]',
  'input#cpf',
  'input[name="cpf"]',
] as const

export const LOGIN_PASSWORD_SELECTORS = ['input[type="password"]'] as const

export const SMART_ENTRY_STEP: RecipeStep = {
  action: 'evaluate',
  script: SMART_ENTRY_SCRIPT,
  timeoutMs: 8_000,
}
export const waitForLoginFieldsStep = (): RecipeStep => ({
  action: 'waitFor',
  selectors: [...LOGIN_FIELDS_SELECTORS],
  timeoutMs: 15_000,
  optional: true,
})
export const waitForPasswordStepOptional = (): RecipeStep => ({
  action: 'waitFor',
  selectors: [...LOGIN_PASSWORD_SELECTORS],
  timeoutMs: 12_000,
  optional: true,
})

/**
 * "Smart fill": inspeciona a página em tempo de execução, localiza o campo de
 * usuário (CPF/CNPJ/e-mail/nome de usuário, o que vier antes do campo de
 * senha) e preenche usuário e senha. Melhor esforço e sempre "ok": se a
 * página mudar, o usuário conclui o login manualmente — a automação é
 * assistida, nunca destrutiva. Os placeholders são substituídos pelo processo
 * principal por literais JSON no momento da execução (ver buildActionScript).
 */
export const SMART_FILL_SCRIPT = String.raw`
const PV_USER = {{credential.username}};
const PV_PASS = {{credential.password}};
try {
  const visible = (el) => { try { return __pvVisible(el); } catch { return false; } };
  const isTextLike = (el) => {
    const type = String(el.getAttribute('type') || 'text').toLowerCase();
    if (/^(password|hidden|checkbox|radio|submit|button|file|image|reset)$/.test(type)) return false;
    const hint = [el.name, el.id, el.getAttribute('autocomplete'), el.getAttribute('placeholder'), el.getAttribute('aria-label')]
      .filter(Boolean).join(' ').toLowerCase();
    if (/(user|login|cpf|cnpj|email|e-mail|conta|usuario|matricula|inscricao|documento|identi|acesso)/.test(hint)) return true;
    return type === 'text' || type === 'email' || type === 'tel' || type === 'number' || type === '';
  };
  const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
  const passwordIndex = inputs.findIndex((el) => String(el.getAttribute('type') || '').toLowerCase() === 'password');
  const password = passwordIndex >= 0 ? inputs[passwordIndex] : null;
  const textLike = inputs.filter(isTextLike);
  let user = null;
  if (password) {
    user = textLike.find((el) => inputs.indexOf(el) < passwordIndex) || null;
  }
  if (!user) user = textLike[0] || null;
  const filled = [];
  if (user && PV_USER) { try { __pvSetValue(user, PV_USER); filled.push('usuario'); } catch {} }
  if (password && PV_PASS) { try { __pvSetValue(password, PV_PASS); filled.push('senha'); } catch {} }
  return { ok: true, selector: null, detail: filled.length ? 'smart-fill: ' + filled.join('+') : 'smart-fill: nada a preencher' };
} catch (error) {
  return { ok: true, selector: null, detail: 'smart-fill: ignorado (' + String((error && error.message) || error).slice(0, 160) + ')' };
}
`

export const smartFillStep = (timeoutMs = 12_000): RecipeStep => ({
  action: 'evaluate',
  script: SMART_FILL_SCRIPT,
  timeoutMs,
})

/** Pareceria com o ISS Fortaleza: portal público → "Fazer login" → página de
 * login (Keycloak/SSO) → CPF e senha → Entrar. O fluxo abaixo cobre os dois
 * arquétipos e também portais gov.br que redirecionam para a SSO. */
export const unifiedPasswordSteps = (): RecipeStep[] => [
  SMART_ENTRY_STEP,
  waitForLoginFieldsStep(),
  smartFillStep(),
  waitForPasswordStepOptional(),
  smartFillStep(8_000),
]

/**
 * Clique conservador para portais gov.br que exigem um clique inicial de
 * "entrar" (landings públicas). Só clica em elemento visível cujo rótulo é
 * claramente um botão de entrada; nunca clica em texto que apenas menciona
 * "certificado" (links de ajuda, "Seu certificado digital em nuvem" etc.).
 *
 * Se já estiveros na tela do SSO gov.br (botão #login-certificate presente),
 * clica nele diretamente — esse é exatamente o passo que queremos.
 */
const GOVBR_HUB_ENTER_SCRIPT = String.raw`
  const href = (location.href || '');
  if (/sso\.acesso\.gov\.br\/authorize/i.test(href)) return 'govbr-hub: already-on-sso';
  const body = (document.body && document.body.innerText) || '';
  if (/Minha conta|Meus Serviços|Meus Servicos|Minha página|Sair da conta/i.test(body)) return 'ja-autenticado';
  // 1) SSO direto no HTML: alguns portais gov.br (ex.: eSocial) embutem um
  //    <button onclick="location.href='https://sso.acesso.gov.br/authorize?...'">
  //    A URL crua traz &amp; (entidade HTML); decodificar antes de navegar.
  const decodeEntities = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const html = (document.documentElement ? document.documentElement.innerHTML : '') || '';
  const inlineMatch = html.match(/location\.href='([^']+)'/i);
  const ssoUrl = inlineMatch ? decodeEntities(inlineMatch[1]) : null;
  const fallbackMatch = html.match(/https?:\/\/sso\.acesso\.gov\.br\/authorize\?[^"'\s<>]*/i);
  const rawUrl = ssoUrl || (fallbackMatch ? decodeEntities(fallbackMatch[0]) : null);
  if (rawUrl) { try { location.href = rawUrl; return 'govbr-hub: navigate-sso'; } catch {} }
  // 2) Já estamos no SSO gov.br? Clique direto no botão de certificado.
  const certOption = document.getElementById('login-certificate');
  if (certOption) { try { certOption.click(); return 'govbr-hub: sso-cert-option'; } catch {} }
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('alt') || el.getAttribute('aria-label') || el.value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const clickable = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="image"]')).filter(visible);
  const rank = (t) => {
    if (!t) return -1;
    if (/acessar com gov.?br|entrar com gov.?br|entrar pelo gov.?br|acesso gov.?br/.test(t)) return 100;
    if (/(^| )acessar($| )|\\bentrar\\b/.test(t) && t.length <= 28) return 10;
    return -1;
  };
  let best = null;
  let bestScore = -1;
  for (const el of clickable) {
    const score = rank(textOf(el));
    if (score > bestScore) { bestScore = score; best = el; }
  }
  if (best && bestScore > 0) {
    try { best.click(); return 'govbr-hub: ' + textOf(best).slice(0, 60); } catch {}
  }
  // Diagnóstico: o que a página está mostrando (até 300 chars)
  const sample = body.replace(/\\s+/g, ' ').slice(0, 160);
  return 'govbr-hub: nenhuma opcao. cand=' + clickable.slice(0,6).map(textOf).join('|') + ' body="' + sample + '"';`

function certRecipe(service: string): RecipeDefinition {
  return certRecipeWithInterstitial(service)
}

/**
 * Passo T1 (interstitial do e-CAC): clica no botão "Acesso Gov BR" real —
 * um `<input type="image">` dentro de `#login-certificado-digital > form#frmLoginCert`,
 * protegido por hCaptcha invisível. O clique dispara `validarHcaptcha('govBr')`,
 * que submete o formulário. Se o botão não for encontrado, o passo falha e a
 * receita vai para modo manual (sinal de que o portal mudou).
 *
 * Se a sessão já estiver autenticada (cookies do partition), a interstitial
 * redireciona diretamente para a área logada — nesse caso o script retorna
 * 'ja-autenticado' sem clicar em nada.
 */
/**
 * Passo T1 do JUCEC: clica no botão broker "Acessar com gov.br" do Keycloak
 * (Portal_Servicos). O link contém tab_id/session_code efêmeros, por isso
 * clicamos no elemento existente na página em vez de montar a URL.
 */
const JUCEC_BROKER_CLICK_SCRIPT = String.raw`
  const body = (document.body && document.body.innerText) || '';
  if (/pagina inicial|você está em portal de serviços|sair/i.test(body) && !/acessar portal/i.test(body)) return 'ja-autenticado';
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const textOf = (el) => (el.innerText || el.textContent || el.getAttribute('alt') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const byId = document.getElementById('loginprovider-brasilcidadao');
  if (byId && visible(byId)) { try { byId.click(); return 'jucec-broker: Acessar com gov.br'; } catch {} }
  const candidates = Array.from(document.querySelectorAll('a, button, [role="button"]')).filter(visible);
  const broker = candidates.find((el) => { const t = textOf(el); return t.includes('acessar com') && t.includes('gov'); });
  if (broker) { try { broker.click(); return 'jucec-broker: Acessar com gov.br'; } catch {} }
  throw new Error('botao Acessar com gov.br nao encontrado na pagina do JUCEC. visivel="' + body.replace(/\\s+/g, ' ').slice(0, 260) + '"');`;

const ECAC_T1_CLICK_SCRIPT = String.raw`
  const body = (document.body && document.body.innerText) || '';
  if (/Alterar perfil de acesso|Meus [Ss]ervi[cç]os|Certid[õo]es/i.test(body)) return 'ja-autenticado';
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const textOf = (el) => (el.getAttribute('alt') || el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const rank = (t) => {
    if (!t) return 0;
    if (/acesso gov\\s*br|entrar com gov\\.?br|entrar pelo gov\\.?br/.test(t)) return 3;
    if (/gov\\.?br/.test(t)) return 2;
    return 0;
  };
  const candidates = Array.from(document.querySelectorAll('input[type="image"], a, button, [role="button"], input[type="submit"]'))
    .filter(visible)
    .map((el) => ({ el, score: rank(textOf(el)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  const fail = (msg) => { throw new Error(msg); };
  if (candidates.length > 0) {
    const el = candidates[0].el;
    try { el.click(); return 'ecac-t1-click: ' + textOf(el).slice(0, 80); } catch { fail('falha ao clicar no botao Acesso Gov BR'); }
  }
  const inForm = Array.from(document.querySelectorAll('#login-certificado-digital input[type="image"], form#frmLoginCert input[type="image"]')).filter(visible)[0];
  if (inForm) {
    try { inForm.click(); return 'ecac-t1-click: frmLoginCert input[type=image]'; } catch { fail('falha ao clicar no botao Acesso Gov BR'); }
  }
  fail('botao Acesso Gov BR nao encontrado na interstitial do e-CAC');`;

/**
 * Passo T2 (SSO gov.br): aguarda a SPA Preact renderizar e clica "Seu certificado
 * digital" — nunca "em nuvem". O script é um único evaluate assíncrono que
 * faz polling interno (executeJavaScript aguarda a Promise).
 *
 * Se o SSO já redirecionou para a área logada (cookies) ou para o endpoint
 * mTLS, encerra cedo. Se aparecer 2FA, encerra como 'aguardando-2fa' (a
 * detecção global de interstitials trata isso como ação humana e revela a
 * tela com orientação).
 */
export const GOVBR_SSO_CERT_CLICK_SCRIPT = String.raw`
  const href = () => location.href || '';
  const bodyText = () => (document.body && document.body.innerText) || '';
  const loggedInNow = () => /Alterar perfil de acesso|Meus [Ss]ervi[cç]os|Certid[õo]es/i.test(bodyText());
  const tfaNow = () => /Verifica[çc][ãa]o em duas etapas/i.test(bodyText());
  if (/certificado\\.sso\\.acesso\\.gov\\.br/i.test(href())) return 'mtls-endpoint: certificado.sso.acesso.gov.br';
  if (loggedInNow()) return 'ja-autenticado';
  const deadline = Date.now() + 22_000;
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // Coleta elementos percorrendo inclusive shadow roots abertas.
  const collect = () => {
    const acc = [];
    const walk = (root) => {
      if (!root) return;
      for (const el of Array.from(root.querySelectorAll('*'))) {
        acc.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return acc;
  };
  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Somente elementos NATIVAMENTE CLICAVEIS do SSO (HTML server-rendered):
  // <button id="login-certificate"> e quem dispara o onSubmit correto.
  // Divs que apenas envolvem o botao nao possuem handler nenhum.
  const clickableCollect = () => {
    const acc = [];
    const walk = (root) => {
      if (!root) return;
      for (const el of Array.from(root.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="image"]'))) {
        acc.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return acc;
  };
  const dispatchClick = (el) => {
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    try { el.focus && el.focus(); } catch {}
    // O botao do SSO tem addEventListener('click', onSubmit): o click() nativo
    // garante o handler (onSubmit -> hCaptcha invisivel -> form.submit()).
    try { el.click(); } catch {}
    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    } catch {}
  };
  const findOption = () => {
    // 1) Caminho determinístico: id estável do botão do SSO gov.br.
    const byId = document.getElementById('login-certificate');
    if (byId && visible(byId)) return byId;
    // 2) Fallback: só elementos clicáveis cujo texto seja o certificado.
    const candidates = clickableCollect().filter(visible);
    const withoutCloud = candidates.filter((el) => !textOf(el).includes('em nuvem'));
    return withoutCloud.find((el) => textOf(el) === 'seu certificado digital')
      || withoutCloud.find((el) => textOf(el).includes('seu certificado digital'))
      || withoutCloud.find((el) => textOf(el).includes('certificado digital'))
      || null;
  };
  const matches = (el, needles) => { const t = textOf(el); return needles.some((n) => t.includes(n)); };
  const findExpander = () => {
    const needles = ['outras opções de identificação', 'outras opcoes de identificacao', 'outras opções', 'outras opcoes'];
    const els = collect().filter(visible);
    return els.find((el) => matches(el, needles)) || null;
  };
  let expanded = false;
  while (Date.now() < deadline) {
    const url = href();
    if (/certificado\\.sso\\.acesso\\.gov\\.br/i.test(url)) return 'mtls-endpoint: certificado.sso.acesso.gov.br';
    if (loggedInNow()) return 'ja-autenticado';
    if (tfaNow()) return 'aguardando-2fa';
    const option = findOption();
    if (option) {
      dispatchClick(option);
      return 'clique: Seu certificado digital';
    }
    if (!expanded) {
      const expander = findExpander();
      if (expander) {
        dispatchClick(expander);
        expanded = true;
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // Diagnóstico final (aparece no statusMessage e na auditoria) — indica o que a página mostra de fato.
  const sample = (bodyText() || '').replace(/\\s+/g, ' ').slice(0, 260);
  throw new Error('opcao "Seu certificado digital" nao encontrada no SSO gov.br. href=' + href().slice(0, 120) + ' visivel="' + sample + '"');`;

/**
 * Receita dedicada do e-CAC ("zero tela de login"):
 *   T1  clique no botão-imagem "Acesso Gov BR" (interstitial, hCaptcha invisível)
 *   T2  expandir "Outras opções de identificação" e clicar "Seu certificado digital"
 *   T3  mTLS disparado pelo servidor em certificado.sso.acesso.gov.br (sem UI)
 *   T5  retorno ao e-CAC autenticado (detecção de pós-login)
 */
function ecacRecipeWithInterstitial(): RecipeDefinition {
  return {
    version: 1,
    service: 'ecac',
    auth: 'certificate',
    steps: [
      {
        action: 'evaluate',
        script: ECAC_T1_CLICK_SCRIPT,
        timeoutMs: 5_000,
      },
      {
        // Espera a interstitial sair (redirect para SSO/certificado.sso ou
        // volta direta para a área logada). Roda no processo main — imune à
        // destruição do documento. Opcional: nunca trava a receita.
        action: 'waitForURL',
        urlIncludes: [
          'cav.receita.fazenda.gov.br',
          'sso.acesso.gov.br',
          'contas.acesso.gov.br',
          'certificado.sso.acesso.gov.br',
        ],
        urlExcludes: ['autenticacao/'],
        timeoutMs: 15_000,
        optional: true,
      },
      {
        action: 'sleep',
        timeoutMs: 300,
      },
      {
        // Único evaluate assíncrono com polling interno: aguarda a SPA do SSO
        // renderizar e clica "Seu certificado digital" (nunca "em nuvem").
        action: 'evaluate',
        script: GOVBR_SSO_CERT_CLICK_SCRIPT,
        timeoutMs: 32_000,
      },
    ],
    postLogin: {
      // Detecção por URL corrente (páginas servidas fora de /autenticacao/
      // exigem sessão — o SSO redireciona para lá só após o mTLS). `body`
      // casa instantaneamente na área logada; os textos ficam como alternativa
      // humana-legível.
      selectors: [
        'body',
        'text=Sair',
        'text=Alterar perfil de acesso',
        'text=Meus Serviços',
        'text=Meus Servicos',
        'text=Certidões',
        'text=Certidoes',
        'a[href*="logout"]',
      ],
      timeoutMs: 120_000,
      urlIncludes: ['cav.receita.fazenda.gov.br'],
      urlExcludes: ['autenticacao/'],
    },
    autoSubmit: false,
    onFailure: 'manual',
    captchaSelectors: ['iframe[src*="hcaptcha"]', 'iframe[src*="recaptcha"]'],
    twoFactorSelectors: [
      'text=Verificação em duas etapas',
      'text=Verificacao em duas etapas',
      'text=Código de acesso',
      'input[autocomplete="one-time-code"]',
    ],
  }
}

function jucecRecipeWithGovBr(): RecipeDefinition {
  const govBrPostLogin = {
    // URL corrente decide: páginas servidas fora de /auth/realms/ exigem
    // sessão JUCEC+gov.br (o Keycloak recarrega com sucesso após o broker).
    selectors: ['body', 'text=Sair', 'text=Logout', 'text=logout', 'a[href*="logout"]', 'a[href*="signout"]'],
    timeoutMs: 120_000,
    urlIncludes: ['portalservicos.jucec.ce.gov.br'],
    urlExcludes: ['/auth/realms/'],
  }
  return {
    version: 1,
    service: 'jucec',
    auth: 'certificate',
    steps: [
      {
        // Clica no botão broker "Acessar com gov.br" (Keycloak Portal_Servicos).
        // O tab_id/session_code efêmero do link não pode ser guardado — o clique
        // no elemento é sempre válido.
        action: 'evaluate',
        script: JUCEC_BROKER_CLICK_SCRIPT,
        timeoutMs: 6_000,
      },
      {
        // Mesma espera determinística da receita do e-CAC: sair da página do
        // Keycloak para a SSO gov.br (ou voltar para a área logada direto).
        action: 'waitForURL',
        urlIncludes: [
          'sso.acesso.gov.br',
          'contas.acesso.gov.br',
          'certificado.sso.acesso.gov.br',
          'login.gov.br',
        ],
        urlExcludes: ['/Portal/', '/auth/realms/'],
        timeoutMs: 15_000,
        optional: true,
      },
      {
        action: 'sleep',
        timeoutMs: 300,
      },
      {
        action: 'evaluate',
        script: GOVBR_SSO_CERT_CLICK_SCRIPT,
        timeoutMs: 32_000,
      },
    ],
    postLogin: govBrPostLogin,
    autoSubmit: false,
    onFailure: 'manual',
    captchaSelectors: ['iframe[src*="hcaptcha"]', 'iframe[src*="recaptcha"]'],
    twoFactorSelectors: [
      'text=Verificação em duas etapas',
      'text=Verificacao em duas etapas',
      'text=Código de acesso',
      'input[autocomplete="one-time-code"]',
    ],
  }
}

/**
 * Receita de certificado "zero tela de login".
 *
 * O fluxo e:
 * 1. evaluate (imediato): injeta JS que clica automaticamente no botao de
 *    certificado/gov.br assim que a pagina carrega. O usuario nao ve a tela.
 * 2. waitFor (opcional, 2s): fallback caso o evaluate nao tenha encontrado.
 * 3. click (opcional, 2s): clica se encontrar o botao.
 * 4. sleep (1s): pausa para o servidor processar e disparar mTLS.
 *
 * Quando o portal ja dispara o mTLS diretamente (sem tela intermediaria),
 * o evaluate nao encontra nada e segue em frente sem regressao.
 */
/**
 * Receita genérica para portais gov.br de autenticação herdada.
 *
 * Fluxo (exatamente o mesmo dos portais já validados):
 *   T1  clique conservador só em botões de entrada óbvios (ou no botão
 *       `#login-certificate` caso o portal já abra direto na SSO);
 *   T2  waitForURL até a navegação chegar na SSO gov.br (ou voltar já
 *       autenticado para a área do portal);
 *   T3  clique determinístico em "Seu certificado digital" na SSO gov.br;
 *   T4  pós-login com marcadores de área logada (nunca pelo path da landing).
 *
 * Importante: nunca clicamos em elementos que apenas contêm "certificado"
 * no texto — essa família de seletores engloba "Seu certificado digital em
 * nuvem" e links de ajuda, que são cliques indevidos.
 */
export function certRecipeWithInterstitial(
  service: string,
  customPostLogin?: PostLogin,
  opts?: { twoFactorSelectors?: string[]; captchaSelectors?: string[] },
): RecipeDefinition {
  return {
    version: 1,
    service,
    auth: 'certificate',
    steps: [
      // Passo 1: opcional — se o portal abre direto na SSO ou já está logado,
      // nada a clicar. Se há um botão claro de entrada, clica. Nunca força.
      {
        action: 'evaluate',
        script: GOVBR_HUB_ENTER_SCRIPT,
        timeoutMs: 6_000,
        optional: true,
      },
      // Passo 2: aguarda que o botão "Entrar com gov.br" fique visível no DOM
      // (mesmo Angular maduro pode renderizar depois do did-finish-load).
      {
        action: 'waitFor',
        selectors: [
          'text=Entrar com gov.br',
          'text=Entrar com GOV.BR',
          'text=Entrar com',
          'button:has-text("gov.br")',
        ],
        timeoutMs: 25_000,
        optional: true,
      },
      // Passo 3: clica no botão de entrada (alternativamente à vez do passo 1).
      {
        action: 'click',
        selectors: [
          'text=Entrar com gov.br',
          'text=Entrar com GOV.BR',
          'text=Entrar com',
          'button:has-text("gov.br")',
        ],
        timeoutMs: 3_000,
        optional: true,
      },
      // Passo 2: aguarda a página chegar na SSO gov.br (ou voltar autenticado.
      {
        action: 'waitForURL',
        urlIncludes: [
          'sso.acesso.gov.br',
          'contas.acesso.gov.br',
          'certificado.sso.acesso.gov.br',
          'login.gov.br',
        ],
        timeoutMs: 15_000,
        optional: true,
      },
      // Passo 3: pausa curta para o commit do documento da SSO.
      {
        action: 'sleep',
        timeoutMs: 300,
      },
      // Passo 4: clique determinístico em "Seu certificado digital" (nunca
      // em "em nuvem"). Mesmo script já validado no e-CAC/JUCEC.
      {
        action: 'evaluate',
        script: GOVBR_SSO_CERT_CLICK_SCRIPT,
        timeoutMs: 32_000,
      },
    ],
    postLogin: customPostLogin ?? postLoginGovBrHub,
    autoSubmit: false,
    onFailure: 'manual',
    captchaSelectors: opts?.captchaSelectors ?? [
      '[class*="captcha"]',
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      '#hcaptcha',
    ],
    twoFactorSelectors: opts?.twoFactorSelectors,
  }
}

function speedGovSeed(
  slugSuffix: string,
  name: string,
  baseUrl: string,
  notes: string,
  extraAllowedDomains: string[] = [],
): BuiltinServiceSeed {
  const slug = `speedgov-${slugSuffix}`
  return {
    id: `builtin-${slug}`,
    slug,
    name,
    category: 'Prefeituras',
    baseUrl,
    allowedDomains: [
      new URL(baseUrl).hostname,
      'speedgov.com.br',
      '*.speedgov.com.br',
      ...extraAllowedDomains,
    ],
    authMethods: ['password'],
    defaultAuth: 'password',
    notes,
    recipe: passwordRecipe(slug),
  }
}

/**
 * Receita de senha para portais nativos externos (não gov.br): smart entry +
 * smart fill, igual à gerada para serviços personalizados. `autoSubmit:
 * true` ("Entrar sozinho"): o portal abre oculto com a animação de boot
 * exibida e o app clica em Entrar sozinho — mesmo padrão dos serviços
 * personalizados de senha. Captcha/2FA pausam a automação e revelam o
 * portal para a mão humana (requiresHumanAction). Usada pelos ISS/NFS-e
 * municipais SpeedGov.
 */
function passwordRecipe(service: string): RecipeDefinition {
  return {
    version: 1,
    service,
    auth: 'password',
    steps: unifiedPasswordSteps(),
    postLogin: postLoginGeneric,
    autoSubmit: true,
    onFailure: 'manual',
    captchaSelectors: [...GENERIC_CAPTCHA_SELECTORS],
    twoFactorSelectors: [...GENERIC_TWO_FACTOR_SELECTORS],
  }
}

export const BUILTIN_SERVICES: BuiltinServiceSeed[] = [
  {
    id: 'builtin-govbr',
    slug: 'govbr',
    name: 'gov.br',
    category: 'Governo Federal',
    baseUrl: 'https://sso.acesso.gov.br/login',
    allowedDomains: ['sso.acesso.gov.br', 'acesso.gov.br', 'gov.br', '*.gov.br'],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/gov-br.png',
    notes:
      'Hub de identidade do Governo Federal. A sessao gov.br e compartilhada entre servicos do mesmo cliente na particao correspondente.',
    recipe: certRecipeWithInterstitial('govbr', undefined, {
      twoFactorSelectors: [
        'input[autocomplete="one-time-code"]',
        'text=autenticacao em dois fatores',
      ],
    }),
  },
  {
    id: 'builtin-redesim',
    slug: 'redesim',
    name: 'Redesim',
    category: 'Governo Federal',
    baseUrl: 'https://www.gov.br/empresas-e-negocios/login_cidadao',
    allowedDomains: ['www.gov.br', 'gov.br', '*.gov.br', 'sso.acesso.gov.br', 'acesso.gov.br'],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    notes:
      'Portal Redesim do empreendedor. Ao abrir e redirecionar para a SSO gov.br, a autenticacao acontece com certificado digital.',
    recipe: certRecipe('redesim'),
  },
  {
    id: 'builtin-ecac',
    slug: 'ecac',
    name: 'e-CAC',
    category: 'Governo Federal',
    baseUrl: 'https://cav.receita.fazenda.gov.br/',
    allowedDomains: [
      'cav.receita.fazenda.gov.br',
      'receita.fazenda.gov.br',
      'gov.br',
      '*.gov.br',
      'acesso.gov.br',
      'sso.acesso.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/ecac.png',
    notes:
      'Portal da Receita Federal. Entrar pela URL base e deixar o portal gerar o fluxo de autenticacao.',
    recipe: ecacRecipeWithInterstitial(),
  },
  {
    id: 'builtin-jucec',
    slug: 'jucec-ce',
    name: 'JUcec-CE',
    category: 'Governo Estadual',
    baseUrl: 'https://portalservicos.jucec.ce.gov.br/',
    allowedDomains: [
      'portalservicos.jucec.ce.gov.br',
      'jucec.ce.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'login.gov.br',
      'contas.acesso.gov.br',
      'certificado.sso.acesso.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    notes:
      'Portal de servicos da Junta Comercial do Ceara. Acesso via gov.br: certificado digital (e-CNPJ/e-CPF) ou conta gov.br. Em modo senha, o operador clica o botao "Acessar com gov.br" automaticamente e conclui com sua senha no gov.br.',
    recipe: jucecRecipeWithGovBr(),
  },
  {
    id: 'builtin-pendencias-cnpj',
    slug: 'pendencias-cnpj',
    name: 'Pendências CNPJ',
    category: 'Governo Federal',
    baseUrl: 'https://servicos.receitafederal.gov.br/servico/pendencias/#/analise-pendencias',
    allowedDomains: [
      'servicos.receitafederal.gov.br',
      'receitafederal.gov.br',
      'receita.fazenda.gov.br',
      '*.receitafederal.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'gov.br',
      '*.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/gov-br.png',
    notes:
      'Pendências de CNPJ atualizadas (Receita Federal). Redireciona para login.gov.br; certificado digital ou conta gov.br.',
    recipe: certRecipe('pendencias-cnpj'),
  },
  {
    id: 'builtin-fgts-digital',
    slug: 'fgts-digital',
    name: 'FGTS Digital',
    category: 'Governo Federal',
    baseUrl: 'https://fgtsdigital.sistema.gov.br/portal/servicos',
    allowedDomains: [
      'fgtsdigital.sistema.gov.br',
      'sistema.gov.br',
      '*.sistema.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'gov.br',
      '*.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/gov-br.png',
    notes:
      'FGTS Digital do empregador. Acesso com certificado digital (e-CPF/e-CNPJ).',
    recipe: certRecipe('fgts-digital'),
  },
  {
    id: 'builtin-esocial',
    slug: 'esocial',
    name: 'eSocial',
    category: 'Governo Federal',
    baseUrl: 'https://www.esocial.gov.br/portal/',
    allowedDomains: [
      'www.esocial.gov.br',
      'esocial.gov.br',
      'login.esocial.gov.br',
      '*.esocial.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'gov.br',
      '*.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/esocial.jpg',
    notes:
      'eSocial Web. Redireciona para login.esocial.gov.br / sso.acesso.gov.br (gov.br com selo Certificado Digital).',
    recipe: certRecipe('esocial'),
  },
  {
    id: 'builtin-det-trabalhista',
    slug: 'det-trabalhista',
    name: 'DTE Trabalhista',
    category: 'Governo Federal',
    baseUrl: 'https://det.sit.trabalho.gov.br/',
    allowedDomains: [
      'det.sit.trabalho.gov.br',
      'sit.trabalho.gov.br',
      '*.sit.trabalho.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'gov.br',
      '*.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/det-trabalhista.webp',
    notes:
      'Domicílio Eletrônico Trabalhista (DET). Redireciona para /login.aspx.',
    recipe: certRecipe('det-trabalhista'),
  },
  {
    id: 'builtin-siga-sefaz-ce',
    slug: 'siga-sefaz-ce',
    name: 'SIGA SEFAZ-CE',
    category: 'Governo Estadual',
    baseUrl: 'https://siga.sefaz.ce.gov.br/ui/',
    allowedDomains: [
      'siga.sefaz.ce.gov.br',
      'sefaz.ce.gov.br',
      '*.sefaz.ce.gov.br',
      'sso.sefaz.ce.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/sefaz-ce.png',
    notes:
      'SIGA SEFAZ-CE (Sistema de Interface Guiada à Autorregularização). A URL original do SSO (sso.sefaz.ce.gov.br) contém session_code efêmero; abre pela UI do SIGA e o SSO gera sessão nova.',
    recipe: certRecipe('siga-sefaz-ce'),
  },
  {
    id: 'builtin-simples-nacional',
    slug: 'simples-nacional',
    name: 'Simples Nacional',
    category: 'Governo Federal',
    baseUrl: 'https://www8.receita.fazenda.gov.br/SimplesNacional/Servicos/Grupo.aspx?grp=t&area=1',
    allowedDomains: [
      'www8.receita.fazenda.gov.br',
      'receita.fazenda.gov.br',
      'receitafederal.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'gov.br',
      '*.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/simples-nacional.webp',
    notes:
      'Portal do Simples Nacional. Acesso via certificado/e-CAC ou Código de Acesso + senha.',
    recipe: certRecipe('simples-nacional'),
  },
  {
    id: 'builtin-registrato',
    slug: 'registrato',
    name: 'Registrato',
    category: 'Governo Federal',
    baseUrl: 'https://meubc.bcb.gov.br/meubc/',
    allowedDomains: [
      'meubc.bcb.gov.br',
      'bcb.gov.br',
      '*.bcb.gov.br',
      'sso.acesso.gov.br',
      'acesso.gov.br',
      'gov.br',
      '*.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/bacen.png',
    notes: 'Registrato do Banco Central (Meu BC). Acesso com certificado digital ICP-Brasil ou gov.br.',
    recipe: certRecipe('registrato'),
  },
  {
    id: 'builtin-dte-sefaz-ce',
    slug: 'dte-sefaz-ce',
    name: 'DTE SEFAZ-CE',
    category: 'Governo Estadual',
    baseUrl: 'https://portal-dte.sefaz.ce.gov.br/#/certificado',
    allowedDomains: [
      'portal-dte.sefaz.ce.gov.br',
      'sefaz.ce.gov.br',
      '*.sefaz.ce.gov.br',
      'sso.sefaz.ce.gov.br',
    ],
    authMethods: ['certificate', 'password'],
    defaultAuth: 'certificate',
    logoAsset: '/portals/sefaz-ce.png',
    notes:
      'Domicílio Tributário Eletrônico (DTE) da SEFAZ-CE. Rota SPA #/certificado (acesso com certificado digital).',
    recipe: certRecipe('dte-sefaz-ce'),
  },
  speedGovSeed(
    'tiangua',
    'Tianguá — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/tiangua/login',
    'ISS/NFS-e de Tianguá (SpeedGov). Acesso com login e senha do município. Também acessível por servicos2.speedgov.com.br.',
  ),
  speedGovSeed(
    'juazeiro-do-norte',
    'Juazeiro do Norte — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/juazeirodonorte/login',
    'ISS/NFS-e de Juazeiro do Norte (SpeedGov). Acesso com login e senha do município.',
  ),
  speedGovSeed(
    'taua',
    'Tauá — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/taua/login',
    'ISS/NFS-e de Tauá (SpeedGov). Acesso com login e senha do município.',
  ),
  speedGovSeed(
    'itarema',
    'Itarema — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/itarema/login',
    'ISS/NFS-e de Itarema (SpeedGov). Acesso com login e senha do município. Segunda porta de entrada: https://servicos2.speedgov.com.br/itarema (mesmo backend SpeedGov).',
  ),
  speedGovSeed(
    'pindoretama',
    'Pindoretama — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/pindoretama/login',
    'ISS/NFS-e de Pindoretama (SpeedGov). Acesso com login e senha do município.',
  ),
  speedGovSeed(
    'limoeiro-do-norte',
    'Limoeiro do Norte — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/limoeirodonorte',
    'ISS/NFS-e de Limoeiro do Norte (SpeedGov). Acesso com login e senha do município.',
  ),
  speedGovSeed(
    'sobral',
    'Sobral — SpeedGov (NFS-e)',
    'https://iss.speedgov.com.br/sobral/login',
    'Emissão de NFS-e de Sobral (SpeedGov). Acesso com login e senha do município. Atenção: o portal principal de NFS-e do município também é nfse.sobral.ce.gov.br.',
    ['nfse.sobral.ce.gov.br', 'sobral.ce.gov.br', '*.sobral.ce.gov.br'],
  ),
  speedGovSeed(
    'crateus',
    'Crateús — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/crateus/login',
    'ISS/NFS-e de Crateús (SpeedGov). Acesso com login e senha do município.',
  ),
  speedGovSeed(
    'icapui',
    'Icapuí — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/icapui/login',
    'ISS/NFS-e de Icapuí (SpeedGov). Acesso com login e senha do município.',
  ),
  speedGovSeed(
    'paracuru',
    'Paracuru — SpeedGov (ISS/NFS-e)',
    'https://iss.speedgov.com.br/paracuru/login',
    'ISS/NFS-e de Paracuru (SpeedGov). Acesso com login e senha do município.',
  ),
]
