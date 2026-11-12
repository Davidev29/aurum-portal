import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const state = vi.hoisted(() => ({
  available: true,
  throwsOnAvailability: false,
}))

vi.mock('electron', () => ({
  app: { getPath: () => 'unused' },
  safeStorage: {
    isEncryptionAvailable: () => {
      if (state.throwsOnAvailability) throw new Error('sem DPAPI')
      return state.available
    },
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8')
      if (!text.startsWith('enc:')) throw new Error('conteudo invalido')
      return text.slice(4)
    },
  },
}))

import { SafeStorageKeyStore } from '../../electron/main/vault/key-store'
import { MASTER_KEY_BYTES } from '../../electron/main/vault/crypto'

describe('SafeStorageKeyStore', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'aurumbit-portal-keystore-'))
    state.available = true
    state.throwsOnAvailability = false
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('reporta disponibilidade e trata excecao do safeStorage', () => {
    expect(new SafeStorageKeyStore(directory).isAvailable()).toBe(true)
    state.available = false
    expect(new SafeStorageKeyStore(directory).isAvailable()).toBe(false)
    state.throwsOnAvailability = true
    expect(new SafeStorageKeyStore(directory).isAvailable()).toBe(false)
  })

  it('recusa abrir o cofre sem DPAPI', () => {
    state.available = false
    expect(() => new SafeStorageKeyStore(directory).loadOrCreate()).toThrow(/indisponivel/i)
    expect(existsSync(path.join(directory, 'vault.key'))).toBe(false)
  })

  it('cria chave de 32 bytes cifrada pelo safeStorage', () => {
    const store = new SafeStorageKeyStore(directory)
    const key = store.loadOrCreate()
    expect(key).toHaveLength(MASTER_KEY_BYTES)
    const file = path.join(directory, 'vault.key')
    expect(existsSync(file)).toBe(true)
    const encoded = readFileSync(file, 'utf8')
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      `enc:${key.toString('base64')}`,
    )
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('reaproveita a chave em cache e em novas instancias', () => {
    const first = new SafeStorageKeyStore(directory)
    const key = first.loadOrCreate()
    rmSync(path.join(directory, 'vault.key'))
    expect(first.loadOrCreate()).toEqual(key)
    writeFileSync(
      path.join(directory, 'vault.key'),
      Buffer.from(`enc:${key.toString('base64')}`).toString('base64'),
    )
    expect(new SafeStorageKeyStore(directory).loadOrCreate()).toEqual(key)
  })

  it('gera chaves diferentes em diretorios diferentes', () => {
    const other = mkdtempSync(path.join(os.tmpdir(), 'aurumbit-portal-keystore-b-'))
    try {
      const a = new SafeStorageKeyStore(directory).loadOrCreate()
      const b = new SafeStorageKeyStore(other).loadOrCreate()
      expect(a).not.toEqual(b)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  it('rejeita arquivo corrompido ou com tamanho invalido', () => {
    writeFileSync(path.join(directory, 'vault.key'), 'lixo')
    expect(() => new SafeStorageKeyStore(directory).loadOrCreate()).toThrow(
      /nao pode ser descriptografada/i,
    )

    writeFileSync(path.join(directory, 'vault.key'), '')
    expect(() => new SafeStorageKeyStore(directory).loadOrCreate()).toThrow(
      /nao pode ser descriptografada/i,
    )

    const shortKey = Buffer.from('curta').toString('base64')
    writeFileSync(
      path.join(directory, 'vault.key'),
      Buffer.from(`enc:${shortKey}`).toString('base64'),
    )
    expect(() => new SafeStorageKeyStore(directory).loadOrCreate()).toThrow(
      /nao pode ser descriptografada/i,
    )
  })

  it('limpa o cache e zera a copia em memoria', () => {
    const store = new SafeStorageKeyStore(directory)
    const key = store.loadOrCreate()
    const copy = Buffer.from(key)
    store.clearCache()
    expect(key.every((byte) => byte === 0)).toBe(true)
    const reloaded = store.loadOrCreate()
    expect(reloaded).toEqual(copy)
    expect(reloaded).not.toBe(key)
  })
})
