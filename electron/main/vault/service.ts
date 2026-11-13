import {
  decryptEnvelope,
  decryptString,
  encryptEnvelope,
  passwordFingerprint,
  vaultAad,
  type EncryptedEnvelope,
} from './crypto'

export interface SealedPfx {
  pfxEnc: string
  passwordEnc: string
}

export class VaultService {
  constructor(private readonly masterKey: Buffer) {}

  sealCredentialPassword(credentialId: string, password: string): string {
    return encryptEnvelope(
      password,
      this.masterKey,
      vaultAad('credentials', credentialId, 'password_enc'),
    )
  }

  openCredentialPassword(credentialId: string, payload: string): string {
    return decryptString(
      payload,
      this.masterKey,
      vaultAad('credentials', credentialId, 'password_enc'),
    )
  }

  sealPfx(certificateId: string, pfx: Buffer, password: string): SealedPfx {
    return {
      pfxEnc: encryptEnvelope(
        pfx,
        this.masterKey,
        vaultAad('certificates', certificateId, 'pfx_enc'),
      ),
      passwordEnc: encryptEnvelope(
        password,
        this.masterKey,
        vaultAad('certificates', certificateId, 'pfx_password_enc'),
      ),
    }
  }

  openPfx(certificateId: string, pfxEnc: string): Buffer {
    return decryptEnvelope(
      pfxEnc,
      this.masterKey,
      vaultAad('certificates', certificateId, 'pfx_enc'),
    )
  }

  openPfxPassword(certificateId: string, passwordEnc: string): string {
    return decryptString(
      passwordEnc,
      this.masterKey,
      vaultAad('certificates', certificateId, 'pfx_password_enc'),
    )
  }

  fingerprintPassword(password: string): string {
    return passwordFingerprint(password, this.masterKey)
  }

  /** Valor de campo adicional da credencial — cifrado por credencial e campo. */
  sealFieldValue(credentialId: string, fieldName: string, value: string): string {
    return encryptEnvelope(
      value,
      this.masterKey,
      vaultAad('credentials', credentialId, `field:${fieldName}`),
    )
  }

  openFieldValue(credentialId: string, fieldName: string, payload: string): string {
    return decryptString(
      payload,
      this.masterKey,
      vaultAad('credentials', credentialId, `field:${fieldName}`),
    )
  }

  sealBackup(plaintext: Buffer): string {
    return encryptEnvelope(plaintext, this.masterKey, 'backup:artifact:v1')
  }

  openBackup(payload: string): Buffer {
    return decryptEnvelope(payload, this.masterKey, 'backup:artifact:v1')
  }
}

export type { EncryptedEnvelope }
