import { app, type Certificate, type WebContents } from 'electron'
import type { SessionContextRegistry } from './context-registry'
import { resolveCertificateSelection, type CertificateSelectionItem } from '../certificates/core'
import { hostnameOf } from '../../../shared/network'
import { redactUrl } from '../security/redaction'
import { logger } from '../logger'

export interface CertificateSelectionAudit {
  type: string
  entity: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

export interface CertificateSelectionDeps {
  registry: SessionContextRegistry
  audit: (event: CertificateSelectionAudit) => void
  onSelectionIssue: (sessionId: string, message: string) => void
}

function toSelectionItem(certificate: Certificate): CertificateSelectionItem {
  return {
    data: certificate.data,
    fingerprint: certificate.fingerprint,
    serialNumber: certificate.serialNumber,
    issuerName: certificate.issuerName,
    subjectName: certificate.subjectName,
  }
}

export function installCertificateSelectionHandler(deps: CertificateSelectionDeps): () => void {
  const handler = (
    event: Electron.Event,
    webContents: WebContents | null,
    url: string,
    certificateList: Certificate[],
    callback: (certificate?: Certificate) => void,
  ): void => {
    // NUNCA remover: sem preventDefault o Electron escolhe o primeiro certificado do store.
    event.preventDefault()

    if (!webContents) {
      deps.audit({
        type: 'certificate.cancelled',
        entity: 'certificate',
        metadata: { reason: 'no-webcontents', url: redactUrl(url) },
      })
      callback(undefined)
      return
    }

    const context = deps.registry.get(webContents.session)
    if (!context) {
      deps.audit({
        type: 'certificate.cancelled',
        entity: 'certificate',
        metadata: { reason: 'no-context', url: redactUrl(url) },
      })
      callback(undefined)
      return
    }

    if (!context.certificateThumbprintSha256) {
      deps.audit({
        type: 'certificate.cancelled',
        entity: 'certificate',
        entityId: context.certificateId,
        metadata: { reason: 'session-without-certificate', sessionId: context.sessionId },
      })
      callback(undefined)
      return
    }

    const offeredItems = certificateList.map(toSelectionItem)
    const decision = resolveCertificateSelection(
      {
        sessionId: context.sessionId,
        clientId: context.clientId,
        clientName: context.clientName,
        certificateThumbprint: context.certificateThumbprintSha256,
        certificateThumbprintSha1: context.certificateThumbprintSha1 ?? undefined,
        certificateSerialHex: context.certificateSerialHex ?? undefined,
        certificateIssuerName: context.certificateIssuerDn ?? undefined,
        certificateSubjectName: context.certificateSubjectDn ?? undefined,
        allowedDomains: context.allowedDomains,
        url,
      },
      url,
      offeredItems,
      context.certificateThumbprintSha1 ?? undefined,
    )

    if (decision.kind !== 'selected' || !decision.certificate) {
      deps.audit({
        type: 'certificate.not_offered',
        entity: 'certificate',
        entityId: context.certificateId,
        metadata: {
          sessionId: context.sessionId,
          clientId: context.clientId,
          reason: decision.kind,
          offered: decision.offeredCount,
          url: redactUrl(url),
        },
      })
      const host = hostnameOf(url) ?? 'dominio desconhecido'
      deps.onSelectionIssue(
        context.sessionId,
        decision.kind === 'host-not-allowed'
          ? `O portal tentou autenticar em ${host}, fora da allowlist. Adicione esse dominio ao servico ou abra o portal manualmente.`
          : `O portal (${host}) nao ofereceu o certificado desta sessao. Verifique a instalacao no Windows e a cadeia ICP-Brasil.`,
      )
      callback(undefined)
      return
    }

    const index = offeredItems.findIndex((certificate) => certificate === decision.certificate)
    const chosen = index >= 0 ? certificateList[index] : null
    if (!chosen) {
      callback(undefined)
      return
    }

    deps.audit({
      type: 'certificate.selected',
      entity: 'certificate',
      entityId: context.certificateId,
      metadata: {
        sessionId: context.sessionId,
        clientId: context.clientId,
        host: hostnameOf(url) ?? 'desconhecido',
        offered: certificateList.length,
      },
    })
    callback(chosen)
  }

  app.on('select-client-certificate', handler)

  app.setClientCertRequestPasswordHandler(async (params) => {
    logger.warn('certificate.password_requested', {
      hostname: params.hostname,
      tokenName: params.tokenName,
      retry: params.isRetry,
    })
    throw new Error('Certificados com PIN/A3 nao sao suportados no MVP. Use um certificado A1.')
  })

  return () => {
    app.off('select-client-certificate', handler)
  }
}
