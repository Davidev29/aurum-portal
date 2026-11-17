import { describe, expect, it } from 'vitest'
import {
  assertMasterKey,
  constantTimeEqualHex,
  decryptEnvelope,
  decryptString,
  deriveKey,
  encryptEnvelope,
  generateMasterKey,
  MASTER_KEY_BYTES,
  passwordFingerprint,
  vaultAad,
  wipeBuffer,
} from '../../electron/main/vault/crypto'
import { VaultService } from '../../electron/main/vault/service'
import { encryptBackup, decryptBackup } from '../../electron/main/vault/backup'

describe('criptografia do cofre', () => {
  const key = Buffer.alloc(32, 7)

  it('gera chave de 32 bytes e rejeita tamanhos invalidos', () => {
    expect(generateMasterKey()).toHaveLength(MASTER_KEY_BYTES)
    expect(() => assertMasterKey(Buffer.alloc(31))).toThrow()
    expect(() => assertMasterKey(Buffer.alloc(33))).toThrow()
    expect(() => deriveKey(Buffer.alloc(5), 'x')).toThrow()
  })

  it('deriva chaves deterministicas por proposito', () => {
    const a = deriveKey(key, 'purpose-a')
    const b = deriveKey(key, 'purpose-a')
    const c = deriveKey(key, 'purpose-b')
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a).toHaveLength(32)
  })

  it('cifra e decifra texto e buffer com AAD', () => {
    const secret = 'senha-super-secreta'
    const sealed = encryptEnvelope(secret, key, 'aad:1')
    expect(sealed.startsWith('pv1:')).toBe(true)
    expect(sealed).not.toContain(secret)
    expect(decryptString(sealed, key, 'aad:1')).toBe(secret)

    const buffer = Buffer.from([0, 1, 2, 255])
    const sealedBuffer = encryptEnvelope(buffer, key, 'aad:2')
    expect(decryptEnvelope(sealedBuffer, key, 'aad:2')).toEqual(buffer)
  })

  it('usa IV aleatorio em cada cifragem', () => {
    const first = encryptEnvelope('mesmo valor', key, 'aad')
    const second = encryptEnvelope('mesmo valor', key, 'aad')
    expect(first).not.toBe(second)
  })

  it('rejeita AAD vazio, chave errada, AAD errado e payload corrompido', () => {
    expect(() => encryptEnvelope('x', key, '')).toThrow(/AAD/)
    const sealed = encryptEnvelope('x', key, 'aad')
    expect(() => decryptString(sealed, Buffer.alloc(32, 9), 'aad')).toThrow(/Falha/)
    expect(() => decryptString(sealed, key, 'outro')).toThrow(/Falha/)
    expect(() => decryptEnvelope('lixo', key, 'aad')).toThrow(/Formato/)
    expect(() => decryptEnvelope('pv1:###', key, 'aad')).toThrow(/corrompido/)
  })

  it('valida versao e parametros do envelope', () => {
    const sealed = encryptEnvelope('x', key, 'aad')
    const envelope = JSON.parse(Buffer.from(sealed.slice(4), 'base64').toString('utf8')) as Record<
      string,
      unknown
    >
    const make = (patch: Record<string, unknown>) =>
      `pv1:${Buffer.from(JSON.stringify({ ...envelope, ...patch })).toString('base64')}`
    expect(() => decryptEnvelope(make({ v: 2 }), key, 'aad')).toThrow(/Versao/)
    expect(() => decryptEnvelope(make({ alg: 'outro' }), key, 'aad')).toThrow(/Versao/)
    expect(() => decryptEnvelope(make({ iv: 'AAAA' }), key, 'aad')).toThrow(/Parametros/)
    expect(() => decryptEnvelope(make({ tag: 'AAAA' }), key, 'aad')).toThrow(/Parametros/)
    const iv = envelope.iv as string
    const tag = envelope.tag as string
    const ct = envelope.ct as string
    expect(decryptString(make({ iv, tag, ct }), key, 'aad')).toBe('x')
  })

  it('monta AAD completo e rejeita campos vazios', () => {
    expect(vaultAad('credentials', 'id-1', 'password_enc')).toBe('credentials:id-1:password_enc')
    expect(() => vaultAad('', 'id', 'field')).toThrow()
    expect(() => vaultAad('t', '', 'field')).toThrow()
    expect(() => vaultAad('t', 'id', '')).toThrow()
  })

  it('gera fingerprint estavel e compara em tempo constante', () => {
    const a = passwordFingerprint('senha', key)
    const b = passwordFingerprint('senha', key)
    const c = passwordFingerprint('outra', key)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(constantTimeEqualHex(a, b)).toBe(true)
    expect(constantTimeEqualHex(a, c)).toBe(false)
    expect(constantTimeEqualHex(a, 'zz')).toBe(false)
    expect(constantTimeEqualHex('ab', 'abcd')).toBe(false)
  })

  it('zera buffers sensiveis', () => {
    const buffer = Buffer.from('segredo')
    wipeBuffer(buffer)
    expect(buffer.every((byte) => byte === 0)).toBe(true)
  })
})

describe('VaultService', () => {
  const vault = new VaultService(Buffer.alloc(32, 3))

  it('sela e abre senha de credencial', () => {
    const sealed = vault.sealCredentialPassword('cred-1', 'minha-senha')
    expect(vault.openCredentialPassword('cred-1', sealed)).toBe('minha-senha')
    expect(() => vault.openCredentialPassword('cred-2', sealed)).toThrow()
  })

  it('sela PFX e senha com AAD por certificado', () => {
    const pfx = Buffer.from('conteudo-pfx')
    const sealed = vault.sealPfx('cert-1', pfx, 'senha-pfx')
    expect(vault.openPfx('cert-1', sealed.pfxEnc)).toEqual(pfx)
    expect(vault.openPfxPassword('cert-1', sealed.passwordEnc)).toBe('senha-pfx')
    expect(() => vault.openPfx('cert-2', sealed.pfxEnc)).toThrow()
  })

  it('sela backup interno', () => {
    const sealed = vault.sealBackup(Buffer.from('backup'))
    expect(vault.openBackup(sealed)).toEqual(Buffer.from('backup'))
  })

  it('calcula fingerprint pelo segredo do cofre', () => {
    const other = new VaultService(Buffer.alloc(32, 4))
    expect(vault.fingerprintPassword('x')).not.toBe(other.fingerprintPassword('x'))
  })
})

describe('backup criptografado do certificado', () => {
  const passphrase = 'frase-senha-segura-123'
  const payload = Buffer.from('conteudo binario do certificado')

  it('cifra e decifra com Argon2id', async () => {
    const serialized = await encryptBackup(payload, passphrase)
    expect(serialized).toContain('argon2id-aes-256-gcm')
    expect(serialized).not.toContain('conteudo binario')
    expect(await decryptBackup(serialized, passphrase)).toEqual(payload)
  }, 30_000)

  it('exige frase com pelo menos 12 caracteres', async () => {
    await expect(encryptBackup(payload, 'curta')).rejects.toThrow(/12 caracteres/)
  })

  it('rejeita frase errada e conteudo adulterado', async () => {
    const serialized = await encryptBackup(payload, passphrase)
    await expect(decryptBackup(serialized, 'outra-frase-segura-123')).rejects.toThrow(/Falha/)
    const envelope = JSON.parse(serialized) as { ct: string }
    envelope.ct = Buffer.from('adulterado').toString('base64')
    await expect(decryptBackup(JSON.stringify(envelope), passphrase)).rejects.toThrow(/Falha/)
  }, 30_000)

  it('rejeita versao, algoritmo e parametros de KDF diferentes', async () => {
    const serialized = await encryptBackup(payload, passphrase)
    const base = JSON.parse(serialized) as Record<string, unknown>
    await expect(decryptBackup(JSON.stringify({ ...base, v: 2 }), passphrase)).rejects.toThrow(
      /Formato/,
    )
    await expect(
      decryptBackup(JSON.stringify({ ...base, alg: 'aes' }), passphrase),
    ).rejects.toThrow(/Formato/)
    await expect(
      decryptBackup(
        JSON.stringify({
          ...base,
          kdf: { ...(base.kdf as object), iterations: 1 },
        }),
        passphrase,
      ),
    ).rejects.toThrow(/KDF/)
  })

  it('rejeita JSON invalido', async () => {
    await expect(decryptBackup('{invalido', passphrase)).rejects.toThrow()
  })
})
