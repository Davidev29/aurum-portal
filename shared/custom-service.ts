/**
 * Cadastro simplificado de serviços + automação de login gerada por baixo dos panos.
 *
 * Usuários não técnicos informam apenas nome, endereço e "como você entra".
 * Este módulo deriva o restante: slug, categoria, allowlist de domínios,
 * métodos aceitos e a receita de preenchimento — tudo a partir de templates
 * validados (o mesmo fluxo gov.br usado pelos serviços nativos) ou de um
 * preenchimento inteligente ("smart fill") que inspeciona o formulário da
 * própria página e preenche usuário e senha. A detecção acontece em tempo de
 * execução, então funciona com portais diferentes sem configurar seletores.
 */
import type { AuthMethod, ServiceCategory } from './constants'
import { isGovernmentHost, normalizeHostname, parseHttpUrl } from './network'
import type { RecipeDefinition, RecipeStep } from './recipe'
import {
  certRecipeWithInterstitial,
  postLoginGovBrHub,
  GOVBR_SSO_CERT_CLICK_SCRIPT,
  GENERIC_CAPTCHA_SELECTORS,
  GENERIC_TWO_FACTOR_SELECTORS,
  postLoginGeneric,
  SMART_ENTRY_SCRIPT,
  SMART_ENTRY_STEP,
  LOGIN_FIELDS_SELECTORS,
  LOGIN_PASSWORD_SELECTORS,
  SMART_FILL_SCRIPT,
  unifiedPasswordSteps,
  waitForLoginFieldsStep,
  waitForPasswordStepOptional,
  smartFillStep,
} from './builtins'

// Reexportados para manter a API pública deste módulo (testes e consumidores
// históricos). A implementação vive em builtins.ts — o módulo base.
export {
  GENERIC_CAPTCHA_SELECTORS,
  GENERIC_TWO_FACTOR_SELECTORS,
  postLoginGeneric,
  SMART_ENTRY_SCRIPT,
  SMART_ENTRY_STEP,
  LOGIN_FIELDS_SELECTORS,
  LOGIN_PASSWORD_SELECTORS,
  SMART_FILL_SCRIPT,
  waitForLoginFieldsStep,
  waitForPasswordStepOptional,
  unifiedPasswordSteps,
}

export type LoginFlow = 'certificate' | 'password' | 'both'

export const LOGIN_FLOW_AUTH_METHODS: Record<LoginFlow, AuthMethod[]> = {
  certificate: ['certificate'],
  password: ['password'],
  both: ['certificate', 'password'],
}

/**
 * Domínios de identidade gov.br adicionados automaticamente à allowlist de
 * sites do governo. Sem eles, o login único (SSO) ou o mTLS poderiam ser
 * bloqueados pela navegação assistida em sites menos comuns. Hoje a
 * navegação/mTLS já aceita qualquer host `.gov.br` automaticamente; a lista
 * existe para explicitar a confiança e cobrir popups e redirecionamentos.
 */
export const GOVERNMENT_SSO_DOMAINS = [
  'sso.acesso.gov.br',
  'acesso.gov.br',
  'contas.acesso.gov.br',
  'certificado.sso.acesso.gov.br',
  'login.gov.br',
  'gov.br',
  '*.gov.br',
] as const

/** Slug a partir do nome: sem acentos, minúsculas, `-` como separador. */
export function slugifyServiceName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/**
 * Domínio "pai" provável de um host (para liberar o portal e seus subdomínios,
 * inclusive onde o SSO é servido). Considera o TLD `.br` como parte do sufixo
 * público (`.com.br`, `.gov.br`, `.org.br`…), senão usa 2 labels.
 */
export function parentDomainsOf(host: string): string[] {
  const labels = normalizeHostname(host).split('.').filter(Boolean)
  const take = labels[labels.length - 1] === 'br' ? 3 : 2
  if (labels.length <= take) return []
  const parent = labels.slice(-take).join('.')
  return [parent, `*.${parent}`]
}

/** Allowlist derivada do endereço: o próprio host, o domínio pai e — para
 * sites do governo — os domínios de identidade gov.br. */
export function deriveAllowedDomains(baseUrl: string): string[] {
  const parsed = parseHttpUrl(baseUrl)
  if (!parsed) return []
  const host = normalizeHostname(parsed.hostname)
  const domains = new Set<string>([host, ...parentDomainsOf(host)])
  if (isGovernmentHost(host)) {
    for (const domain of GOVERNMENT_SSO_DOMAINS) domains.add(domain)
  }
  return Array.from(domains)
}

/** Categoria derivada do endereço (não exibida na UX básica; editável em Avançado). */
export function deriveServiceCategory(baseUrl: string): ServiceCategory {
  const parsed = parseHttpUrl(baseUrl)
  return parsed && isGovernmentHost(parsed.hostname) ? 'Governo Federal' : 'Outros'
}

export interface ServiceDefaultsInput {
  name: string
  baseUrl: string
  loginFlow: LoginFlow
}

export interface ServiceDefaults {
  slug: string
  category: ServiceCategory
  allowedDomains: string[]
  authMethods: AuthMethod[]
  defaultAuth: AuthMethod
}

/** Deriva tudo que o formulário básico não pergunta. O slug pode ser
 * deduplicado no processo principal (ver ensureUniqueSlug). */
export function deriveServiceDefaults(input: ServiceDefaultsInput): ServiceDefaults {
  const authMethods = [...LOGIN_FLOW_AUTH_METHODS[input.loginFlow]]
  return {
    slug: slugifyServiceName(input.name) || 'servico',
    category: deriveServiceCategory(input.baseUrl),
    allowedDomains: deriveAllowedDomains(input.baseUrl),
    authMethods,
    defaultAuth: input.loginFlow === 'password' ? 'password' : 'certificate',
  }
}

/** Normaliza o endereço digitado por usuários: aceita sem protocolo, exige
 * HTTPS e remove parâmetros de sessão efêmeros (CID/session_code/tab_id/…),
 * que invalidam o acesso em sessões futuras. */
export function normalizeBaseUrlInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const candidate = trimmed.includes('://') ? trimmed : `https://${trimmed}`
  const parsed = parseHttpUrl(candidate)
  if (!parsed || parsed.protocol !== 'https:') return null
  return stripVolatileQueryParams(parsed.toString()).url
}

// ---------------------------------------------------------------------------
// Receita automática
// ---------------------------------------------------------------------------

/**
 * Parâmetros de query efêmeros que não podem ser persistidos na URL base de
 * um serviço: mudam a cada sessão e quebram o acesso nos dias seguintes.
 * (Mesma doutrina dos serviços nativos, que nunca guardam `session_code`.)
 */
export const VOLATILE_QUERY_PARAMS = [
  'cid',
  'session_code',
  'tab_id',
  'client_data',
  'execution',
  'state',
  'authorization_id',
  'jsessionid',
  'sessionid',
  'conversationid',
  'phpsessid',
  'aspsessionid',
] as const

/** Remove parâmetros efêmeros da URL preservando path e demais querys. */
export function stripVolatileQueryParams(raw: string): { url: string; stripped: string[] } {
  try {
    const parsed = new URL(raw)
    const stripped: string[] = []
    for (const key of [...parsed.searchParams.keys()]) {
      if (
        VOLATILE_QUERY_PARAMS.includes(key.toLowerCase() as (typeof VOLATILE_QUERY_PARAMS)[number])
      ) {
        stripped.push(key)
        parsed.searchParams.delete(key)
      }
    }
    return { url: parsed.toString(), stripped }
  } catch {
    return { url: raw, stripped: [] }
  }
}

/** Deve ser chamada pelo diálogo quando a URL digitada carrega parâmetros
 * efêmeros, para mostrar ao usuário o que foi limpo. */
export function volatileQueryParamsIn(raw: string): string[] {
  try {
    const parsed = new URL(raw)
    const found = [...parsed.searchParams.keys()].filter((key) =>
      VOLATILE_QUERY_PARAMS.includes(key.toLowerCase() as (typeof VOLATILE_QUERY_PARAMS)[number]),
    )
    return Array.from(new Set(found))
  } catch {
    return []
  }
}

/** Verdadeiro para passos que carregam segredos (usados na filtragem por método). */
export function stepCarriesCredentials(step: RecipeStep): boolean {
  if (step.action === 'fill') return (step.value ?? '').includes('{{credential.')
  if (step.action === 'evaluate') return (step.script ?? '').includes('{{credential.')
  return false
}

export interface AutoRecipeInput {
  slug: string
  baseUrl: string
  authMethods: AuthMethod[]
}

/**
 * Gera a receita automática para um serviço personalizado.
 *
 * Matriz (certificado = fluxo gov.br já validado nos nativos; senha =
 * smart entry + smart fill assistido — o usuário clica em Entrar, ou o app
 * clica sozinho quando o serviço estiver marcado como "Entrar sozinho"):
 *
 *  gov.br + certificado        → receita gov.br (igual aos nativos)
 *  gov.br + senha              → clique de entrada (Fazer login/gov.br) + smart fill no SSO
 *  gov.br + os dois            → clique de entrada + fluxo gov.br (certificado)
 *                                + smart fill (passos de senha saem da sessão de certificado)
 *  externo + senha/os dois     → clique de entrada + smart fill
 *  externo + certificado       → sem passos; watcher de pós-login (mTLS no load)
 */
export function buildAutoRecipe(input: AutoRecipeInput): RecipeDefinition {
  const { slug, baseUrl, authMethods } = input
  const parsed = parseHttpUrl(baseUrl)
  const gov = parsed ? isGovernmentHost(parsed.hostname) : false
  const wantsCertificate = authMethods.includes('certificate')
  const wantsPassword = authMethods.includes('password')

  const common = {
    version: 1 as const,
    service: slug,
    // Entrar sozinho: o usuário pediu explicitamente que o portal seja
    // entregue logado (igual ao fluxo de certificado). O preenchimento dos
    // campos e o clique em Entrar são feitos pela automação; captcha e 2FA
    // pausam a execução para a mão do usuário.
    autoSubmit: true,
    onFailure: 'manual' as const,
    captchaSelectors: [...GENERIC_CAPTCHA_SELECTORS],
    twoFactorSelectors: [...GENERIC_TWO_FACTOR_SELECTORS],
  }

  if (gov) {
    if (wantsCertificate && !wantsPassword) {
      return certRecipeWithInterstitial(slug, undefined, {
        twoFactorSelectors: [...GENERIC_TWO_FACTOR_SELECTORS],
        captchaSelectors: [...GENERIC_CAPTCHA_SELECTORS],
      })
    }
    if (!wantsCertificate) {
      return {
        ...common,
        auth: 'password',
        steps: unifiedPasswordSteps(),
        postLogin: postLoginGovBrHub,
      }
    }
    return {
      ...common,
      auth: 'certificate',
      steps: [
        SMART_ENTRY_STEP,
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
        { action: 'sleep', timeoutMs: 300 },
        { action: 'evaluate', script: GOVBR_SSO_CERT_CLICK_SCRIPT, timeoutMs: 32_000 },
        smartFillStep(),
        waitForPasswordStepOptional(),
        smartFillStep(8_000),
      ],
      postLogin: postLoginGovBrHub,
    }
  }

  if (wantsPassword) {
    return {
      ...common,
      auth: 'password',
      steps: unifiedPasswordSteps(),
      postLogin: postLoginGeneric,
    }
  }

  return {
    ...common,
    auth: 'certificate',
    autoSubmit: false,
    steps: [],
    postLogin: postLoginGeneric,
  }
}
