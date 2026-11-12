import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { argon2id } from 'hash-wasm'

export interface EncryptedBackupFile {
  v: 1
  alg: 'argon2id-aes-256-gcm'
  kdf: {
    name: 'argon2id'
    salt: string
    iterations: number
    memoryKiB: number
    parallelism: number
  }
  iv: string
  tag: string
  ct: string
}

const SALT_BYTES = 16
const IV_BYTES = 12
const KDF_ITERATIONS = 3
const KDF_MEMORY_KIB = 64 * 1024
const KDF_PARALLELISM = 1

async function deriveBackupKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  const output = await argon2id({
    password: passphrase,
    salt,
    iterations: KDF_ITERATIONS,
    memorySize: KDF_MEMORY_KIB,
    parallelism: KDF_PARALLELISM,
    hashLength: 32,
    outputType: 'binary',
  })
  return Buffer.from(output)
}

export async function encryptBackup(payload: Buffer, passphrase: string): Promise<string> {
  if (passphrase.length < 12)
    throw new Error('A frase-senha do backup deve ter ao menos 12 caracteres')
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await deriveBackupKey(passphrase, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
    cipher.setAAD(Buffer.from('aurumbit-portal:backup:v1', 'utf8'))
    const ct = Buffer.concat([cipher.update(payload), cipher.final()])
    const envelope: EncryptedBackupFile = {
      v: 1,
      alg: 'argon2id-aes-256-gcm',
      kdf: {
        name: 'argon2id',
        salt: salt.toString('base64'),
        iterations: KDF_ITERATIONS,
        memoryKiB: KDF_MEMORY_KIB,
        parallelism: KDF_PARALLELISM,
      },
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    }
    return JSON.stringify(envelope, null, 2)
  } finally {
    key.fill(0)
  }
}

export async function decryptBackup(serialized: string, passphrase: string): Promise<Buffer> {
  const envelope = JSON.parse(serialized) as EncryptedBackupFile
  if (envelope.v !== 1 || envelope.alg !== 'argon2id-aes-256-gcm') {
    throw new Error('Formato de backup nao suportado')
  }
  if (
    envelope.kdf.iterations !== KDF_ITERATIONS ||
    envelope.kdf.memoryKiB !== KDF_MEMORY_KIB ||
    envelope.kdf.parallelism !== KDF_PARALLELISM
  ) {
    throw new Error('Parametros de KDF do backup nao suportados')
  }
  const salt = Buffer.from(envelope.kdf.salt, 'base64')
  const key = await deriveBackupKey(passphrase, salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'), {
      authTagLength: 16,
    })
    decipher.setAAD(Buffer.from('aurumbit-portal:backup:v1', 'utf8'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(envelope.ct, 'base64')), decipher.final()])
  } catch {
    throw new Error('Falha ao abrir backup: frase-senha incorreta ou arquivo corrompido')
  } finally {
    key.fill(0)
  }
}
