import { describe, expect, it } from 'vitest'
import {
  estimatePasswordStrength,
  generatePassword,
  strengthLabel,
} from '../../electron/main/security/password'
import {
  emptyToNull,
  redactRecord,
  redactString,
  redactUrl,
  safeErrorForAudit,
} from '../../electron/main/security/redaction'

describe('gerador de senhas', () => {
  it('gera senha com todos os grupos por padrao', () => {
    const generated = generatePassword()
    expect(generated.password).toHaveLength(24)
    expect(generated.password).toMatch(/[A-Z]/)
    expect(generated.password).toMatch(/[a-z]/)
    expect(generated.password).toMatch(/\d/)
    expect(generated.password).toMatch(/[^A-Za-z0-9]/)
    expect(generated.strength).toBeGreaterThanOrEqual(3)
    expect(generated.password).not.toMatch(/[0O1lI]/)
  })

  it('respeita comprimento e grupos escolhidos', () => {
    const onlyNumbers = generatePassword({
      length: 12,
      uppercase: false,
      lowercase: false,
      numbers: true,
      symbols: false,
    })
    expect(onlyNumbers.password).toHaveLength(12)
    expect(onlyNumbers.password).toMatch(/^[23456789]+$/)
  })

  it('aplica limites de comprimento seguro', () => {
    expect(generatePassword({ length: 4 }).password).toHaveLength(8)
    expect(generatePassword({ length: 999 }).password).toHaveLength(128)
    expect(generatePassword({ length: 30.9 }).password).toHaveLength(30)
  })

  it('rejeita configuracao sem nenhum grupo', () => {
    expect(() =>
      generatePassword({
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
      }),
    ).toThrow(/tipo de caractere/i)
  })

  it('gera valores diferentes entre chamadas', () => {
    const first = generatePassword({ length: 32 }).password
    const second = generatePassword({ length: 32 }).password
    expect(first).not.toBe(second)
  })

  it('estima forca por classes, comprimento e unicidade', () => {
    expect(estimatePasswordStrength('')).toBe(0)
    expect(estimatePasswordStrength('aaaa')).toBe(0)
    expect(estimatePasswordStrength('abcdefgh')).toBe(1)
    expect(estimatePasswordStrength('abcdefgh1')).toBe(2)
    expect(estimatePasswordStrength('Abcdefgh1')).toBe(3)
    expect(estimatePasswordStrength('Abcdefgh1!xyZ9')).toBe(4)
    expect(estimatePasswordStrength('aaaaaaaaaaaaaaaa')).toBe(2)
    expect(estimatePasswordStrength('aaaaaaaaaaaaaaaa')).toBeLessThan(
      estimatePasswordStrength('Abcdefgh1!xyZ9'),
    )
  })

  it('rotula a forca de 0 a 4', () => {
    expect(strengthLabel(0)).toBe('Muito fraca')
    expect(strengthLabel(1)).toBe('Fraca')
    expect(strengthLabel(2)).toBe('Razoavel')
    expect(strengthLabel(3)).toBe('Boa')
    expect(strengthLabel(4)).toBe('Forte')
    expect(strengthLabel(9)).toBe('Desconhecida')
  })
})

describe('redacao de dados sensiveis', () => {
  it('redige parametros sensiveis de URL', () => {
    const url = redactUrl(
      'https://portal.gov.br/cb?code=abc&state=xyz&token=t&session=1&safe=ok&authorization_id=9',
    )
    expect(url).not.toContain('abc')
    expect(url).not.toContain('xyz')
    expect(url).toContain('safe=ok')
    expect(url).toContain('%5BREDACTED%5D')
  })

  it('redige credenciais embutidas na URL', () => {
    const url = redactUrl('https://user:pass@portal.gov.br/login')
    expect(url).not.toContain('user')
    expect(url).not.toContain('pass')
    expect(url).toContain('REDACTED')
  })

  it('nao vaza usuario embutido mesmo em URLs sem esquema', () => {
    const url = redactUrl('user:pass@sso.acesso.gov.br:443/callback')
    expect(url).not.toContain('user')
    expect(url).not.toContain('pass')
    expect(url).toBe('[invalid-url]')
  })

  it('aceita URL como objeto e normaliza URLs sem esquema (formato Electron)', () => {
    expect(redactUrl(new URL('https://a.test/p?key=1'))).toContain('REDACTED')
    // Hosts curtos de intranet são válidos e úteis para correlação em logs;
    // lixo real continua virando [invalid-url].
    expect(redactUrl('nao-e-url')).toBe('https://nao-e-url/')
    expect(redactUrl('://')).toBe('[invalid-url]')
    expect(redactUrl('https://a.test/p?chave=1')).toContain('chave=1')
  })

  it('redige PEM e blobs base64 longos', () => {
    expect(redactString('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toBe(
      '[REDACTED-PEM]',
    )
    expect(redactString('A'.repeat(5000))).toBe('[REDACTED-BLOB]')
    expect(redactString('texto comum')).toBe('texto comum')
    expect(redactString('A'.repeat(5000) + '!')).toHaveLength(5001)
  })

  it('redige chaves sensiveis em registros aninhados', () => {
    const record = redactRecord({
      userName: 'fiap',
      password: 'segredo',
      nested: {
        token: 'abc',
        cookie: 'sessao',
        public: 'visivel',
      },
      list: [{ secret: 'x' }, 'texto'],
      buffer: Buffer.from('abc'),
      when: new Date('2026-01-01T00:00:00.000Z'),
      count: 2,
      active: true,
      nothing: null,
      missing: undefined,
    })
    expect(record.password).toBe('[REDACTED]')
    expect(record.userName).toBe('fiap')
    expect((record.nested as Record<string, unknown>).token).toBe('[REDACTED]')
    expect((record.nested as Record<string, unknown>).cookie).toBe('[REDACTED]')
    expect((record.nested as Record<string, unknown>).public).toBe('visivel')
    expect(record.list).toEqual([{ secret: '[REDACTED]' }, 'texto'])
    expect(record.buffer).toBe('[Buffer 3 bytes]')
    expect(record.count).toBe(2)
    expect(record.active).toBe(true)
    expect(record.nothing).toBeNull()
    expect(record.when).toBe('2026-01-01T00:00:00.000Z')
  })

  it('trunca estruturas muito profundas', () => {
    let value: Record<string, unknown> = { folha: 'ok' }
    for (let index = 0; index < 8; index += 1) value = { child: value }
    const redacted = redactRecord(value)
    expect(JSON.stringify(redacted)).toContain('truncated')
  })

  it('normaliza erros para auditoria', () => {
    const error = new Error('falha password=segredo token=abc')
    const safe = safeErrorForAudit(error)
    expect(safe.name).toBe('Error')
    expect(safe.message).not.toContain('segredo')
    expect(safe.message).not.toContain('abc')
    expect(safe.message).toContain('[REDACTED]')
    expect(safeErrorForAudit('texto').name).toBe('Error')
    expect(safeErrorForAudit({}).message).toBe('[object Object]')
  })

  it('converte strings vazias em null', () => {
    expect(emptyToNull('  ')).toBeNull()
    expect(emptyToNull('')).toBeNull()
    expect(emptyToNull(undefined)).toBeNull()
    expect(emptyToNull(null)).toBeNull()
    expect(emptyToNull(' valor ')).toBe('valor')
  })
})
