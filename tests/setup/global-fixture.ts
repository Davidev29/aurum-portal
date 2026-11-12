/**
 * Garante a existência do PFX de teste consumido pelos testes de assinatura PDF
 * (tests/unit/pdf-*.test.ts, chaos-pdf.test.ts), que leem
 * `scripts/spike/.certs/spike-a1-test.pfx` (senha "SpikeSenha123!").
 *
 * O fixture nunca é commitado (está no .gitignore): ele é gerado sob demanda
 * aqui, espelhando `scripts/spike/generate-certs.ts` (CN "SPIKE TESTE:12345678909",
 * autoassinado, sem validade legal). Se o arquivo já existir — ex.: gerado
 * manualmente pelo desenvolvedor — ele é preservado.
 */
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import forge from 'node-forge'

const CERTS_DIR = path.resolve(process.cwd(), 'scripts', 'spike', '.certs')
const PFX_PATH = path.join(CERTS_DIR, 'spike-a1-test.pfx')
const PFX_PASSWORD = 'SpikeSenha123!'
const COMMON_NAME = 'SPIKE TESTE:12345678909'

function randomSerial(): string {
  // Prefixo "01" evita seriais negativos no DER.
  return `01${randomBytes(8).toString('hex')}`
}

export default function globalSetup(): void {
  if (existsSync(PFX_PATH)) return

  console.log('[vitest global-setup] Gerando fixture spike-a1-test.pfx...')

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = randomSerial()
  certificate.validity.notBefore = new Date(Date.now() - 5 * 60_000)
  certificate.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60_000)

  const subject = [
    { name: 'commonName', value: COMMON_NAME },
    { name: 'organizationName', value: 'AurumBit Portal - Teste Local' },
    { name: 'organizationalUnitName', value: 'Spike A1' },
    { name: 'localityName', value: 'Fortaleza' },
    { name: 'stateOrProvinceName', value: 'Ceara' },
    { name: 'countryName', value: 'BR' },
  ]

  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      critical: true,
    },
    { name: 'extKeyUsage', clientAuth: true, emailProtection: true },
    { name: 'subjectAltName', altNames: [{ type: 1, value: 'spike@aurumbit.local' }] },
    { name: 'subjectKeyIdentifier' },
  ])
  certificate.sign(keys.privateKey, forge.md.sha256.create())

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], PFX_PASSWORD, {
    algorithm: '3des',
    friendlyName: 'AurumBit Portal Spike A1',
    generateLocalKeyId: true,
  })
  const pfx = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary')

  mkdirSync(CERTS_DIR, { recursive: true })
  writeFileSync(PFX_PATH, pfx, { mode: 0o600 })

  const sha256 = createHash('sha256')
    .update(
      Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(), 'binary'),
    )
    .digest('hex')
    .toUpperCase()
  console.log(`[vitest global-setup] Fixture gerada (SHA-256 ${sha256}).`)
}
