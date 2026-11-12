import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import forge from 'node-forge'

export interface IcpChainInstallResult {
  ok: boolean
  installed: number
  errors: string[]
}

function runPowerShell(
  script: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Tempo esgotado'))
    }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (stdout += chunk))
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code })
    })
    child.stdin.write(script.endsWith('\n') ? script : `${script}\n`)
    child.stdin.end()
  })
}

export function extractAiaUrls(certificatePem: string): string[] {
  const urls: string[] = []
  try {
    const cert = forge.pki.certificateFromPem(certificatePem)
    const aia = cert.getExtension('authorityInformationAccess') as { value?: string } | undefined
    const value = aia?.value ?? ''
    const matches = value.match(/https?:\/\/[^\s,]+/gi) ?? []
    for (const match of matches) {
      if (!urls.includes(match)) urls.push(match)
    }
  } catch {
    // ignore
  }
  return urls
}

export async function installCertificateFromBuffer(buffer: Buffer): Promise<boolean> {
  const directory = await mkdtemp(path.join(tmpdir(), 'aurumbit-portal-icp-'))
  const filePath = path.join(directory, 'cert.cer')
  try {
    await writeFile(filePath, buffer)
    const script = `
$ErrorActionPreference = 'Stop'
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('CA', 'CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${filePath.replace(/\\/g, '\\\\')}')
$store.Add($cert)
$store.Close()
Write-Output 'OK'
`
    const result = await runPowerShell(script)
    return result.exitCode === 0 && result.stdout.includes('OK')
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function installIcpChainFromAia(
  certificatePem: string,
): Promise<IcpChainInstallResult> {
  const urls = extractAiaUrls(certificatePem)
  const errors: string[] = []
  let installed = 0
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'AurumBit Portal/0.1' } })
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`)
        continue
      }
      const arrayBuffer = await response.arrayBuffer()
      const ok = await installCertificateFromBuffer(Buffer.from(arrayBuffer))
      if (ok) installed += 1
      else errors.push(`${url}: falha ao instalar`)
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { ok: errors.length === 0 && installed > 0, installed, errors }
}
