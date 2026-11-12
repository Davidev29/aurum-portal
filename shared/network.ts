/**
 * Utilitários de rede compartilhados entre o processo principal e a
 * interface. Este módulo é a única fonte de verdade para:
 *
 * - normalização de hostnames (caixa, ponto final de FQDN, labels vazios);
 * - reconhecimento de hosts governamentais brasileiros (`.gov.br`);
 * - parsing seguro de URLs HTTP/HTTPS, inclusive no formato
 *   `host:porta` (sem esquema) que o Electron usa no evento
 *   `select-client-certificate`;
 * - casamento de allowlists com curinga de subdomínio (`*.exemplo.gov.br`).
 *
 * Nada aqui confia na entrada: toda função falha fechada.
 */

/** Sufixos reconhecidos como infraestrutura governamental brasileira. */
export const GOVERNMENT_HOST_SUFFIXES = ['.gov.br'] as const

/** Hosts governamentais exatos (sem subdomínio). */
export const GOVERNMENT_HOSTS_EXACT = ['gov.br'] as const

/**
 * Normaliza um hostname para comparação: minúsculas, sem espaços e sem o
 * ponto final de FQDN ("sso.acesso.gov.br." → "sso.acesso.gov.br").
 * Labels vazios são preservados para que o chamador possa rejeitá-los.
 */
export function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/\.+$/, '')
}

function hasValidLabels(host: string): boolean {
  if (!host) return false
  // Hostnames são ASCII após a conversão IDNA do parser; colchetes de IPv6
  // também são ASCII imprimível. Espaços e caracteres de controle → inválido.
  return host.split('.').every((label) => label.length > 0 && label.length <= 63 && /^[!-~]+$/.test(label))
}

/**
 * Indica se o host pertence à infraestrutura governamental brasileira.
 * Aceita `gov.br` e qualquer subdomínio (`sso.acesso.gov.br`,
 * `cav.receita.fazenda.gov.br` etc.). Tudo fora de `.gov.br` é recusado,
 * inclusive domínios parecidos (`govbr.com.br`, `gov.br.evil.com`) e hosts
 * com labels vazios (`.gov.br`, `a..gov.br`).
 */
export function isGovernmentHost(hostname: string): boolean {
  const host = normalizeHostname(hostname)
  if (!hasValidLabels(host)) return false
  if ((GOVERNMENT_HOSTS_EXACT as readonly string[]).includes(host)) return true
  return GOVERNMENT_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
}

/**
 * Faz o parse de uma URL HTTP/HTTPS tolerando o formato sem esquema que o
 * Electron entrega em `select-client-certificate` (`host:porta`,
 * `[::1]:443`, etc.)
 *
 * Regras:
 * - `null`/vazio/lixo → `null` (falha fechada);
 * - entrada sem `://` recebe `https://` automaticamente;
 * - entrada no formato `//host/caminho` vira `https://host/caminho`;
 * - esquemas diferentes de `http:`/`https:` são rejeitados
 *   (`file:`, `javascript:`, esquemas customizados que passariam no `new URL`);
 * - comparações de host devem usar normalizeHostname/hostnameOf;
 *   isGovernmentHost/isAllowedHost normalizam internamente.
 */
export function parseHttpUrl(raw: string | null | undefined): URL | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  const candidate = trimmed.includes('://')
    ? trimmed
    : trimmed.startsWith('//')
      ? `https:${trimmed}`
      : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') return null

  // Credenciais embutidas nunca sao legitimas em challenge de certificado
  // (ex.: "mailto:portal@gov.br" viraria user:mailto @ host gov.br se apenas
  // adicionassemos o esquema). Recusa fail-closed.
  if (parsed.username || parsed.password) return null

  const host = normalizeHostname(parsed.hostname)
  if (!hasValidLabels(host)) return null
  return parsed
}

/** Hostname normalizado de uma URL HTTP/HTTPS, ou `null` se inválida. */
export function hostnameOf(raw: string | null | undefined): string | null {
  const parsed = parseHttpUrl(raw)
  if (!parsed) return null
  return normalizeHostname(parsed.hostname)
}

/**
 * Verifica se `hostname` casa com o padrão de allowlist.
 * Padrões aceitos: `portal.exemplo.gov.br` (exato) e `*.exemplo.gov.br`
 * (o próprio domínio e qualquer subdomínio). Comparação é
 * case-insensitive e ignora ponto final.
 */
export function matchesDomainPattern(hostname: string, pattern: string): boolean {
  const host = normalizeHostname(hostname)
  const normalized = normalizeHostname(pattern)
  if (!hasValidLabels(host) || !normalized) return false

  if (normalized.startsWith('*.')) {
    const suffix = normalized.slice(2)
    if (!hasValidLabels(suffix)) return false
    return host === suffix || host.endsWith(`.${suffix}`)
  }

  if (normalized.includes('*')) return false
  return host === normalized
}

/** Verdadeiro se o hostname casa com qualquer padrão da allowlist. */
export function isAllowedHost(hostname: string, allowedDomains: string[]): boolean {
  if (!Array.isArray(allowedDomains)) return false
  return allowedDomains.some((pattern) => matchesDomainPattern(hostname, pattern))
}
