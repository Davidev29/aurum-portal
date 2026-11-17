import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { findDocumentInText, onlyDigits } from '../../../shared/validation'

export interface WindowsCertificateRecord {
  thumbprintSha1: string
  thumbprintSha256: string
  subject: string
  issuer: string
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  notBefore: string
  notAfter: string
  serialNumber: string
  hasPrivateKey: boolean
}

export interface PowerShellResult {
  stdout: string
  stderr: string
  exitCode: number | null
}

const PREAMBLE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
`

export function buildListScript(): string {
  return `${PREAMBLE}
$items = @()
Get-ChildItem -Path 'Cert:\\CurrentUser\\My' -ErrorAction Stop | Where-Object { $_.HasPrivateKey } | ForEach-Object {
  try {
    $sha256 = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($_.RawData)).Replace('-', '')
    $items += [pscustomobject]@{
      thumbprintSha1 = $_.Thumbprint
      thumbprintSha256 = $sha256
      subject = $_.Subject
      issuer = $_.Issuer
      notBefore = $_.NotBefore.ToUniversalTime().ToString('o')
      notAfter = $_.NotAfter.ToUniversalTime().ToString('o')
      serialNumber = $_.SerialNumber
      hasPrivateKey = [bool]$_.HasPrivateKey
    }
  } catch {
    # Um certificado corrompido nao deve impedir a listagem dos demais.
  }
}
[pscustomobject]@{ ok = $true; certificates = $items } | ConvertTo-Json -Depth 5 -Compress
`
}

export function buildInstallScript(): string {
  // Caminho e senha chegam por VARIÁVEIS DE AMBIENTE efêmeras do processo
  // (nunca por arquivo em %TEMP% nem pelo corpo do script).
  return `${PREAMBLE}
$pfxPath = $env:PV_PFX_PATH
$pfxPassword = $env:PV_PFX_PASSWORD
if (-not $pfxPath -or -not $pfxPassword) {
  @{ ok = $false; thumbprint = $null; subject = $null; error = 'caminho ou senha do PFX ausentes' } | ConvertTo-Json -Compress
  exit 1
}
$result = $null
try {
  $secure = ConvertTo-SecureString -String $pfxPassword -AsPlainText -Force
  $imported = Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation 'Cert:\\CurrentUser\\My' -Password $secure -ErrorAction Stop
  $result = [pscustomobject]@{
    ok = $true
    thumbprint = $imported.Thumbprint
    subject = $imported.Subject
    error = $null
  }
} catch {
  $result = [pscustomobject]@{
    ok = $false
    thumbprint = $null
    subject = $null
    error = $_.Exception.Message
  }
} finally {
  $pfxPassword = $null
  $secure = $null
  $env:PV_PFX_PASSWORD = $null
  Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue
}
$result | ConvertTo-Json -Compress
`
}

export function buildExportScript(thumbprintSha1: string): string {
  const normalized = normalizeSha1(thumbprintSha1)
  return `${PREAMBLE}
$pfxPath = $env:PV_PFX_PATH
$pfxPassword = $env:PV_PFX_PASSWORD
if (-not $pfxPath -or -not $pfxPassword) {
  @{ ok = $false; error = 'caminho ou senha do PFX ausentes' } | ConvertTo-Json -Compress
  exit 1
}
$result = $null
try {
  $cert = Get-Item -LiteralPath 'Cert:\\CurrentUser\\My\\${normalized}' -ErrorAction Stop
  if (-not $cert.HasPrivateKey) { throw 'O certificado nao possui chave privada no repositorio do Windows.' }
  $secure = ConvertTo-SecureString -String $pfxPassword -AsPlainText -Force
  Export-PfxCertificate -Cert $cert -Password $secure -FilePath $pfxPath -Force -ErrorAction Stop | Out-Null
  $result = [pscustomobject]@{ ok = $true; error = $null }
} catch {
  $result = [pscustomobject]@{ ok = $false; error = $_.Exception.Message }
} finally {
  $pfxPassword = $null
  $secure = $null
  $env:PV_PFX_PASSWORD = $null
}
$result | ConvertTo-Json -Compress
`
}

export function buildRemoveScript(thumbprintSha1: string): string {
  const thumbprint = normalizeSha1(thumbprintSha1)
  return `${PREAMBLE}
$result = $null
try {
  $path = 'Cert:\\CurrentUser\\My\\${thumbprint}'
  $cert = Get-Item -LiteralPath $path -ErrorAction Stop
  Remove-Item -LiteralPath $path -Force -ErrorAction Stop
  $result = [pscustomobject]@{ ok = $true; error = $null }
} catch {
  $result = [pscustomobject]@{ ok = $false; error = $_.Exception.Message }
}
$result | ConvertTo-Json -Compress
`
}

export function normalizeSha1(value: string): string {
  const normalized = value.replace(/[^a-fA-F0-9]/g, '').toUpperCase()
  if (normalized.length !== 40) throw new Error('Thumbprint SHA-1 invalido')
  return normalized
}

export function parseWindowsCertificateRecords(payload: unknown): WindowsCertificateRecord[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as { ok?: boolean; certificates?: unknown }
  if (!record.ok || !Array.isArray(record.certificates)) return []
  return record.certificates
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const subject = String(item.subject ?? '')
      const found = findDocumentInText(subject)
      const holderMatch = subject.match(/(?:^|,\s*)CN=([^,]+)/i)
      const holderName =
        holderMatch?.[1]?.replace(/:\s*\d[\d.\-/\s]{9,20}\d\s*$/, '').trim() ?? 'Titular'
      return {
        thumbprintSha1: String(item.thumbprintSha1 ?? '').toUpperCase(),
        thumbprintSha256: String(item.thumbprintSha256 ?? '').toUpperCase(),
        subject,
        issuer: String(item.issuer ?? ''),
        holderName,
        document: found?.document ?? null,
        documentType: found?.type ?? 'OTHER',
        notBefore: new Date(String(item.notBefore ?? '')).toISOString(),
        notAfter: new Date(String(item.notAfter ?? '')).toISOString(),
        serialNumber: String(item.serialNumber ?? ''),
        hasPrivateKey: item.hasPrivateKey === true,
      } satisfies WindowsCertificateRecord
    })
    .filter((item) => item.thumbprintSha1.length === 40)
}

export async function runPowerShell(
  script: string,
  timeoutMs = 60_000,
  env?: Record<string, string>,
): Promise<PowerShellResult> {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurumbit-portal-ps-'))
  const scriptPath = path.join(directory, 'script.ps1')
  await writeFile(scriptPath, script.endsWith('\n') ? script : `${script}\n`, 'utf8')

  // Sempre aguarda a remocao do diretorio antes de resolver/rejeitar: o
  // script pode conter material sensivel em base64 (ex.: senha do PFX em
  // buildInstallScript) e o rm fire-and-forget anterior vazava arquivos
  // quando o processo encerrava cedo demais ou o AV retinha o arquivo.
  const cleanup = async (): Promise<void> => {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env ? { ...process.env, ...env } : process.env,
      },
    )

    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void cleanup().finally(action)
    }

    const timer = setTimeout(() => {
      if (settled) return
      child.kill()
      finish(() => reject(new Error('Tempo esgotado ao executar o PowerShell')))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (stdout.length > 8_000_000) {
        child.kill()
        finish(() => reject(new Error('Saida do PowerShell excedeu o limite')))
      }
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk.slice(0, 20_000)
    })
    child.on('error', (error) => {
      finish(() =>
        reject(
          new Error(
            `Nao foi possivel executar o PowerShell: ${error.message}. Verifique se o Windows PowerShell esta disponivel.`,
          ),
        ),
      )
    })
    child.on('close', (exitCode) => {
      finish(() => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }))
    })
  })
}

export async function listWindowsCertificates(): Promise<WindowsCertificateRecord[]> {
  const result = await runPowerShell(buildListScript())
  if (result.exitCode !== 0) {
    throw new Error(
      `Falha ao listar certificados do Windows: ${result.stderr.slice(0, 300) || 'erro desconhecido'}`,
    )
  }
  if (!result.stdout) {
    // Alguns ambientes retornam saida vazia quando nao ha certificados.
    return []
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown
    return parseWindowsCertificateRecords(parsed)
  } catch {
    throw new Error('Resposta invalida do Windows ao listar certificados')
  }
}

export async function installPfxInWindowsStore(
  pfx: Buffer,
  password: string,
): Promise<{ ok: boolean; thumbprint: string | null; error: string | null }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurumbit-portal-pfx-'))
  const filePath = path.join(directory, `${randomUUID()}.pfx`)
  try {
    await writeFile(filePath, pfx, { mode: 0o600 })
    const script = buildInstallScript()
    const result = await runPowerShell(script, 60_000, {
      PV_PFX_PATH: filePath,
      PV_PFX_PASSWORD: password,
    })
    if (result.exitCode !== 0) {
      return {
        ok: false,
        thumbprint: null,
        error: `Falha no PowerShell: ${result.stderr.slice(0, 300) || 'erro desconhecido'}`,
      }
    }
    const parsed = JSON.parse(result.stdout) as {
      ok?: boolean
      thumbprint?: string | null
      error?: string | null
    }
    return {
      ok: parsed.ok === true,
      thumbprint: parsed.thumbprint ? String(parsed.thumbprint).toUpperCase() : null,
      error: parsed.error ? String(parsed.error).slice(0, 500) : null,
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function removePfxFromWindowsStore(
  thumbprintSha1: string,
): Promise<{ ok: boolean; error: string | null }> {
  const script = buildRemoveScript(thumbprintSha1)
  const result = await runPowerShell(script)
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: `Falha no PowerShell: ${result.stderr.slice(0, 300) || 'erro desconhecido'}`,
    }
  }
  const parsed = JSON.parse(result.stdout) as { ok?: boolean; error?: string | null }
  return {
    ok: parsed.ok === true,
    error: parsed.error ? String(parsed.error).slice(0, 500) : null,
  }
}

/**
 * Exporta a chave privada de um certificado instalado em
 * Cert:\CurrentUser\My para uso TRANSITÓRIO de assinatura (Adoble/SERPRO-like:
 * assinar com dados já instalados, sem pedir arquivo/senha).
 * A senha temporária é gerada aqui e nunca exibida; o arquivo é apagado
 * imediatamente após a leitura. Se a chave for não-exportável, lança erro
 * claro em PT-BR (fail-closed, sem pedir o PFX de novo).
 */
export async function exportPfxFromWindowsStore(
  thumbprintSha1: string,
): Promise<{ pfx: Buffer; password: string }> {
  const normalized = normalizeSha1(thumbprintSha1)
  const directory = await mkdtemp(path.join(tmpdir(), 'aurumbit-portal-export-'))
  const filePath = path.join(directory, `${randomUUID()}.pfx`)
  // Senha temporária forte, apenas para o transporte do PFX exportado.
  const password = randomBytes(32).toString('base64')
  try {
    const script = buildExportScript(normalized)
    const result = await runPowerShell(script, 60_000, {
      PV_PFX_PATH: filePath,
      PV_PFX_PASSWORD: password,
    })
    if (result.exitCode !== 0) {
      throw new Error(
        `Falha ao exportar a chave privada do Windows: ${result.stderr.slice(0, 300) || 'erro desconhecido'}`,
      )
    }
    let parsed: { ok?: boolean; error?: string | null }
    try {
      parsed = JSON.parse(result.stdout) as { ok?: boolean; error?: string | null }
    } catch {
      throw new Error('Resposta invalida do Windows ao exportar a chave privada')
    }
    if (parsed.ok !== true) {
      const detail = parsed.error ?? 'erro desconhecido'
      if (/não possui chave privada|nao possui chave privada|HasPrivateKey/i.test(detail)) {
        throw new Error(
          'O certificado instalado no Windows nao possui chave privada utilizavel para assinar.',
        )
      }
      if (/nao (pode ser )?exportad|não (pode ser )?exportad|export/i.test(detail)) {
        throw new Error(
          'A chave privada nao pode ser exportada do Windows e nao foi incluida no cofre — instale novamente como exportavel ou importe o PFX para assinar.',
        )
      }
      throw new Error(
        `Nao foi possivel usar o certificado instalado no Windows: ${detail.slice(0, 300)}`,
      )
    }
    const pfx = await readFile(filePath)
    if (!pfx.length) {
      throw new Error('A exportacao da chave privada do Windows resultou vazia.')
    }
    return { pfx, password }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export function extractDocumentFromSubject(subject: string): string | null {
  const direct = onlyDigits(subject)
  if (direct.length === 11 || direct.length === 14) return direct
  return findDocumentInText(subject)?.document ?? null
}
