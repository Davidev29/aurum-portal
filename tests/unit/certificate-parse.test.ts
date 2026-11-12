import { describe, expect, it } from 'vitest'
import forge from 'node-forge'
import { parsePfx, parsePfxSafe } from '../../electron/main/certificates/parse'

type PfxOptions = {
  cn?: string | null
  organization?: string
  sans?: Array<{ type: number; value: string }>
  notBefore?: Date
  notAfter?: Date
  password?: string
  includeCert?: boolean
}

function createPfx(options: PfxOptions = {}): Buffer {
  const password = options.password ?? 'senha-pfx'
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01AB'
  cert.validity.notBefore = options.notBefore ?? new Date('2024-01-01T00:00:00.000Z')
  cert.validity.notAfter = options.notAfter ?? new Date('2030-01-01T00:00:00.000Z')

  const subject: forge.pki.CertificateField[] = []
  if (options.cn !== null) {
    subject.push({ name: 'commonName', value: options.cn ?? 'EMPRESA EXEMPLO LTDA' })
  }
  subject.push({ name: 'organizationName', value: options.organization ?? 'Empresa Exemplo' })
  cert.setSubject(subject)
  cert.setIssuer(subject)
  const extensions: Array<Record<string, unknown>> = [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  ]
  if (options.sans && options.sans.length > 0) {
    extensions.push({ name: 'subjectAltName', altNames: options.sans })
  }
  cert.setExtensions(extensions)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    options.includeCert === false ? [] : [cert],
    password,
    { algorithm: '3des' },
  )
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary')
}

describe('parse de PFX/P12', () => {
  it('extrai titular, documento e thumbprints', () => {
    const pfx = createPfx({ cn: 'JOAO DA SILVA:529.982.247-25', organization: 'Escritorio' })
    const parsed = parsePfx(pfx, 'senha-pfx')
    expect(parsed.holderName).toBe('JOAO DA SILVA')
    expect(parsed.document).toBe('52998224725')
    expect(parsed.documentType).toBe('CPF')
    expect(parsed.subjectDn).toContain('CN=JOAO DA SILVA')
    expect(parsed.issuerDn).toContain('O=Escritorio')
    expect(parsed.thumbprintSha1).toMatch(/^[A-F0-9]{40}$/)
    expect(parsed.thumbprintSha256).toMatch(/^[A-F0-9]{64}$/)
    expect(parsed.hasPrivateKey).toBe(true)
    expect(parsed.certificateCount).toBe(1)
    expect(parsed.isExpired).toBe(false)
    expect(parsed.validTo).toBe('2030-01-01T00:00:00.000Z')
  })

  it('extrai CNPJ do CN', () => {
    const pfx = createPfx({ cn: 'EMPRESA TESTE:11.222.333/0001-81' })
    const parsed = parsePfx(pfx, 'senha-pfx')
    expect(parsed.documentType).toBe('CNPJ')
    expect(parsed.document).toBe('11222333000181')
  })

  it('usa organization como fallback e documento na SAN', () => {
    const pfx = createPfx({
      cn: null,
      organization: 'Empresa Sem CN',
      sans: [{ type: 0, value: '52998224725' }],
    })
    const parsed = parsePfx(pfx, 'senha-pfx')
    expect(parsed.holderName).toBe('Empresa Sem CN')
    expect(parsed.document).toBe('52998224725')
  })

  it('retorna OTHER quando nao encontra documento', () => {
    const parsed = parsePfx(createPfx({ cn: 'TITULAR SEM DOCUMENTO' }), 'senha-pfx')
    expect(parsed.document).toBeNull()
    expect(parsed.documentType).toBe('OTHER')
  })

  it('marca certificado vencido', () => {
    const parsed = parsePfx(
      createPfx({ notBefore: new Date('2020-01-01'), notAfter: new Date('2021-01-01') }),
      'senha-pfx',
    )
    expect(parsed.isExpired).toBe(true)
  })

  it('rejeita senha incorreta, arquivo vazio e conteudo invalido', () => {
    const pfx = createPfx()
    expect(() => parsePfx(pfx, 'senha-errada')).toThrow(/Senha do PFX|ler o PFX/)
    expect(() => parsePfx(Buffer.alloc(0), 'x')).toThrow(/vazio/)
    expect(() => parsePfx(Buffer.from('nao-e-pfx'), 'x')).toThrow(/ler o PFX/)
  })

  it('parsePfxSafe devolve resultado tipado', () => {
    const pfx = createPfx()
    const success = parsePfxSafe(pfx, 'senha-pfx')
    expect(success.ok).toBe(true)
    if (success.ok) expect(success.value.holderName).toBe('EMPRESA EXEMPLO LTDA')
    const failure = parsePfxSafe(pfx, 'errada')
    expect(failure.ok).toBe(false)
    if (!failure.ok) expect(failure.error).toBeTruthy()
  })

  it('rejeita PFX sem certificado', () => {
    expect(() => parsePfx(createPfx({ includeCert: false }), 'senha-pfx')).toThrow()
  })
})
