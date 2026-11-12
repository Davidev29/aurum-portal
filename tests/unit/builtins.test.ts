import { describe, expect, it } from 'vitest'
import { BUILTIN_SERVICES } from '../../shared/builtins'
import { BUILTIN_SERVICE_IDS } from '../../shared/constants'
import { serviceInputSchema } from '../../shared/contracts'
import { recipeDefinitionSchema } from '../../shared/recipe'
import { isAllowedHost } from '../../shared/network'
import { existsSync } from 'node:fs'
import path from 'node:path'

describe('serviços nativos (store)', () => {
  it('não tem slugs ou IDs duplicados', () => {
    const slugs = BUILTIN_SERVICES.map((s) => s.slug)
    const ids = BUILTIN_SERVICES.map((s) => s.id)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('BUILTIN_SERVICE_IDS aponta para seeds existentes', () => {
    for (const id of Object.values(BUILTIN_SERVICE_IDS)) {
      expect(BUILTIN_SERVICES.some((s) => s.id === id), id).toBe(true)
    }
  })

  it('cada seed passa no schema é válido para abrir sessão', () => {
    for (const seed of BUILTIN_SERVICES) {
      const parsed = serviceInputSchema.parse({
        name: seed.name,
        slug: seed.slug,
        category: seed.category,
        baseUrl: seed.baseUrl,
        allowedDomains: seed.allowedDomains,
        authMethods: seed.authMethods,
        defaultAuth: seed.defaultAuth,
        notes: seed.notes,
      })
      const baseHost = new URL(seed.baseUrl).hostname.toLowerCase()
      expect(isAllowedHost(baseHost, seed.allowedDomains), seed.slug).toBe(true)
      expect(seed.authMethods).toContain(seed.defaultAuth)
      expect(parsed.slug).toBe(seed.slug)
    }
  })

  it('cada receita nativa é válida; certificado é manual, senha pura entra sozinho', () => {
    for (const seed of BUILTIN_SERVICES) {
      const parsed = recipeDefinitionSchema.parse(seed.recipe)
      expect(parsed.version).toBe(1)
      expect(parsed.onFailure).toBe('manual')
      if (seed.authMethods.length === 1 && seed.authMethods[0] === 'password') {
        // Prefeituras SpeedGov: autofill + Entrar sozinho, portal oculto com
        // a animação de boot até autenticar (captcha/2FA revelam o portal).
        expect(parsed.autoSubmit, seed.slug).toBe(true)
      } else {
        expect(parsed.autoSubmit, seed.slug).toBe(false)
      }
    }
  })

  it('baseUrl nativa usa HTTPS e não carrega session_code efêmero', () => {
    for (const seed of BUILTIN_SERVICES) {
      const url = new URL(seed.baseUrl)
      expect(url.protocol, seed.slug).toBe('https:')
      // Query efêmera do SSO Keycloak (session_code/tab_id/client_data) não pode
      // ser persistida: o portal deve gerar sessão nova a cada abertura.
      expect(url.searchParams.has('session_code'), seed.slug).toBe(false)
      expect(url.searchParams.has('session_code'), seed.slug).toBe(false)
      if (seed.slug === 'siga-sefaz-ce') {
        // SIGA abre pela UI do app; o SSO (sso.sefaz.ce.gov.br) precisa estar
        // na allowlist para o handshake de certificado.
        expect(url.hostname).toBe('siga.sefaz.ce.gov.br')
        expect(isAllowedHost('sso.sefaz.ce.gov.br', seed.allowedDomains)).toBe(true)
      }
    }
  })

  it('URLs canônicas entregues nos links são as persistidas (com rota/hash)', () => {
    const bySlug = new Map(BUILTIN_SERVICES.map((s) => [s.slug, s.baseUrl]))
    expect(bySlug.get('pendencias-cnpj')).toBe(
      'https://servicos.receitafederal.gov.br/servico/pendencias/#/analise-pendencias',
    )
    expect(bySlug.get('fgts-digital')).toBe('https://fgtsdigital.sistema.gov.br/portal/servicos')
    expect(bySlug.get('esocial')).toBe('https://www.esocial.gov.br/portal/')
    expect(bySlug.get('det-trabalhista')).toBe('https://det.sit.trabalho.gov.br/')
    expect(bySlug.get('simples-nacional')).toBe(
      'https://www8.receita.fazenda.gov.br/SimplesNacional/Servicos/Grupo.aspx?grp=t&area=1',
    )
    expect(bySlug.get('registrato')).toBe('https://meubc.bcb.gov.br/meubc/')
    expect(bySlug.get('dte-sefaz-ce')).toBe('https://portal-dte.sefaz.ce.gov.br/#/certificado')
  })

  it('logomarcas empacotadas existem em public/portals', () => {
    const root = path.resolve(__dirname, '..', '..', 'public', 'portals')
    for (const seed of BUILTIN_SERVICES) {
      if (!seed.logoAsset) continue
      expect(seed.logoAsset.startsWith('/portals/'), seed.slug).toBe(true)
      const file = path.join(root, path.basename(seed.logoAsset))
      expect(existsSync(file), `${seed.slug}: ${file}`).toBe(true)
    }
  })
})
