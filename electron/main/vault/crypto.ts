import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const MASTER_KEY_BYTES = 32
export const IV_BYTES = 12
export const TAG_BYTES = 16

export interface EncryptedEnvelope {
  v: 1
  alg: 'aes-256-gcm'
  iv: string
  tag: string
  ct: string
}

const BLOB_PREFIX = 'pv1:'

export function generateMasterKey(): Buffer {
  return randomBytes(MASTER_KEY_BYTES)
}

export function assertMasterKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== MASTER_KEY_BYTES) {
    throw new Error('Chave-mestra invalida: esperado 32 bytes')
  }
}

export function deriveKey(masterKey: Buffer, purpose: string): Buffer {
  assertMasterKey(masterKey)
  const derived = hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from(purpose, 'utf8'), 32)
  return Buffer.from(derived)
}

export function encryptEnvelope(plaintext: string | Buffer, key: Buffer, aad: string): string {
  assertMasterKey(key)
  if (!aad) throw new Error('AAD obrigatorio para criptografia')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8')
  const ct = Buffer.concat([cipher.update(data), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope: EncryptedEnvelope = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  }
  return BLOB_PREFIX + Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')
}

export function decryptEnvelope(payload: string, key: Buffer, aad: string): Buffer {
  assertMasterKey(key)
  if (!payload.startsWith(BLOB_PREFIX)) throw new Error('Formato de blob criptografado invalido')
  let envelope: EncryptedEnvelope
  try {
    envelope = JSON.parse(
      Buffer.from(payload.slice(BLOB_PREFIX.length), 'base64').toString('utf8'),
    ) as EncryptedEnvelope
  } catch {
    throw new Error('Blob criptografado corrompido')
  }
  if (envelope.v !== 1 || envelope.alg !== 'aes-256-gcm') {
    throw new Error('Versao de criptografia nao suportada')
  }
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Parametros de criptografia invalidos')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()])
  } catch {
    throw new Error('Falha ao descriptografar: chave, AAD ou conteudo invalido')
  }
}

export function decryptString(payload: string, key: Buffer, aad: string): string {
  return decryptEnvelope(payload, key, aad).toString('utf8')
}

export function vaultAad(table: string, id: string, field: string): string {
  if (!table || !id || !field) throw new Error('AAD incompleto')
  return `${table}:${id}:${field}`
}

export function passwordFingerprint(password: string, masterKey: Buffer): string {
  const key = deriveKey(masterKey, 'password-reuse-fingerprint')
  return createHmac('sha256', key).update(password, 'utf8').digest('hex')
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function wipeBuffer(buffer: Buffer): void {
  buffer.fill(0)
}
