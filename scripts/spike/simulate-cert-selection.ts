/**
 * Simulação do incidente "O portal tentou autenticar fora da allowlist".
 *
 * Replays the exact scenario from the production debug log: the Electron
 * `select-client-certificate` event fires with a URL in the
 * `host:porta` (no scheme) format while the gov.br SSO flow requests a
 * client certificate.
 *
 * Uso:
 *   npm run simulate:cert
 *
 * O script não toca em rede, nem no repositório de certificados do Windows,
 * nem em dados reais: usa o PFX de teste do spike e DER sintético.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  certificateDataToDer,
  computeThumbprints,
  resolveCertificateSelection,
  type CertificateSelectionContext,
} from '../../electron/main/certificates/core'
import { BUILTIN_SERVICES } from '../../shared/builtins'

const root = path.resolve(__dirname, '..', '..')
const pemPath = path.join(root, 'scripts', 'spike', '.certs', 'spike-a1-test-cert.pem')

// ---------------------------------------------------------------------------
// 1. Carrega o certificado de teste do spike (autoassinado, gerado localmente)
// ---------------------------------------------------------------------------
const der = certificateDataToDer(readFileSync(pemPath, 'utf8'))
const hashes = computeThumbprints(der)
console.log('Certificado de spike carregado.')
console.log(`  SHA-256: ${hashes.sha256}`)
console.log(`  SHA-1:   ${hashes.sha1}\n`)

const govbr = BUILTIN_SERVICES.find((service) => service.slug === 'govbr')
if (!govbr) {
  throw new Error('Servico builtin govbr nao encontrado')
}
const offered = [{ data: readFileSync(pemPath, 'utf8') }]

function contextFor(allowedDomains: string[]): CertificateSelectionContext {
  return {
    sessionId: 'simulacao-sessao',
    clientId: 'simulacao-cliente',
    clientName: 'Cliente de Simulação',
    certificateThumbprint: hashes.sha256,
    allowedDomains,
    url: 'https://sso.acesso.gov.br/login',
  }
}

// ---------------------------------------------------------------------------
// 2. URLs exatamente no formato entregue pelo Electron (sem esquema)
// ---------------------------------------------------------------------------
interface Scenario {
  label: string
  url: string
  allowlist: string[]
  expect: 'selected' | 'host-not-allowed'
}

const govbrAllowlist = govbr.allowedDomains
const ecacAllowlist = BUILTIN_SERVICES.find((s) => s.slug === 'ecac')?.allowedDomains ?? []

const scenarios: Scenario[] = [
  // --- O caso real do log de produção --------------------------------------
  { label: 'Caso real: certificado.sso.acesso.gov.br:443 (sem esquema)', url: 'certificado.sso.acesso.gov.br:443', allowlist: govbrAllowlist, expect: 'selected' },
  { label: 'Caso real: sso.acesso.gov.br:443 (sem esquema)', url: 'sso.acesso.gov.br:443', allowlist: govbrAllowlist, expect: 'selected' },
  { label: 'e-CAC: cav.receita.fazenda.gov.br:443 (sem esquema)', url: 'cav.receita.fazenda.gov.br:443', allowlist: ecacAllowlist, expect: 'selected' },

  // --- Variações de formato toleradas ---------------------------------------
  { label: 'FQDN com ponto final', url: 'certificado.sso.acesso.gov.br.:443', allowlist: govbrAllowlist, expect: 'selected' },
  { label: 'Maiúsculas no host', url: 'CERTIFICADO.SSO.ACESSO.GOV.BR:443', allowlist: govbrAllowlist, expect: 'selected' },
  { label: 'Caminho e query sem esquema', url: 'certificado.sso.acesso.gov.br:443/login?a=b', allowlist: govbrAllowlist, expect: 'selected' },
  { label: 'URL completa https', url: 'https://certificado.sso.acesso.gov.br/login', allowlist: govbrAllowlist, expect: 'selected' },
  { label: 'Scheme-relative //gov.br', url: '//sso.acesso.gov.br/login', allowlist: govbrAllowlist, expect: 'selected' },

  // --- Cert injection deve exigir HTTPS --------------------------------------
  { label: 'HTTP puro é recusado', url: 'http://sso.acesso.gov.br/', allowlist: govbrAllowlist, expect: 'host-not-allowed' },

  // --- Hospedeiros maliciosos / parecidos -----------------------------------
  { label: 'evil.com (fora da allowlist)', url: 'malicioso.example:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'gov.br.evil.com', url: 'gov.br.evil.com:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'sso.acesso.gov.br.evil.com', url: 'sso.acesso.gov.br.evil.com:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'gov.br como usuário, host evil.com', url: 'gov.br@evil.com:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'usuario:senha@evil.com', url: 'user:pass@evil.com:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'gov.br.attacker.tld', url: 'gov.br.attacker.tld:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'Labels vazios (.gov.br)', url: '.gov.br:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'Labels vazios (a..gov.br)', url: 'a..gov.br:443', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'Esquema file:', url: 'file:///C:/Windows/System32/drivers/etc/hosts', allowlist: govbrAllowlist, expect: 'host-not-allowed' },
  { label: 'Esquema desconhecido a:b', url: 'a:b', allowlist: govbrAllowlist, expect: 'host-not-allowed' },

  // --- Allowlist explícita fora de .gov.br ----------------------------------
  { label: 'Allowlist explícita: intranet aceita', url: 'intranet.empresa.com:443', allowlist: ['intranet.empresa.com'], expect: 'selected' },
  { label: 'Allowlist *.empresa.com cobre subdomínio', url: 'a.empresa.com:443', allowlist: ['*.empresa.com'], expect: 'selected' },
  { label: 'Allowlist ausente recusa host não-gov', url: 'intranet.empresa.com:443', allowlist: [], expect: 'host-not-allowed' },
]

// ---------------------------------------------------------------------------
// 3. Executa os cenários contra o código real
// ---------------------------------------------------------------------------
let failures = 0
for (const scenario of scenarios) {
  const decision = resolveCertificateSelection(
    contextFor(scenario.allowlist),
    scenario.url,
    offered,
  )
  const ok = decision.kind === scenario.expect
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${scenario.label}\n      url=${scenario.url}\n      → ${decision.kind} (${decision.reason})`,
  )
}

console.log('')
if (failures > 0) {
  console.error(`${failures} cenário(s) falharam.`)
  process.exit(1)
}
console.log(`Todos os ${scenarios.length} cenários passaram: a injeção de certificado`)
console.log('funciona para hosts gov.br (inclusive no formato sem esquema do Electron)')
console.log('e continua recusando qualquer outra origem.')
