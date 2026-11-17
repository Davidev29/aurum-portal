import { describe, expect, it } from 'vitest'
import forge from 'node-forge'
import {
  computeThumbprints,
  normalizeThumbprint,
  resolveCertificateSelection,
  type CertificateSelectionContext,
} from '../../electron/main/certificates/core'
import { redactUrl } from '../../electron/main/security/redaction'
import { hostnameOf, isGovernmentHost, parseHttpUrl } from '../../shared/network'

function makeDer(label: string): Buffer {
  return Buffer.from(`certificado-${label}`, 'utf8')
}

const der = makeDer('chaos')
const OTHER_DER = makeDer('chaos-outro')
const hashes = computeThumbprints(der)
const offered = [{ data: der }]

const baseContext: CertificateSelectionContext = {
  sessionId: 'session-chaos',
  clientId: 'client-chaos',
  clientName: 'Cliente Chaos',
  certificateThumbprint: hashes.sha256,
  allowedDomains: ['intranet.empresa.com'],
  url: 'https://intranet.empresa.com/',
}

const select = (
  url: unknown,
  context: CertificateSelectionContext | undefined = baseContext,
  list: Array<{ data?: unknown; fingerprint?: string }> = offered,
) => resolveCertificateSelection(context, url as string, list as never, undefined)

describe('caos: formato real do Electron em select-client-certificate', () => {
  // Regressão do incidente "O portal tentou autenticar fora da allowlist":
  // o Electron entrega a URL como "host:porta", sem esquema.
  // Certificado A1 só é injetado nos endpoints gov.br de identidade +
  // allowlist do serviço. Um host gov.br ARBITRÁRIO não recebe o A1.
  const ssoCases = [
    'certificado.sso.acesso.gov.br:443',
    'sso.acesso.gov.br:443',
    'sso.acesso.gov.br',
    'HTTPS://SSO.ACESSO.GOV.BR:443/path',
    'certificado.sso.acesso.gov.br.:443',
    '//sso.acesso.gov.br/login',
    'sso.acesso.gov.br:443/path/consulta?q=1',
    'acesso.gov.br:443',
    'contas.acesso.gov.br:443',
    'login.gov.br:443',
  ]

  for (const url of ssoCases) {
    it(`injeta certificado em host SSO gov.br: ${url}`, () => {
      expect(select(url).kind).toBe('selected')
    })
  }

  const arbitraryGovCases = [
    'cav.receita.fazenda.gov.br:443',
    'portalservicos.jucec.ce.gov.br:443',
    'assinador.iti.gov.br:443',
    'ecacontribuintes.receita.fazenda.gov.br:443',
    'intranet.gov.br:443',
  ]

  for (const url of arbitraryGovCases) {
    it(`NÃO injeta em host gov.br fora da allowlist: ${url}`, () => {
      expect(select(url).kind).toBe('host-not-allowed')
    })
  }

  it('injeta em host gov.br explicitamente na allowlist do serviço', () => {
    const context: CertificateSelectionContext = {
      ...baseContext,
      allowedDomains: ['cav.receita.fazenda.gov.br', 'assinador.iti.gov.br'],
    }
    expect(select('cav.receita.fazenda.gov.br:443', context).kind).toBe('selected')
    expect(select('assinador.iti.gov.br:443', context).kind).toBe('selected')
    // Curinga de subdomínio continua valendo apenas para a allowlist.
    const wildcard: CertificateSelectionContext = {
      ...baseContext,
      allowedDomains: ['*.iti.gov.br'],
    }
    expect(select('assinador.iti.gov.br:443', wildcard).kind).toBe('selected')
  })

  it('rejeita HTTP mesmo para hosts governamentais', () => {
    expect(select('http://sso.acesso.gov.br/').kind).toBe('host-not-allowed')
    expect(select('http://portal.gov.br/').kind).toBe('host-not-allowed')
  })

  it('rejeita esquema desconhecido para hosts governamentais', () => {
    expect(select('gopher://sso.acesso.gov.br/').kind).toBe('host-not-allowed')
    expect(select('file:///C:/sso.acesso.gov.br').kind).toBe('host-not-allowed')
  })

  const hostileLookalikes = [
    'gov.br.evil.com:443',
    'sso.acesso.gov.br.evil.com:443',
    'evil-gov.br:443',
    'govbr.com.br:443',
    'fazenda.gov.br.attacker.tld:443',
    'rnp.br:443',
    'gov.br:443@evil.com',
    'https://gov.br@evil.com/',
    'https://evil.com/@sso.acesso.gov.br',
    '.gov.br:443',
    'a..gov.br:443',
  ]

  for (const url of hostileLookalikes) {
    it(`falha fechada para domínio parecido: ${url}`, () => {
      expect(select(url).kind).toBe('host-not-allowed')
    })
  }

  it('FQDN com ponto final e @ no path continua sendo o host gov.br real', () => {
    // Em WHATWG, "\@" vira "/@" — o host permanece sso.acesso.gov.br. (o
    // servidor real da Receita/gov.br), e "evil.com" é apenas segmento de path.
    // Aceitar aqui é o comportamento correto; o certificado vai para gov.br.
    expect(select('https://sso.acesso.gov.br./@evil.com/').kind).toBe('selected')
  })

  it('usuário embutido antes do host desvia para evil.com e é recusado', () => {
    expect(select('https://sso.acesso.gov.br.@evil.com/').kind).toBe('host-not-allowed')
  })

  it('respeita allowlist explícita fora de .gov.br', () => {
    expect(select('intranet.empresa.com:443').kind).toBe('selected')
    expect(select('https://intranet.empresa.com:8443/portal').kind).toBe('selected')
    expect(select('outra.empresa.com:443').kind).toBe('host-not-allowed')
    expect(select('empresa.com:443').kind).toBe('host-not-allowed')
  })

  it('suporta allowlist com curinga de subdomínio para hosts não-gov', () => {
    const ctx = { ...baseContext, allowedDomains: ['*.empresa.com'] }
    expect(select('a.empresa.com:443', ctx).kind).toBe('selected')
    expect(select('deep.a.empresa.com:443', ctx).kind).toBe('selected')
    expect(select('empresa.com:443', ctx).kind).toBe('selected')
    expect(select('empresa.com.br:443', ctx).kind).toBe('host-not-allowed')
  })

  it('contexto sem allowlist recusa hosts não-gov mas aceita gov', () => {
    const ctx = { ...baseContext, allowedDomains: undefined as never }
    expect(select('intranet.empresa.com:443', ctx).kind).toBe('host-not-allowed')
    expect(select('sso.acesso.gov.br:443', ctx).kind).toBe('selected')
  })
})

describe('caos: entradas maliciosas e lixo', () => {
  const garbage: unknown[] = [
    null,
    undefined,
    '',
    '   ',
    '://',
    'https://',
    '%%%%',
    'a'.repeat(5_000),
    '0.0.0.0:999999',
    123,
    NaN,
    {},
    [],
    'https://sso.acesso.gov.br.@evil.com/',
    'https://evil.com/proxy?target=sso.acesso.gov.br',
    'java\tscript:alert(1)',
    String.fromCharCode(0) + 'sso.acesso.gov.br:443',
  ]

  for (const [index, url] of garbage.entries()) {
    it(`nunca lança exceção nem injeta em lixo #${index}`, () => {
      const result = select(url)
      expect(result.kind).not.toBe('selected')
      expect(result.certificate).toBeNull()
    })
  }
})

describe('caos: lista de certificados oferecidos pelo servidor', () => {
  it('lista vazia → not-offered', () => {
    const result = select('sso.acesso.gov.br:443', baseContext, [])
    expect(result.kind).toBe('not-offered')
    expect(result.offeredCount).toBe(0)
  })

  it('ignora entradas malformadas e seleciona a válida', () => {
    const malformed = [
      { fingerprint: '%%%' },
      { fingerprint: 'sha256/!!!$$$=' },
      { data: '%%%base64invalido%%%' },
      { data: Buffer.from([0, 1, 2, 3]) },
      { data: der.toString('base64').slice(0, 10) },
      {},
      { fingerprint: ' ' },
    ]
    const result = select('sso.acesso.gov.br:443', baseContext, [
      ...malformed,
      { data: der },
    ] as never)
    expect(result.kind).toBe('selected')
    expect(result.offeredCount).toBe(malformed.length + 1)
  })

  it('só lixo na lista → not-offered sem exceção', () => {
    const result = select('sso.acesso.gov.br:443', baseContext, [
      { fingerprint: '%%%' },
      { data: '%%%' },
      {},
    ] as never)
    expect(result.kind).toBe('not-offered')
  })

  it('fingerprint no formato sha256/<base64>= do Electron casa com o contexto', () => {
    const electronFingerprint = 'sha256/' + Buffer.from(hashes.sha256, 'hex').toString('base64')
    const result = select('sso.acesso.gov.br:443', baseContext, [
      { fingerprint: electronFingerprint },
    ] as never)
    expect(result.kind).toBe('selected')
  })

  it('fingerprint com padding = e sem padding casam igualmente', () => {
    const b64 = Buffer.from(hashes.sha256, 'hex').toString('base64')
    const padded = `sha256/${b64}`
    const stripped = `sha256/${b64.replace(/=+$/, '')}`
    expect(
      select('sso.acesso.gov.br:443', baseContext, [{ fingerprint: stripped }] as never).kind,
    ).toBe('selected')
    expect(normalizeThumbprint(padded)).toBe(hashes.sha256)
  })

  it('fingerprint sha1 do Electron casa no fallback', () => {
    const electronSha1 = 'sha1/' + Buffer.from(hashes.sha1, 'hex').toString('base64')
    const contextSha1: CertificateSelectionContext = {
      ...baseContext,
      certificateThumbprint: 'ffffeeeedddd',
    }
    const result = resolveCertificateSelection(
      contextSha1,
      'sso.acesso.gov.br:443',
      [{ fingerprint: electronSha1 }],
      hashes.sha1,
    )
    expect(result.kind).toBe('selected')
  })

  it('certificado PEM (data com BEGIN CERTIFICATE) é reconhecido pelo conteúdo', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64')}\n-----END CERTIFICATE-----`
    const result = select('sso.acesso.gov.br:443', baseContext, [{ data: pem }] as never)
    expect(result.kind).toBe('selected')
  })

  it('certificado de outro titular na lista não é selecionado', () => {
    const result = select('sso.acesso.gov.br:443', baseContext, [{ data: OTHER_DER }] as never)
    expect(result.kind).toBe('not-offered')
  })

  it('duplicatas do certificado correto são aceitas', () => {
    const result = select('sso.acesso.gov.br:443', baseContext, [
      { data: der },
      { data: der },
    ] as never)
    expect(result.kind).toBe('selected')
  })
})

describe('caos: encadeamento de redirecionamentos de SSO', () => {
  const chain = [
    'https://www.gov.br/empresas-e-negocios/login_cidadao',
    'https://sso.acesso.gov.br/authorize?client_id=e2e',
    'certificado.sso.acesso.gov.br:443',
    'https://sso.acesso.gov.br/callback?state=xyz',
  ]

  it('a cadeia SSO gov.br é aceita para certificado; a landing não recebe o A1', () => {
    for (const url of chain) {
      if (/empresas-e-negocios\/login_cidadao/.test(url)) {
        // A landing pública Redesim nunca dispara o handshake mTLS.
        expect(select(url).kind).toBe('host-not-allowed')
      } else {
        expect(select(url).kind).toBe('selected')
      }
    }
  })

  it('um salto malicioso na cadeia é recusado sem derrubar os demais', () => {
    const evil = 'https://cdn-malicioso.example/coletor'
    expect(parseHttpUrl(evil)).not.toBeNull()
    expect(isGovernmentHost(hostnameOf(evil) ?? '')).toBe(false)
    expect(select(evil).kind).toBe('host-not-allowed')
    // E os saltos legítimos continuam válidos depois do bloqueio.
    expect(select('sso.acesso.gov.br:443').kind).toBe('selected')
  })
})

describe('caos: vazamento de dados em mensagens e logs', () => {
  it('reason nunca contém o thumbprint do contexto', () => {
    const hostile = select('evil.com:443')
    expect(hostile.reason).not.toContain(hashes.sha256)
    expect(select('sso.acesso.gov.br:443', baseContext, []).reason).not.toContain(hashes.sha256)
  })

  it('redactUrl remove token de query em URLs sem esquema (formato Electron)', () => {
    const redacted = redactUrl('sso.acesso.gov.br:443/callback?token=SEGREDO123&state=abc')
    expect(redacted).not.toContain('SEGREDO123')
    expect(redacted).toMatch(/REDACTED/)
  })

  it('redactUrl nunca devolve credenciais embutidas na autoridade', () => {
    expect(redactUrl('https://user:segredo@sso.acesso.gov.br/')).not.toContain('segredo')
    expect(redactUrl('user:segredo@sso.acesso.gov.br:443')).not.toContain('segredo')
  })
})

describe('caos: thumbprints do contexto em formatos variados', () => {
  const electronSha256 = `sha256/${Buffer.from(hashes.sha256, 'hex').toString('base64')}`

  const contexts: Array<[string, string]> = [
    ['hex minúsculo', hashes.sha256.toLowerCase()],
    ['hex maiúsculo', hashes.sha256.toUpperCase()],
    ['hex com dois-pontos', (hashes.sha256.match(/.{2}/g) as string[]).join(':')],
    ['hex com espaços', (hashes.sha256.match(/.{2}/g) as string[]).join(' ')],
    ['formato Electron sha256/base64', electronSha256],
  ]

  for (const [label, thumbprint] of contexts) {
    it(`contexto com ${label} seleciona o certificado`, () => {
      const ctx = { ...baseContext, certificateThumbprint: thumbprint }
      expect(select('sso.acesso.gov.br:443', ctx).kind).toBe('selected')
    })
  }
})

describe('caos: PEM criado com chave real (fluxo de importação)', () => {
  it('thumbprint de certificado forge corresponde entre PFX e PEM', () => {
    const keys = forge.pki.rsa.generateKeyPair(2048)
    const certificate = forge.pki.createCertificate()
    certificate.publicKey = keys.publicKey
    certificate.serialNumber = '01CAOS'
    certificate.validity.notBefore = new Date('2024-01-01T00:00:00.000Z')
    certificate.validity.notAfter = new Date('2035-01-01T00:00:00.000Z')
    const subject = [{ name: 'commonName', value: 'Chaos Teste' }]
    certificate.setSubject(subject)
    certificate.setIssuer(subject)
    certificate.sign(keys.privateKey, forge.md.sha256.create())
    const pem = forge.pki.certificateToPem(certificate)
    const derBytes = Buffer.from(
      forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()),
      'base64',
    )
    const expected = computeThumbprints(derBytes).sha256
    const ctx = { ...baseContext, certificateThumbprint: expected }
    expect(select('sso.acesso.gov.br:443', ctx, [{ data: pem }] as never).kind).toBe('selected')
  }, 30_000)
})
