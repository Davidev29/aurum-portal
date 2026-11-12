import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import forge from 'node-forge'
import {
  certificateDataToDer,
  computeCertificateStatus,
  computeThumbprints,
  daysUntil,
  dnEquals,
  formatDn,
  isCertificateUsable,
  normalizeDn,
  normalizeSerialHex,
  normalizeThumbprint,
  normalizeThumbprintSha256,
  pemToDer,
  resolveCertificateSelection,
  selectCertificateByThumbprint,
} from '../../electron/main/certificates/core'

function makeDer(label: string): Buffer {
  return Buffer.from(`certificado-${label}`, 'utf8')
}

const context = {
  sessionId: 'session-1',
  clientId: 'client-1',
  clientName: 'Cliente',
  certificateThumbprint: '',
  allowedDomains: ['portal.gov.br'],
  url: 'https://portal.gov.br/login',
}

describe('utilitarios de certificado', () => {
  it('normaliza thumbprints removendo separadores e caixa', () => {
    expect(normalizeThumbprint('aa:bb-cc dd')).toBe('AABBCCDD')
    expect(normalizeThumbprintSha256('AA:BB:CC')).toBe('aabbcc')
  })

  it('converte PEM e base64 para DER', () => {
    const der = makeDer('pem')
    const base64 = der.toString('base64')
    const pem = `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----`
    expect(pemToDer(pem)).toEqual(der)
    expect(certificateDataToDer(pem)).toEqual(der)
    expect(certificateDataToDer(base64)).toEqual(der)
    expect(certificateDataToDer(der)).toEqual(der)
  })

  it('calcula SHA-1 e SHA-256 do DER', () => {
    const der = makeDer('hash')
    const hashes = computeThumbprints(der)
    expect(hashes.sha1).toBe(createHash('sha1').update(der).digest('hex').toUpperCase())
    expect(hashes.sha256).toBe(createHash('sha256').update(der).digest('hex').toUpperCase())
  })

  it('seleciona por fingerprint, por SHA-256 do conteudo e por SHA-1', () => {
    const der = makeDer('selecionado')
    const hashes = computeThumbprints(der)
    const byFingerprint = { fingerprint: hashes.sha256.toLowerCase(), id: 'a' }
    const byDer = { data: der, id: 'b' }
    const byPem = {
      data: forge.util.encode64(der.toString('binary')),
      id: 'c',
    }
    expect(selectCertificateByThumbprint([byFingerprint], hashes.sha256)?.id).toBe('a')
    expect(selectCertificateByThumbprint([byDer], hashes.sha256)?.id).toBe('b')
    expect(selectCertificateByThumbprint([byPem], hashes.sha256)?.id).toBe('c')
    expect(selectCertificateByThumbprint([byDer], hashes.sha256, hashes.sha1)?.id).toBe('b')
    expect(selectCertificateByThumbprint([byDer], 'NAOEXISTE', hashes.sha1)?.id).toBe('b')
    expect(
      selectCertificateByThumbprint([{ data: Buffer.from('outro') }], hashes.sha256),
    ).toBeNull()
    expect(
      selectCertificateByThumbprint([{ data: Buffer.from(hashes.sha256, 'hex') }], hashes.sha256),
    ).toBeNull()
  })

  it('ignora certificados malformados e segue para o proximo', () => {
    const der = makeDer('bom')
    const hashes = computeThumbprints(der)
    const malformed = { data: Promise.resolve('x') as unknown as string }
    expect(selectCertificateByThumbprint([malformed, { data: der }], hashes.sha256)).not.toBeNull()
  })
})

describe('resolucao de selecao de certificado', () => {
  const der = makeDer('contexto')
  const hashes = computeThumbprints(der)
  const list = [{ data: der }]

  it('cancela sem contexto', () => {
    const decision = resolveCertificateSelection(undefined, 'https://portal.gov.br/', list)
    expect(decision.kind).toBe('no-context')
    expect(decision.certificate).toBeNull()
    expect(decision.offeredCount).toBe(1)
  })

  it('cancela URL invalida e host fora da allowlist', () => {
    expect(
      resolveCertificateSelection(
        { ...context, certificateThumbprint: hashes.sha256 },
        'nao-e-url',
        list,
      ).kind,
    ).toBe('host-not-allowed')
    expect(
      resolveCertificateSelection(
        { ...context, certificateThumbprint: hashes.sha256 },
        'https://malicioso.com/login',
        list,
      ).kind,
    ).toBe('host-not-allowed')
  })

  it('informa quando o certificado nao foi oferecido', () => {
    const decision = resolveCertificateSelection(
      { ...context, certificateThumbprint: hashes.sha256 },
      'https://portal.gov.br/login',
      [{ data: makeDer('outro') }],
    )
    expect(decision.kind).toBe('not-offered')
    expect(decision.reason).toMatch(/nao foi oferecido/)
  })

  it('seleciona o certificado esperado', () => {
    const decision = resolveCertificateSelection(
      { ...context, certificateThumbprint: hashes.sha256 },
      'https://portal.gov.br/login',
      list,
      hashes.sha1,
    )
    expect(decision.kind).toBe('selected')
    expect(decision.certificate).toEqual(list[0])
    expect(decision.reason).toMatch(/explicitamente/)
  })
})

describe('status e validade', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('calcula dias restantes com arredondamento para cima', () => {
    expect(daysUntil('2026-01-02T00:00:00.000Z', now)).toBe(1)
    expect(daysUntil('2025-12-31T00:00:00.000Z', now)).toBe(-1)
    expect(daysUntil('invalido', now)).toBe(0)
  })

  it('classifica todos os estados do certificado', () => {
    const base = { source: 'pfx' as const, installed: true, now }
    expect(computeCertificateStatus({ ...base, validTo: '2025-12-01T00:00:00.000Z' })).toBe(
      'expired',
    )
    expect(computeCertificateStatus({ ...base, validTo: '2026-01-09T00:00:00.000Z' })).toBe(
      'expiring',
    )
    expect(computeCertificateStatus({ ...base, validTo: '2027-01-01T00:00:00.000Z' })).toBe('valid')
    expect(
      computeCertificateStatus({ ...base, installed: false, validTo: '2027-01-01T00:00:00.000Z' }),
    ).toBe('in_vault')
    expect(
      computeCertificateStatus({
        ...base,
        source: 'windows',
        installed: false,
        usedToAuthenticate: true,
        validTo: '2027-01-01T00:00:00.000Z',
      }),
    ).toBe('missing_windows')
    expect(
      computeCertificateStatus({
        ...base,
        chainIncomplete: true,
        validTo: '2027-01-01T00:00:00.000Z',
      }),
    ).toBe('chain_incomplete')
  })

  it('distingue status utilizavel', () => {
    expect(isCertificateUsable('valid')).toBe(true)
    expect(isCertificateUsable('expiring')).toBe(true)
    expect(isCertificateUsable('in_vault')).toBe(true)
    expect(isCertificateUsable('expired')).toBe(false)
    expect(isCertificateUsable('missing_windows')).toBe(false)
    expect(isCertificateUsable('chain_incomplete')).toBe(false)
  })

  it('normaliza e formata distinguished names', () => {
    expect(normalizeDn(' cn = Fulano , o=Empresa , ou = TI ')).toBe('CN=Fulano,O=Empresa,OU=TI')
    expect(
      formatDn([
        { shortName: 'CN', value: 'Fulano' },
        { name: 'O', value: 'Empresa' },
        { value: 'sem-nome' },
        { shortName: 'OU', value: '' },
      ]),
    ).toBe('CN=Fulano, O=Empresa, ?=sem-nome')
  })
})

describe('injeção dinâmica e precisa', () => {
  it('normaliza serial hex removendo separadores e zeros à esquerda', () => {
    expect(normalizeSerialHex('00ab:cd:ef')).toBe('ABCDEF')
    expect(normalizeSerialHex(' 0A 1B ')).toBe('A1B')
    expect(normalizeSerialHex(null)).toBe('')
  })

  it('compara DNs de forma insensível a ordem e caixa', () => {
    expect(dnEquals('CN=Fulano,O=Empresa', 'o = Empresa , CN = fulano')).toBe(true)
    expect(dnEquals('CN=Fulano', 'CN=Outro')).toBe(false)
    expect(dnEquals(null, 'CN=Fulano')).toBe(false)
  })

  it('aceita data binária (latin1) além de base64 e PEM', () => {
    const der = Buffer.from([0x30, 0x82, 0x00, 0xff, 0x80, 0x41, 0x42])
    const binary = der.toString('binary')
    expect(certificateDataToDer(binary)).toEqual(der)
    expect(certificateDataToDer(der.toString('base64'))).toEqual(der)
  })

  it('seleciona por serial + emissor quando fingerprint/DER não estão disponíveis', () => {
    const der = makeDer('serial')
    const hashes = computeThumbprints(der)
    // Simula entrega só com serial/emissor (sem fingerprint útil e sem data).
    const offered = {
      fingerprint: 'sha256/NUoU0bQz2qL0tW7hYk3mE8p0r5s4t6u8v2w0x=',
      data: undefined,
      serialNumber: '00AB:CD',
      issuerName: 'CN=AC, O=ICP',
      subjectName: 'CN=Fulano',
    }
    const chosen = selectCertificateByThumbprint(
      [{ id: 'x', ...offered }],
      hashes.sha256,
      hashes.sha1,
      { serialHex: 'abcd', issuerName: 'cn=ac, o=icp', subjectName: 'CN=Fulano' },
    )
    expect(chosen?.id).toBe('x')
  })

  it('não escolhe certificado errado com serial igual mas emissor diferente', () => {
    const der = makeDer('outro')
    const hashes = computeThumbprints(der)
    const offered = {
      id: 'errado',
      fingerprint: 'sha256/NUoU0bQz2qL0tW7hYk3mE8p0r5s4t6u8v2w0x=',
      serialNumber: 'ABCD',
      issuerName: 'CN=AC-ERRADA, O=ICP',
      subjectName: 'CN=Fulano',
    }
    const chosen = selectCertificateByThumbprint([offered], hashes.sha256, hashes.sha1, {
      serialHex: 'ABCD',
      issuerName: 'CN=AC, O=ICP',
      subjectName: 'CN=Fulano',
    })
    expect(chosen).toBeNull()
  })

  it('resolve com contexto completo (serial + DN) via resolveCertificateSelection', () => {
    const der = makeDer('contexto-serial')
    const hashes = computeThumbprints(der)
    const decision = resolveCertificateSelection(
      {
        ...context,
        certificateThumbprint: hashes.sha256,
        certificateSerialHex: 'A1B2',
        certificateIssuerName: 'CN=AC, O=ICP',
        certificateSubjectName: 'CN=Titular',
      },
      'https://portal.gov.br/login',
      [
        {
          fingerprint: 'sha256/AAAA',
          serialNumber: 'A1B2',
          issuerName: 'CN=AC, O=ICP',
          subjectName: 'CN=Titular',
        },
      ],
      hashes.sha1,
    )
    expect(decision.kind).toBe('selected')
  })
})
