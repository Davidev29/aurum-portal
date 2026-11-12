import { describe, expect, it } from 'vitest'
import { buildActionScript, isSensitiveStep, recipeValues } from '../../electron/main/recipes/core'
import {
  buildAutoRecipe,
  deriveAllowedDomains,
  deriveServiceCategory,
  deriveServiceDefaults,
  normalizeBaseUrlInput,
  parentDomainsOf,
  slugifyServiceName,
  stepCarriesCredentials,
  stripVolatileQueryParams,
  volatileQueryParamsIn,
  SMART_ENTRY_SCRIPT,
} from '../../shared/custom-service'
import { recipeDefinitionSchema } from '../../shared/recipe'

const GOVBR_URL = 'https://cav.receita.fazenda.gov.br/'
const EXTERNAL_URL = 'https://portal.empresa.com.br/'

describe('stripVolatileQueryParams / volatileQueryParamsIn', () => {
  it('remove cid e afins preservando o path e outros parâmetros', () => {
    expect(
      stripVolatileQueryParams('https://iss.fortaleza.ce.gov.br/grpfor/login.seam?cid=252675'),
    ).toEqual({ url: 'https://iss.fortaleza.ce.gov.br/grpfor/login.seam', stripped: ['cid'] })
  })
  it('remove session_code/tab_id/authorization_id e mantém o restante', () => {
    expect(
      stripVolatileQueryParams('https://x.gov.br/login?session_code=abc&tab_id=1&mensalidade=2026')
        .url,
    ).toBe('https://x.gov.br/login?mensalidade=2026')
  })
  it('não mexe em query comum', () => {
    expect(stripVolatileQueryParams('https://x.gov.br/p?a=1&b=2').url).toBe(
      'https://x.gov.br/p?a=1&b=2',
    )
  })
  it('volatileQueryParamsIn lista os efêmeros presentes', () => {
    expect(volatileQueryParamsIn('https://x.gov.br/p?cid=1&foo=bar&tab_id=9')).toEqual([
      'cid',
      'tab_id',
    ])
    expect(volatileQueryParamsIn('https://x.gov.br/p?foo=bar')).toEqual([])
  })
  it('normalizeBaseUrlInput já devolve a URL limpa', () => {
    expect(normalizeBaseUrlInput('iss.fortaleza.ce.gov.br/grpfor/login.seam?cid=252675')).toBe(
      'https://iss.fortaleza.ce.gov.br/grpfor/login.seam',
    )
  })
})

describe('slugifyServiceName', () => {
  it('remove acentos, pontuação e normaliza para kebab-case', () => {
    expect(slugifyServiceName('SEFAZ da Minha Empresa')).toBe('sefaz-da-minha-empresa')
    expect(slugifyServiceName('Portal (Nota Fiscal) — 2ª via!')).toBe('portal-nota-fiscal-2-via')
    expect(slugifyServiceName('   ')).toBe('')
  })
})

describe('normalizeBaseUrlInput', () => {
  it('adiciona https:// quando falta o protocolo', () => {
    expect(normalizeBaseUrlInput('portal.sefaz.gov.br')).toBe('https://portal.sefaz.gov.br/')
  })
  it('aceita https explícito', () => {
    expect(normalizeBaseUrlInput('https://portal.empresa.com.br/x')).toBe(
      'https://portal.empresa.com.br/x',
    )
  })
  it('rejeita http, URLs inválidas e vazio', () => {
    expect(normalizeBaseUrlInput('http://portal.empresa.com.br')).toBeNull()
    expect(normalizeBaseUrlInput('https://')).toBeNull()
    expect(normalizeBaseUrlInput('')).toBeNull()
  })
})

describe('parentDomainsOf', () => {
  it('usa 3 labels sob TLD .br (sufixo público)', () => {
    expect(parentDomainsOf('portal.notasfiscais.com.br')).toEqual([
      'notasfiscais.com.br',
      '*.notasfiscais.com.br',
    ])
    expect(parentDomainsOf('cav.receita.fazenda.gov.br')).toEqual([
      'fazenda.gov.br',
      '*.fazenda.gov.br',
    ])
  })
  it('usa 2 labels fora do .br e não deriva de domínio simples', () => {
    expect(parentDomainsOf('app.example.com')).toEqual(['example.com', '*.example.com'])
    expect(parentDomainsOf('example.com')).toEqual([])
  })
})

describe('deriveAllowedDomains', () => {
  it('site do governo: host base + domínio pai + identidade gov.br', () => {
    const domains = deriveAllowedDomains(GOVBR_URL)
    expect(domains).toContain('cav.receita.fazenda.gov.br')
    expect(domains).toContain('fazenda.gov.br')
    expect(domains).toContain('*.fazenda.gov.br')
    expect(domains).toContain('sso.acesso.gov.br')
    expect(domains).toContain('*.gov.br')
  })
  it('site externo: host base + domínio pai, sem domínios do governo', () => {
    const domains = deriveAllowedDomains(EXTERNAL_URL)
    expect(domains).toContain('portal.empresa.com.br')
    expect(domains).toContain('empresa.com.br')
    expect(domains).toContain('*.empresa.com.br')
    expect(domains).not.toContain('sso.acesso.gov.br')
  })
  it('retorna vazio para URL inválida', () => {
    expect(deriveAllowedDomains('não é url')).toEqual([])
  })
})

describe('deriveServiceDefaults', () => {
  it('deriva categoria e métodos para site do governo', () => {
    const defaults = deriveServiceDefaults({
      name: 'e-CAC teste',
      baseUrl: GOVBR_URL,
      loginFlow: 'both',
    })
    expect(defaults.category).toBe('Governo Federal')
    expect(defaults.authMethods).toEqual(['certificate', 'password'])
    expect(defaults.defaultAuth).toBe('certificate')
    expect(defaults.slug).toBe('e-cac-teste')
  })
  it('site externo com senha cai em Outros e método padrão senha', () => {
    const defaults = deriveServiceDefaults({
      name: 'Portal X',
      baseUrl: EXTERNAL_URL,
      loginFlow: 'password',
    })
    expect(defaults.category).toBe('Outros')
    expect(defaults.authMethods).toEqual(['password'])
    expect(defaults.defaultAuth).toBe('password')
  })
})

describe('deriveServiceCategory', () => {
  it('gov.br → Governo Federal; demais → Outros', () => {
    expect(deriveServiceCategory(GOVBR_URL)).toBe('Governo Federal')
    expect(deriveServiceCategory(EXTERNAL_URL)).toBe('Outros')
  })
})

describe('stepCarriesCredentials', () => {
  it('detecta passos que carregam segredos', () => {
    expect(stepCarriesCredentials({ action: 'fill', value: '{{credential.password}}' })).toBe(true)
    expect(
      stepCarriesCredentials({ action: 'evaluate', script: 'x {{credential.username}} y' }),
    ).toBe(true)
    expect(stepCarriesCredentials({ action: 'click', selectors: ['#a'] })).toBe(false)
    expect(stepCarriesCredentials({ action: 'fill', value: 'texto fixo' })).toBe(false)
  })
})

const MATRIX: Array<{
  baseUrl: string
  authMethods: Array<'certificate' | 'password'>
  label: string
}> = [
  { baseUrl: GOVBR_URL, authMethods: ['certificate'], label: 'gov.br + certificado' },
  { baseUrl: GOVBR_URL, authMethods: ['password'], label: 'gov.br + senha' },
  { baseUrl: GOVBR_URL, authMethods: ['certificate', 'password'], label: 'gov.br + os dois' },
  { baseUrl: EXTERNAL_URL, authMethods: ['certificate'], label: 'externo + certificado' },
  { baseUrl: EXTERNAL_URL, authMethods: ['password'], label: 'externo + senha' },
  { baseUrl: EXTERNAL_URL, authMethods: ['certificate', 'password'], label: 'externo + os dois' },
]

describe('buildAutoRecipe', () => {
  for (const item of MATRIX) {
    it(`gera receita válida: ${item.label}`, () => {
      const recipe = buildAutoRecipe({
        slug: 'teste',
        baseUrl: item.baseUrl,
        authMethods: item.authMethods,
      })
      expect(() => recipeDefinitionSchema.parse(recipe)).not.toThrow()
      expect(recipe.autoSubmit).toBe(item.authMethods.includes('password'))
      expect(recipe.onFailure).toBe('manual')
      expect(recipe.service).toBe('teste')
    })
  }

  it('gov.br + certificado: usa o fluxo gov.br (clique no SSO)', () => {
    const recipe = buildAutoRecipe({ slug: 'x', baseUrl: GOVBR_URL, authMethods: ['certificate'] })
    expect(recipe.auth).toBe('certificate')
    expect(
      recipe.steps.some(
        (s) => s.action === 'evaluate' && (s.script ?? '').includes('login-certificate'),
      ),
    ).toBe(true)
    expect(recipe.postLogin.urlExcludes).toEqual(
      expect.arrayContaining(['login', 'autenticacao', 'auth/realms']),
    )
  })

  it('gov.br + senha: clica o botão de entrada (Fazer login) e preenche no SSO', () => {
    const recipe = buildAutoRecipe({ slug: 'x', baseUrl: GOVBR_URL, authMethods: ['password'] })
    expect(recipe.auth).toBe('password')
    expect(recipe.steps[0]?.action).toBe('evaluate')
    expect(recipe.steps[0]?.script).toContain('smart-entry')
    expect(recipe.steps.some((s) => (s.script ?? '').includes('login-certificate'))).toBe(false)
    expect(recipe.steps.some((s) => (s.script ?? '').includes('{{credential.username}}'))).toBe(
      true,
    )
    // Não existe CTA específico de gov.br: o clique de entrada é genérico
    // (vale para ISS/portais municipais com própria tela de login).
  })

  it('gov.br + os dois: clique de entrada + fluxo certificado + smart fill', () => {
    const recipe = buildAutoRecipe({
      slug: 'x',
      baseUrl: GOVBR_URL,
      authMethods: ['certificate', 'password'],
    })
    expect(recipe.auth).toBe('certificate')
    expect(recipe.steps[0]?.script).toContain('smart-entry')
    expect(recipe.steps.some((s) => (s.script ?? '').includes('login-certificate'))).toBe(true)
    expect(recipe.steps.some((s) => (s.script ?? '').includes('{{credential.username}}'))).toBe(
      true,
    )
    // Na sessão de certificado, os passos com segredos são descartados e o
    // fluxo permanece intacto (clique de entrada + SSO).
    const certSteps = recipe.steps.filter((step) => !stepCarriesCredentials(step))
    expect(certSteps.some((s) => (s.script ?? '').includes('login-certificate'))).toBe(true)
    expect(certSteps.some((s) => (s.script ?? '').includes('{{credential.'))).toBe(false)
    expect(certSteps[0]?.script).toContain('smart-entry')
  })

  it('externo + senha: smart entry + smart fill; pós-login por logout (nunca body)', () => {
    const recipe = buildAutoRecipe({ slug: 'x', baseUrl: EXTERNAL_URL, authMethods: ['password'] })
    expect(recipe.auth).toBe('password')
    expect(recipe.steps[0]?.action).toBe('evaluate')
    expect(recipe.steps[0]?.script).toContain('smart-entry')
    expect(recipe.steps.some((s) => (s.script ?? '').includes('{{credential.username}}'))).toBe(
      true,
    )
    expect(recipe.postLogin.selectors).toContain('a[href*="logout"]')
    expect(recipe.postLogin.selectors).not.toContain('body')
  })

  it('externo + certificado: sem passos; watcher de pós-login via mTLS', () => {
    const recipe = buildAutoRecipe({
      slug: 'x',
      baseUrl: EXTERNAL_URL,
      authMethods: ['certificate'],
    })
    expect(recipe.auth).toBe('certificate')
    expect(recipe.steps).toHaveLength(0)
    expect(recipe.postLogin.selectors).toContain('a[href*="logout"]')
  })
})

describe('SMART_ENTRY_SCRIPT', () => {
  it('reconhece página de formulário já visível e não clica nada', () => {
    expect(SMART_ENTRY_SCRIPT).toContain('hasLoginForm')
    expect(SMART_ENTRY_SCRIPT).toContain('formulario ja visivel')
  })
  it('procura CTA de entrada visível, sem clicar em nuvem/ajuda/esqueci a senha', () => {
    expect(SMART_ENTRY_SCRIPT).toContain('smart-entry: clicado')
    expect(SMART_ENTRY_SCRIPT).toContain('fazer login')
    expect(SMART_ENTRY_SCRIPT).not.toContain('nuvem')
    expect(SMART_ENTRY_SCRIPT).toContain('bestScore')
  })
  it('não carrega segredos (sem placeholders de credencial)', () => {
    expect(SMART_ENTRY_SCRIPT).not.toContain('{{credential.')
  })
})

describe('buildActionScript com placeholders em evaluate', () => {
  const values = recipeValues({ username: '52998224725', password: 'se"nha;process.exit();//' })

  it('substitui placeholders por literais JSON (sem injeção de senha no script)', () => {
    const script = buildActionScript(
      { action: 'evaluate', script: 'const p = {{credential.password}}; return p' },
      values,
    )
    expect(script).toContain(JSON.stringify('se"nha;process.exit();//'))
    // O valor cru (com aspas não escapadas) não pode aparecer fora de um literal
    expect(script).not.toContain('se"nha;process.exit();//')
  })

  it('substitui usuário por literal JSON', () => {
    const script = buildActionScript(
      { action: 'evaluate', script: 'const u = {{credential.username}}; return u' },
      values,
    )
    expect(script).toContain('"52998224725"')
  })

  it('evaluate com senha é passo sensível', () => {
    expect(isSensitiveStep({ action: 'evaluate', script: 'x {{credential.password}} y' })).toBe(
      true,
    )
    expect(isSensitiveStep({ action: 'evaluate', script: 'return 1' })).toBe(false)
  })
})
