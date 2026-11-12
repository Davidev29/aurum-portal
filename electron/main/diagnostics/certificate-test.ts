import { BrowserWindow, WebContentsView, session as electronSession } from 'electron'
import { createServer as createHttpsServer, type Server } from 'node:https'
import type { TLSSocket } from 'node:tls'
import { randomBytes, randomUUID } from 'node:crypto'
import forge from 'node-forge'
import type { Certificate, CertificateTestResult } from '../../../shared/types'
import { normalizeThumbprint } from '../certificates/core'
import { getCertificateView } from '../db/repositories/certificates'
import type { AppDatabase } from '../db/database'
import type { SessionContextRegistry } from '../sessions/context-registry'

interface LocalTlsMaterial {
  key: string
  cert: string
}

let tlsMaterialPromise: Promise<LocalTlsMaterial> | null = null

function createLocalTlsMaterial(): Promise<LocalTlsMaterial> {
  if (tlsMaterialPromise) return tlsMaterialPromise
  tlsMaterialPromise = new Promise((resolve, reject) => {
    try {
      const keys = forge.pki.rsa.generateKeyPair(2048)
      const certificate = forge.pki.createCertificate()
      certificate.publicKey = keys.publicKey
      certificate.serialNumber = `01${randomBytes(8).toString('hex')}`
      certificate.validity.notBefore = new Date(Date.now() - 60_000)
      certificate.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000)
      const attributes = [
        { name: 'commonName', value: '127.0.0.1' },
        { name: 'organizationName', value: 'AurumBit Portal Diagnostics' },
      ]
      certificate.setSubject(attributes)
      certificate.setIssuer(attributes)
      certificate.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [{ type: 7, ip: '127.0.0.1' }],
        },
      ])
      certificate.sign(keys.privateKey, forge.md.sha256.create())
      resolve({
        key: forge.pki.privateKeyToPem(keys.privateKey),
        cert: forge.pki.certificateToPem(certificate),
      })
    } catch (error) {
      tlsMaterialPromise = null
      reject(error)
    }
  })
  return tlsMaterialPromise
}

export interface CertificateTesterDeps {
  db: AppDatabase
  registry: SessionContextRegistry
}

export interface CertificateTester {
  test(certificateId: string): Promise<CertificateTestResult>
}

/**
 * Diagnostico real: sobe um servidor HTTPS local que exige certificado de cliente,
 * abre uma view oculta com uma particao descartavel, registra o contexto do
 * certificado e verifica qual certificado o Chromium apresentou no handshake.
 */
export function createCertificateTester(deps: CertificateTesterDeps): CertificateTester {
  return {
    async test(certificateId: string): Promise<CertificateTestResult> {
      const certificate = getCertificateView(deps.db, certificateId)
      const testedAt = new Date().toISOString()
      if (!certificate.installed) {
        return {
          ok: false,
          presentedThumbprintSha256: null,
          expectedThumbprintSha256: certificate.thumbprintSha256,
          message:
            'O certificado nao esta instalado no Windows. Instale-o antes de executar o teste de injecao.',
          testedAt,
        }
      }

      let material: LocalTlsMaterial
      try {
        material = await createLocalTlsMaterial()
      } catch {
        return {
          ok: false,
          presentedThumbprintSha256: null,
          expectedThumbprintSha256: certificate.thumbprintSha256,
          message: 'Nao foi possivel preparar o servidor TLS local de diagnostico.',
          testedAt,
        }
      }

      let server: Server | null = null
      let win: BrowserWindow | null = null
      let view: WebContentsView | null = null
      const capture: { resolve: ((value: string | null) => void) | null } = { resolve: null }
      const captured = new Promise<string | null>((resolve) => {
        capture.resolve = resolve
      })

      try {
        server = createHttpsServer(
          {
            key: material.key,
            cert: material.cert,
            requestCert: true,
            rejectUnauthorized: false,
            minVersion: 'TLSv1.2',
          },
          (request, response) => {
            const peer = (request.socket as TLSSocket).getPeerCertificate(true)
            const presented = peer?.fingerprint256 ? normalizeThumbprint(peer.fingerprint256) : null
            response.writeHead(200, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            response.end(JSON.stringify({ presentedThumbprintSha256: presented }))
            if (presented) {
              capture.resolve?.(presented)
            }
          },
        )
        await new Promise<void>((resolve, reject) => {
          server?.once('error', reject)
          server?.listen(0, '127.0.0.1', () => resolve())
        })
        const address = server.address()
        if (!address || typeof address === 'string') {
          throw new Error('Porta TLS local indisponivel')
        }

        const partition = `diag:${randomUUID()}`
        const diagnosticSession = electronSession.fromPartition(partition)
        diagnosticSession.setPermissionRequestHandler((_wc, _permission, callback) =>
          callback(false),
        )
        diagnosticSession.setPermissionCheckHandler(() => false)
        diagnosticSession.setCertificateVerifyProc((request, callback) => {
          // Aceita apenas o servidor efemero deste diagnostico em loopback.
          callback(request.hostname === '127.0.0.1' ? 0 : -3)
        })

        const context = contextForCertificate(certificate, partition)
        deps.registry.set(diagnosticSession, context)

        win = new BrowserWindow({
          show: false,
          width: 900,
          height: 640,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
          },
        })
        view = new WebContentsView({
          webPreferences: {
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
          },
        })
        win.contentView.addChildView(view)
        view.setBounds({ x: 0, y: 0, width: 900, height: 640 })

        await view.webContents.loadURL(`https://127.0.0.1:${address.port}/diagnostic`).catch(() => {
          // A navegacao pode falhar por politica de certificado; o handshake
          // continua sendo observado pelo handler HTTPS e pelo menu de
          // certificados. O retorno "sem certificado apresentado" ja cobre.
        })

        const presented = await Promise.race([
          captured,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
        ])
        deps.registry.delete(diagnosticSession)
        if (!presented) {
          return {
            ok: false,
            presentedThumbprintSha256: null,
            expectedThumbprintSha256: certificate.thumbprintSha256,
            message:
              'O servidor de diagnostico nao recebeu certificado de cliente. Verifique a instalacao, a cadeia e se o portal aceita este certificado.',
            testedAt,
          }
        }
        const ok = presented.toUpperCase() === certificate.thumbprintSha256.toUpperCase()
        return {
          ok,
          presentedThumbprintSha256: presented,
          expectedThumbprintSha256: certificate.thumbprintSha256,
          message: ok
            ? 'Certificado correto apresentado no handshake mTLS.'
            : 'O Windows apresentou um certificado diferente do esperado. Reinstale o certificado e repita o teste.',
          testedAt,
        }
      } catch (error) {
        return {
          ok: false,
          presentedThumbprintSha256: null,
          expectedThumbprintSha256: certificate.thumbprintSha256,
          message:
            error instanceof Error
              ? `Falha no diagnostico: ${error.message}`
              : 'Falha desconhecida no diagnostico de injecao.',
          testedAt,
        }
      } finally {
        capture.resolve?.(null)
        if (view && !view.webContents.isDestroyed()) {
          try {
            view.webContents.close()
          } catch {
            // ignore
          }
        }
        if (win && !win.isDestroyed()) win.destroy()
        if (server) {
          await new Promise<void>((resolve) => server?.close(() => resolve()))
        }
      }
    },
  }
}

function contextForCertificate(
  certificate: Certificate,
  partition: string,
): import('../sessions/context-registry').SessionContext {
  return {
    sessionId: `diagnostic-${randomUUID()}`,
    clientId: certificate.clients[0]?.id ?? 'diagnostic',
    clientName: certificate.clients[0]?.name ?? certificate.holderName,
    clientDocument: certificate.document ?? '',
    serviceId: 'diagnostic',
    serviceName: 'Diagnostico de injecao',
    serviceSlug: 'diagnostic',
    authMethod: 'certificate',
    certificateId: certificate.id,
    certificateLabel: certificate.label,
    certificateHolderName: certificate.holderName,
    certificateValidTo: certificate.validTo,
    certificateThumbprintSha256: certificate.thumbprintSha256,
    certificateThumbprintSha1: certificate.thumbprintSha1,
    certificateSerialHex: certificate.serialHex,
    certificateIssuerDn: certificate.issuerDn,
    certificateSubjectDn: certificate.subjectDn,
    allowedDomains: ['127.0.0.1'],
    partition,
  }
}
