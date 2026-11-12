import { describe, expect, it } from 'vitest'
import {
  GOVERNMENT_HOST_SUFFIXES,
  hostnameOf,
  isAllowedHost,
  isGovernmentHost,
  matchesDomainPattern,
  normalizeHostname,
  parseHttpUrl,
} from '../../shared/network'

describe('normalizeHostname', () => {
  it('normaliza caixa, espaços e ponto final de FQDN', () => {
    expect(normalizeHostname('  SSO.Acesso.GOV.BR. ')).toBe('sso.acesso.gov.br')
    expect(normalizeHostname('cav.receita.fazenda.gov.br.')).toBe('cav.receita.fazenda.gov.br')
    expect(normalizeHostname('a.b.c.gov.br...')).toBe('a.b.c.gov.br')
  })
})

describe('isGovernmentHost', () => {
  it('aceita gov.br e qualquer subdomínio de .gov.br', () => {
    expect(isGovernmentHost('gov.br')).toBe(true)
    expect(isGovernmentHost('SSO.ACESSO.GOV.BR')).toBe(true)
    expect(isGovernmentHost('certificado.sso.acesso.gov.br')).toBe(true)
    expect(isGovernmentHost('cav.receita.fazenda.gov.br')).toBe(true)
    expect(isGovernmentHost('portalservicos.jucec.ce.gov.br')).toBe(true)
    expect(isGovernmentHost('sso.acesso.gov.br.')).toBe(true)
  })

  it('recusa domínios que apenas se parecem com gov.br', () => {
    expect(isGovernmentHost('govbr.com.br')).toBe(false)
    expect(isGovernmentHost('gov.br.evil.com')).toBe(false)
    expect(isGovernmentHost('evil-gov.br')).toBe(false)
    expect(isGovernmentHost('rnp.br')).toBe(false)
    expect(isGovernmentHost('acesso.gov.com')).toBe(false)
    expect(isGovernmentHost('fazenda.gov.br.attacker.tld')).toBe(false)
  })

  it('recusa hosts com labels vazios ou inválidos', () => {
    expect(isGovernmentHost('')).toBe(false)
    expect(isGovernmentHost('.gov.br')).toBe(false)
    expect(isGovernmentHost('a..gov.br')).toBe(false)
    expect(isGovernmentHost('..')).toBe(false)
  })

  it('expõe os sufixos suportados como lista explícita', () => {
    expect(GOVERNMENT_HOST_SUFFIXES).toEqual(['.gov.br'])
  })
})

describe('parseHttpUrl', () => {
  it('faz parse de URLs HTTPS completas', () => {
    const url = parseHttpUrl('https://sso.acesso.gov.br/login?x=1')
    expect(url).not.toBeNull()
    expect(url!.protocol).toBe('https:')
    expect(url!.hostname).toBe('sso.acesso.gov.br')
    expect(normalizeHostname(url!.hostname)).toBe('sso.acesso.gov.br')
  })

  it('aceita o formato host:porta sem esquema usado pelo Electron', () => {
    const cases: Array<[string, string]> = [
      ['certificado.sso.acesso.gov.br:443', 'certificado.sso.acesso.gov.br'],
      ['sso.acesso.gov.br:443', 'sso.acesso.gov.br'],
      ['127.0.0.1:56636', '127.0.0.1'],
      ['localhost:3000', 'localhost'],
      ['SSO.ACESSO.GOV.BR:443', 'sso.acesso.gov.br'],
    ]
    for (const [raw, expectedHost] of cases) {
      expect(hostnameOf(raw)).toBe(expectedHost)
    }
  })

  it('rejeita esquemas que não sejam HTTP/HTTPS', () => {
    expect(parseHttpUrl('file:///C:/Windows/System32/drivers/etc/hosts')).toBeNull()
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull()
    expect(parseHttpUrl('ftp://sso.acesso.gov.br/x')).toBeNull()
    expect(parseHttpUrl('certificado.sso.acesso.gov.br:99999')).toBeNull()
    // Esquema customizado: o parser do WHATWG aceitaria como scheme válido,
    // nunca como host. Precisa ser rejeitado, não "escapado".
    expect(parseHttpUrl('a:b')).toBeNull()
    expect(parseHttpUrl('mailto:portal@gov.br')).toBeNull()
  })

  it('rejeita credenciais embutidas na URL', () => {
    expect(parseHttpUrl('https://user:pass@sso.acesso.gov.br/')).toBeNull()
    expect(parseHttpUrl('https://user@sso.acesso.gov.br/')).toBeNull()
    expect(parseHttpUrl('https://mailto:portal@gov.br/')).toBeNull()
    expect(parseHttpUrl('user:pass@sso.acesso.gov.br:443')).toBeNull()
  })

  it('rejeita entradas vazias, nulas ou lixo', () => {
    expect(parseHttpUrl('')).toBeNull()
    expect(parseHttpUrl('   ')).toBeNull()
    expect(parseHttpUrl(null)).toBeNull()
    expect(parseHttpUrl(undefined)).toBeNull()
    expect(parseHttpUrl('https://')).toBeNull()
    expect(parseHttpUrl('://')).toBeNull()
    expect(parseHttpUrl('a'.repeat(10_000))).toBeNull()
  })

  it('normaliza caixa e ponto final de FQDN', () => {
    expect(hostnameOf('HTTPS://SSO.ACESSO.GOV.BR./login')).toBe('sso.acesso.gov.br')
    expect(hostnameOf('//sso.acesso.gov.br/path')).toBe('sso.acesso.gov.br')
  })

  it('rejeita hosts com labels vazios', () => {
    expect(parseHttpUrl('https://.gov.br/')).toBeNull()
    expect(parseHttpUrl('https://a..gov.br/')).toBeNull()
  })

  it('preserva IPv6 entre colchetes', () => {
    expect(parseHttpUrl('https://[2001:db8::1]:8443/x')).not.toBeNull()
    expect(hostnameOf('[2001:db8::1]:8443')).toBe('[2001:db8::1]')
  })
})

describe('matchesDomainPattern', () => {
  it('casa domínio exato e curinga de subdomínio', () => {
    expect(matchesDomainPattern('portal.exemplo.gov.br', 'portal.exemplo.gov.br')).toBe(true)
    expect(matchesDomainPattern('a.exemplo.gov.br', '*.exemplo.gov.br')).toBe(true)
    expect(matchesDomainPattern('exemplo.gov.br', '*.exemplo.gov.br')).toBe(true)
    expect(matchesDomainPattern('a.b.exemplo.gov.br', '*.exemplo.gov.br')).toBe(true)
    expect(matchesDomainPattern('exemplo.com', '*.exemplo.gov.br')).toBe(false)
  })

  it('é case-insensitive e ignora ponto final', () => {
    expect(matchesDomainPattern('PORTAL.GOV.BR.', 'portal.gov.br')).toBe(true)
    expect(matchesDomainPattern('A.GOV.BR', '*.GOV.BR')).toBe(true)
  })

  it('recusa padrões com curinga que não seja o prefixo *.', () => {
    expect(matchesDomainPattern('a.gov.br', '*.*.gov.br')).toBe(false)
    expect(matchesDomainPattern('a.gov.br', 'gov.*')).toBe(false)
  })

  it('recusa labels vazios no host', () => {
    expect(matchesDomainPattern('.gov.br', '.gov.br')).toBe(false)
    expect(matchesDomainPattern('a..gov.br', 'a..gov.br')).toBe(false)
  })
})

describe('isAllowedHost', () => {
  const allowlist = [
    'sso.acesso.gov.br',
    '*.receita.fazenda.gov.br',
    'portalservicos.jucec.ce.gov.br',
  ]

  it('aceita hosts na allowlist', () => {
    expect(isAllowedHost('sso.acesso.gov.br', allowlist)).toBe(true)
    expect(isAllowedHost('cav.receita.fazenda.gov.br', allowlist)).toBe(true)
    expect(isAllowedHost('CAV.RECEITA.FAZENDA.GOV.BR.', allowlist)).toBe(true)
  })

  it('recusa hosts fora da allowlist', () => {
    expect(isAllowedHost('malicioso.com', allowlist)).toBe(false)
    expect(isAllowedHost('acesso.gov.br', allowlist)).toBe(false)
    expect(isAllowedHost('qualquer.receita.fazenda.gov.br.evil.com', allowlist)).toBe(false)
  })

  it('falha fechado para allowlist vazia ou inválida', () => {
    expect(isAllowedHost('sso.acesso.gov.br', [])).toBe(false)
    expect(isAllowedHost('sso.acesso.gov.br', undefined as unknown as string[])).toBe(false)
    expect(isAllowedHost('sso.acesso.gov.br', null as unknown as string[])).toBe(false)
  })
})
