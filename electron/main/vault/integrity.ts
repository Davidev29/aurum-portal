import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/database'
import { certificates, credentials, settings } from '../db/schema'
import { VaultService } from './service'
import { logger } from '../logger'

const MARKER_KEY = 'vault.integrity'
const EXPECTED = 'aurumbit-vault-integrity-v1'

/** Erro fatal de integridade do cofre — chave-mestra não corresponde aos segredos. */
export class VaultIntegrityError extends Error {
  override readonly name = 'VaultIntegrityError'
}

/**
 * Garante que a chave-mestra atual consegue abrir os segredos já guardados.
 *
 * Sem isso, apagar/corromper/regenerar o `vault.key` transforava
 * silenciosamente TODOS os pfx_enc/password_enc em lixo criptográfico:
 * o aplicativo abria normalmente e falhava só no primeiro uso, com erro
 * incompreensível.
 *
 * - Marcador presente → verifica; falha → VaultIntegrityError (fail-closed).
 * - Marcador ausente + nenhum segredo selado → cofre novo: cria o marcador.
 * - Marcador ausente + há segredos (atualização): prova a chave atual contra
 *   um segredo existente; sucesso → cria o marcador; falha → VaultIntegrityError.
 */
export function verifyVaultIntegrity(db: AppDatabase, vault: VaultService): void {
  const marker = db.select().from(settings).where(eq(settings.key, MARKER_KEY)).get()
  if (marker) {
    try {
      const plaintext = vault.openVaultIntegrity(String(marker.value ?? ''))
      if (plaintext !== EXPECTED) {
        throw new Error('marcador inesperado')
      }
      return
    } catch (error) {
      logger.error('vault.integrity_failed', {
        reason: 'marker-mismatch',
        message: error instanceof Error ? error.message : String(error),
      })
      throw new VaultIntegrityError(
        'A chave do cofre não corresponde aos segredos armazenados. ' +
          'Restaure o arquivo vault.key do backup (ou a pasta do aplicativo integral) ' +
          'e abra novamente. Nunca force a criação de um cofre novo por cima do seu.',
      )
    }
  }

  // Sem marcador: decide entre cofre novo e atualização pelo conteúdo do banco.
  const sealedCertificate = db
    .select({ id: certificates.id, pfxPasswordEnc: certificates.pfxPasswordEnc })
    .from(certificates)
    .all()
    .find((row) => Boolean(row.pfxPasswordEnc))
  const sealedCredential = db
    .select({ id: credentials.id, passwordEnc: credentials.passwordEnc })
    .from(credentials)
    .all()
    .find((row) => Boolean(row.passwordEnc))

  if (sealedCertificate || sealedCredential) {
    try {
      if (sealedCertificate) {
        vault.openPfxPassword(sealedCertificate.id, sealedCertificate.pfxPasswordEnc as string)
      } else if (sealedCredential) {
        vault.openCredentialPassword(sealedCredential.id, sealedCredential.passwordEnc)
      }
    } catch (error) {
      logger.error('vault.integrity_failed', {
        reason: 'probe-failed',
        message: error instanceof Error ? error.message : String(error),
      })
      throw new VaultIntegrityError(
        'A chave do cofre não consegue abrir os segredos armazenados. ' +
          'Restaure o arquivo vault.key do backup (ou a pasta do aplicativo integral) ' +
          'e abra novamente. Nunca force a criação de um cofre novo por cima do seu.',
      )
    }
    logger.info('vault.integrity_marker_created', { mode: 'migrated' })
  } else {
    logger.info('vault.integrity_marker_created', { mode: 'fresh' })
  }

  db.insert(settings)
    .values({
      key: MARKER_KEY,
      value: vault.sealVaultIntegrity(),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run()
}
