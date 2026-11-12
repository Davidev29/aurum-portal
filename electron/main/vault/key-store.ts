import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { generateMasterKey, MASTER_KEY_BYTES } from './crypto'

const KEY_FILE = 'vault.key'

export class SafeStorageKeyStore {
  private cached: Buffer | null = null

  constructor(private readonly userDataPath = app.getPath('userData')) {}

  isAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  private get keyPath(): string {
    return path.join(this.userDataPath, KEY_FILE)
  }

  loadOrCreate(): Buffer {
    if (this.cached) return this.cached
    if (!this.isAvailable()) {
      throw new Error(
        'safeStorage/DPAPI indisponivel. O cofre nao pode ser aberto com seguranca neste ambiente.',
      )
    }
    mkdirSync(this.userDataPath, { recursive: true })
    if (existsSync(this.keyPath)) {
      try {
        const encryptedBase64 = readFileSync(this.keyPath, 'utf8').trim()
        if (!encryptedBase64) throw new Error('arquivo vazio')
        const decryptedBase64 = safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
        const key = Buffer.from(decryptedBase64, 'base64')
        if (key.length !== MASTER_KEY_BYTES) throw new Error('tamanho invalido')
        this.cached = key
        return key
      } catch {
        throw new Error(
          'A chave do cofre nao pode ser descriptografada pelo Windows. Restaure um backup ou gere uma nova instalacao.',
        )
      }
    }

    const key = generateMasterKey()
    const encrypted = safeStorage.encryptString(key.toString('base64'))
    const tempPath = `${this.keyPath}.tmp`
    writeFileSync(tempPath, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, this.keyPath)
    this.cached = key
    return key
  }

  clearCache(): void {
    this.cached?.fill(0)
    this.cached = null
  }
}
