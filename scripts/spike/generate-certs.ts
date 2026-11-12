/*
 * Gera um PFX de teste "parecido com A1" para o spike local do AurumBit Portal.
 *
 * IMPORTANTE:
 * - Este script NAO instala nada no repositorio de certificados do Windows.
 * - O material gerado e de teste, autoassinado e NAO tem validade legal.
 * - A saida padrao (scripts/spike/.certs) esta no .gitignore.
 *
 * Uso:
 *   npm run spike:certs -- --password "TesteA1!2026"
 *   npm run spike:certs -- --password "TesteA1!2026" --out scripts/spike/.certs --force
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import forge from 'node-forge'
import { parsePfx } from '../../electron/main/certificates/parse'

const DEFAULT_PASSWORD = 'aurumbit-portal-spike'
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'scripts', 'spike', '.certs')
const DEFAULT_COMMON_NAME = 'SPIKE TESTE:12345678909'

interface CliOptions {
  password: string
  outDir: string
  force: boolean
  help: boolean
}

interface GeneratedAssets {
  pfxPath: string
  certPemPath: string
  metadataPath: string
}

function usage(): string {
  return [
    'AurumBit Portal - gerador de certificado A1 de teste',
    '',
    'Uso:',
    '  npm run spike:certs -- --password <senha> [opcoes]',
    '',
    'Opcoes:',
    '  -p, --password <senha>  Senha do PFX (obrigatoria para uso real; padrao de teste:',
    `                          "${DEFAULT_PASSWORD}")`,
    '  -o, --out <diretorio>   Diretorio de saida (padrao: scripts/spike/.certs)',
    '  -f, --force             Sobrescreve arquivos existentes',
    '  -h, --help              Exibe esta ajuda',
    '',
    'O script apenas grava arquivos locais. Ele nunca importa, remove ou altera',
    'certificados no repositorio do Windows.',
  ].join('\n')
}

function fail(message: string): never {
  console.error(`[erro] ${message}`)
  process.exitCode = 1
  throw new Error(message)
}

function takeValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) fail(`A opcao ${option} exige um valor.`)
  return value
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    password: DEFAULT_PASSWORD,
    outDir: DEFAULT_OUT_DIR,
    force: false,
    help: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue

    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--force' || arg === '-f') {
      options.force = true
      continue
    }
    if (arg === '--password' || arg === '-p') {
      options.password = takeValue(args, index, arg)
      index += 1
      continue
    }
    if (arg.startsWith('--password=')) {
      const value = arg.slice('--password='.length)
      if (!value) fail('A opcao --password exige um valor.')
      options.password = value
      continue
    }
    if (arg === '--out' || arg === '-o') {
      options.outDir = path.resolve(takeValue(args, index, arg))
      index += 1
      continue
    }
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length)
      if (!value) fail('A opcao --out exige um valor.')
      options.outDir = path.resolve(value)
      continue
    }
    if (arg.startsWith('-')) fail(`Opcao desconhecida: ${arg}`)
    fail(`Argumento posicional inesperado: ${arg}`)
  }

  return options
}

function randomSerial(): string {
  // Prefixo "01" evita seriais negativos e mantem o valor positivo no DER.
  return `01${randomBytes(8).toString('hex')}`
}

function buildSelfSignedCertificate(): {
  certificate: forge.pki.Certificate
  privateKey: forge.pki.rsa.PrivateKey
} {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = randomSerial()
  certificate.validity.notBefore = new Date(Date.now() - 5 * 60_000)
  certificate.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60_000)

  const subject = [
    { name: 'commonName', value: DEFAULT_COMMON_NAME },
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

  return { certificate, privateKey: keys.privateKey }
}

function assertWritable(targets: string[], force: boolean): void {
  if (force) return
  const existing = targets.filter((target) => existsSync(target))
  if (existing.length === 0) return
  fail(
    `Ja existe(m) ${existing.length} arquivo(s) de teste no destino. Use --force para sobrescrever:\n` +
      existing.map((file) => `  - ${file}`).join('\n'),
  )
}

function writeText(filePath: string, content: string, mode: number): void {
  writeFileSync(filePath, content, { encoding: 'utf8', mode })
}

function generate(options: CliOptions): GeneratedAssets {
  if (options.password.length < 8) {
    console.warn(
      '[aviso] A senha do PFX tem menos de 8 caracteres; use apenas em ambiente isolado.',
    )
  }

  const outDir = options.outDir
  mkdirSync(outDir, { recursive: true })

  const baseName = 'spike-a1-test'
  const pfxPath = path.join(outDir, `${baseName}.pfx`)
  const certPemPath = path.join(outDir, `${baseName}-cert.pem`)
  const metadataPath = path.join(outDir, `${baseName}-metadata.json`)
  assertWritable([pfxPath, certPemPath, metadataPath], options.force)

  console.log('[1/4] Gerando chave RSA 2048 e certificado autoassinado...')
  const { certificate, privateKey } = buildSelfSignedCertificate()

  const validTo = certificate.validity.notAfter.toISOString()
  const validFrom = certificate.validity.notBefore.toISOString()
  const subjectDn = certificate.subject.attributes
    .map(
      (attribute) =>
        `${(attribute.shortName ?? attribute.name ?? '?').toUpperCase()}=${attribute.value}`,
    )
    .join(', ')
  const issuerDn = certificate.issuer.attributes
    .map(
      (attribute) =>
        `${(attribute.shortName ?? attribute.name ?? '?').toUpperCase()}=${attribute.value}`,
    )
    .join(', ')

  console.log('[2/4] Empacotando PFX (PKCS#12, 3DES) com chave privada...')
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [certificate], options.password, {
    algorithm: '3des',
    friendlyName: 'AurumBit Portal Spike A1',
    generateLocalKeyId: true,
  })
  const pfx = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary')

  // Valida o artefato com o mesmo parser usado pelo aplicativo.
  console.log('[3/4] Validando o PFX com o parser do AurumBit Portal...')
  const parsed = parsePfx(pfx, options.password)
  const der = Buffer.from(
    forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes(),
    'binary',
  )
  const sha1 = createHash('sha1').update(der).digest('hex').toUpperCase()
  const sha256 = createHash('sha256').update(der).digest('hex').toUpperCase()

  if (parsed.thumbprintSha256 !== sha256) {
    fail('O thumbprint calculado nao confere com o parser do aplicativo.')
  }

  console.log('[4/4] Gravando arquivos de teste...')
  writeFileSync(pfxPath, pfx, { mode: 0o600 })
  writeText(certPemPath, forge.pki.certificateToPem(certificate), 0o644)
  writeText(
    metadataPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        warning:
          'Certificado autoassinado de teste. NAO use para autenticacao real. Nao representa a ICP-Brasil.',
        commonName: DEFAULT_COMMON_NAME,
        subjectDn,
        issuerDn,
        serialHex: parsed.serialHex,
        thumbprintSha1: sha1,
        thumbprintSha256: sha256,
        validFrom,
        validTo,
        password: '[NAO REGISTRADA]',
        files: {
          pfx: path.basename(pfxPath),
          certificatePem: path.basename(certPemPath),
        },
      },
      null,
      2,
    )}\n`,
    0o644,
  )

  console.log('')
  console.log('Artefatos gerados:')
  console.log(`  PFX : ${pfxPath}`)
  console.log(`  PEM : ${certPemPath}`)
  console.log(`  Meta: ${metadataPath}`)
  console.log('')
  console.log(`Titular : ${parsed.holderName}`)
  console.log(`Documento: ${parsed.document ?? '(nao detectado)'} (${parsed.documentType})`)
  console.log(`Valido ate: ${validTo}`)
  console.log(`SHA-1    : ${sha1}`)
  console.log(`SHA-256  : ${sha256}`)
  console.log('')
  console.log('Proximos passos (somente manuais e com confirmacao explicita):')
  console.log('  1. Rode "npm run spike -- --check-only" para o diagnostico do ambiente.')
  console.log('  2. Abra o AurumBit Portal > Certificados > Importar PFX para testar o fluxo.')
  console.log('  3. NUNCA importe este certificado em producao ou em maquina de terceiros.')
  console.log('  4. O script nao altera o repositorio de certificados do Windows.')

  return { pfxPath, certPemPath, metadataPath }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (options.password === DEFAULT_PASSWORD) {
    console.warn(
      `[aviso] Usando a senha padrao publica "${DEFAULT_PASSWORD}". ` +
        'Passe --password para um ambiente de teste mais realista.',
    )
  }
  generate(options)
}

try {
  main()
} catch (error) {
  if (process.exitCode !== 1) {
    console.error(error instanceof Error ? `[erro] ${error.message}` : String(error))
    process.exitCode = 1
  }
}
