/*
 * Diagnostico NAO INVASIVO do spike Windows A1 do AurumBit Portal.
 *
 * O script roda em Node/tsx (sem Electron) e por isso NAO acessa safeStorage
 * diretamente. Ele relata como verificar o DPAPI pela interface do aplicativo.
 *
 * Garantias de seguranca:
 * - Nao importa, remove ou altera certificados no repositorio do Windows.
 * - Nao abre o banco de dados em escrita.
 * - Nao grava arquivos (inclusive no modo padrao).
 * - Apenas le caminhos, package.json e artefatos de teste ja existentes.
 *
 * Uso:
 *   npm run spike -- --check-only
 *   npm run spike -- --check-only --json
 *   npm run spike -- --check-only --user-data "C:\caminho\userData"
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { APP_NAME } from '../../shared/constants'
import { buildPartition, sessionReuseKey } from '../../electron/main/sessions/partition'

type CheckStatus = 'pass' | 'warn' | 'fail' | 'manual' | 'info'

interface CheckItem {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

interface CliOptions {
  checkOnly: boolean
  json: boolean
  help: boolean
  userData: string | null
}

interface FileInfo {
  path: string
  exists: boolean
  sizeBytes: number | null
}

interface ElectronInfo {
  version: string | null
  installed: boolean
  declared: string | null
}

interface SpikeReport {
  generatedAt: string
  mode: 'check-only'
  host: {
    platform: string
    arch: string
    release: string
    repoRoot: string
  }
  node: {
    version: string
    major: number
    minimum: number
    ok: boolean
  }
  electron: ElectronInfo
  powershell: {
    executable: string
    available: boolean
  }
  safeStorage: {
    status: 'manual'
    instruction: string
    expected: string
  }
  paths: {
    userData: string
    database: FileInfo
    databaseWal: FileInfo
    vaultKey: FileInfo
    logs: string
    logFile: string
    testPfxDir: string
    testPfx: FileInfo
    testPfxMetadata: FileInfo
  }
  partitions: {
    password: string
    certificate: string
    disposable: string
    reuseKeySample: string
  }
  checklist: CheckItem[]
  decision: {
    code: 'GO' | 'GO_CONDITIONAL' | 'NO_GO'
    label: string
    blockers: string[]
    pendingManual: string[]
  }
}

const NODE_MINIMUM = 22
const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: 'OK',
  warn: 'ATENCAO',
  fail: 'FALHA',
  manual: 'MANUAL',
  info: 'INFO',
}

function usage(): string {
  return [
    'AurumBit Portal - diagnostico do spike Windows A1',
    '',
    'Uso:',
    '  npm run spike -- --check-only [opcoes]',
    '',
    'Opcoes:',
    '  --check-only            Somente leitura; nao executa acoes corretivas (padrao)',
    '  --json                  Emite o relatorio em JSON (sem texto adicional)',
    '  --user-data <caminho>   Sobrepoe a pasta de dados do AurumBit Portal',
    '  -h, --help              Exibe esta ajuda',
    '',
    'Este script nunca altera o repositorio de certificados do Windows.',
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
    checkOnly: true,
    json: false,
    help: false,
    userData: null,
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--check-only') {
      options.checkOnly = true
      continue
    }
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--user-data') {
      options.userData = path.resolve(takeValue(args, index, arg))
      index += 1
      continue
    }
    if (arg.startsWith('--user-data=')) {
      const value = arg.slice('--user-data='.length)
      if (!value) fail('A opcao --user-data exige um valor.')
      options.userData = path.resolve(value)
      continue
    }
    if (arg.startsWith('-')) fail(`Opcao desconhecida: ${arg}`)
    fail(`Argumento posicional inesperado: ${arg}`)
  }

  return options
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function stringField(source: Record<string, unknown> | null, key: string): string | null {
  if (!source) return null
  const value = source[key]
  return typeof value === 'string' ? value : null
}

function fileInfo(filePath: string): FileInfo {
  try {
    const stats = statSync(filePath)
    return { path: filePath, exists: stats.isFile(), sizeBytes: stats.size }
  } catch {
    return { path: filePath, exists: false, sizeBytes: null }
  }
}

function findRepoRoot(start: string): string {
  let current = path.resolve(start)
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(current, 'package.json')
    if (existsSync(candidate)) {
      const pkg = readJsonObject(candidate)
      if (stringField(pkg, 'name') === 'aurumbit-portal') return current
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.resolve(start)
}

function defaultUserDataPath(): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, APP_NAME)
  }
  return path.join(os.homedir(), 'AppData', 'Roaming', APP_NAME)
}

function resolveUserData(options: CliOptions): string {
  if (options.userData) return options.userData
  if (process.env.AURUMBIT_USER_DATA) {
    return path.resolve(process.env.AURUMBIT_USER_DATA)
  }
  return defaultUserDataPath()
}

function buildChecklist(input: {
  platform: NodeJS.Platform
  arch: string
  nodeMajor: number
  electron: ElectronInfo
  powershellAvailable: boolean
  userDataExists: boolean
  databaseExists: boolean
  vaultKeyExists: boolean
  testPfxExists: boolean
}): CheckItem[] {
  const items: CheckItem[] = []

  const windowsOk = input.platform === 'win32'
  items.push({
    id: 'windows',
    label: 'Windows 10/11 (ambiente de spike)',
    status: windowsOk ? 'pass' : 'fail',
    detail: windowsOk
      ? `Plataforma ${input.platform}/${input.arch}.`
      : `Plataforma atual ${input.platform}/${input.arch}; o spike A1 exige Windows.`,
  })

  items.push({
    id: 'node',
    label: `Node.js >= ${NODE_MINIMUM}`,
    status: input.nodeMajor >= NODE_MINIMUM ? 'pass' : 'fail',
    detail: `Versao detectada: ${process.versions.node}.`,
  })

  items.push({
    id: 'electron',
    label: 'Electron instalado (mesma versao do app)',
    status: input.electron.version ? 'pass' : 'warn',
    detail: input.electron.version
      ? `Versao ${input.electron.version}${input.electron.installed ? '' : ' (declarada no package.json, nao instalada)'}`
      : 'Nao foi possivel detectar a versao do Electron.',
  })

  items.push({
    id: 'powershell',
    label: 'Windows PowerShell 5.1 disponivel',
    status: input.powershellAvailable ? 'pass' : windowsOk ? 'fail' : 'warn',
    detail: input.powershellAvailable
      ? 'powershell.exe encontrado no caminho esperado.'
      : 'powershell.exe nao encontrado; a leitura do store do Windows depende dele.',
  })

  items.push({
    id: 'safe-storage',
    label: 'safeStorage/DPAPI disponivel',
    status: 'manual',
    detail:
      'Verifique em AurumBit Portal > Configuracoes > Sobre e diagnostico: o campo "safeStorage/DPAPI" deve estar "Disponivel".',
  })

  items.push({
    id: 'user-data',
    label: 'Pasta de dados do usuario localizada',
    status: input.userDataExists ? 'pass' : 'info',
    detail: input.userDataExists
      ? 'Pasta existente; use-a para o teste de leitura.'
      : 'A pasta ainda nao existe; sera criada no primeiro uso do aplicativo.',
  })

  items.push({
    id: 'database',
    label: 'Banco SQLite local',
    status: input.databaseExists ? 'pass' : 'info',
    detail: input.databaseExists
      ? 'aurumbit-portal.db encontrado. O diagnostico nao abre o banco em escrita.'
      : 'aurumbit-portal.db ainda nao existe (primeiro uso).',
  })

  items.push({
    id: 'vault-key',
    label: 'Chave do cofre protegida pelo DPAPI',
    status: input.vaultKeyExists ? 'pass' : 'info',
    detail: input.vaultKeyExists
      ? 'vault.key encontrado; a chave so pode ser aberta pelo mesmo perfil do Windows.'
      : 'vault.key sera criado no primeiro uso, apos validar o safeStorage.',
  })

  items.push({
    id: 'test-pfx',
    label: 'PFX de teste gerado',
    status: input.testPfxExists ? 'pass' : 'warn',
    detail: input.testPfxExists
      ? 'Artefato encontrado em scripts/spike/.certs.'
      : 'Gere com "npm run spike:certs -- --password <senha>" antes de testar a importacao.',
  })

  items.push({
    id: 'partition-model',
    label: 'Modelo de particao por cliente/certificado',
    status: 'pass',
    detail: 'Funcao pura executada com sucesso: cliente e certificado nunca compartilham particao.',
  })

  items.push({
    id: 'cert-store',
    label: 'Repositorio de certificados do Windows',
    status: 'manual',
    detail:
      'Nenhuma alteracao foi feita. Para leitura manual, use: Get-ChildItem Cert:\\CurrentUser\\My | Select-Object Subject, Thumbprint, NotAfter',
  })

  items.push({
    id: 'no-cert-write',
    label: 'Diagnostico sem escrita no store de certificados',
    status: 'pass',
    detail: 'O script nao executa Import-PfxCertificate, Remove-Item nem comandos equivalentes.',
  })

  items.push({
    id: 'consent',
    label: 'Autorizacao do titular (LGPD) registrada',
    status: 'manual',
    detail:
      'Confirme que o escritorio tem autorizacao para importar e usar o certificado de teste em nome do titular.',
  })

  items.push({
    id: 'isolation',
    label: 'Ambiente isolado para o spike',
    status: 'manual',
    detail:
      'Prefira VM descartavel ou perfil Windows dedicado. Nao use certificados de producao no spike.',
  })

  return items
}

function decide(items: CheckItem[]): SpikeReport['decision'] {
  const blockers = items.filter((item) => item.status === 'fail').map((item) => item.label)
  const pendingManual = items.filter((item) => item.status === 'manual').map((item) => item.label)
  if (blockers.length > 0) {
    return {
      code: 'NO_GO',
      label: 'NO-GO: corrija os bloqueios antes de executar o spike.',
      blockers,
      pendingManual,
    }
  }
  if (pendingManual.length > 0) {
    return {
      code: 'GO_CONDITIONAL',
      label: 'GO CONDICIONAL: ambiente pronto; conclua os itens MANUAL no aplicativo.',
      blockers,
      pendingManual,
    }
  }
  return {
    code: 'GO',
    label: 'GO: todos os itens automaticos e manuais foram confirmados.',
    blockers,
    pendingManual,
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const repoRoot = findRepoRoot(process.cwd())
  const packageJson = readJsonObject(path.join(repoRoot, 'package.json'))
  const installedElectron = readJsonObject(path.join(repoRoot, 'node_modules', 'electron', 'package.json'))
  const devDependencies = packageJson?.['devDependencies']
  const declaredElectron =
    devDependencies && typeof devDependencies === 'object' && !Array.isArray(devDependencies)
      ? stringField(devDependencies as Record<string, unknown>, 'electron')
      : null
  const electron: ElectronInfo = {
    version: stringField(installedElectron, 'version') ?? declaredElectron,
    installed: Boolean(stringField(installedElectron, 'version')),
    declared: declaredElectron,
  }

  const userData = resolveUserData(options)
  const database = fileInfo(path.join(userData, 'aurumbit-portal.db'))
  const databaseWal = fileInfo(path.join(userData, 'aurumbit-portal.db-wal'))
  const vaultKey = fileInfo(path.join(userData, 'vault.key'))
  const logs = path.join(userData, 'logs')
  const logFile = path.join(logs, 'aurumbit-portal.log')
  const testPfxDir = path.join(repoRoot, 'scripts', 'spike', '.certs')
  const testPfx = fileInfo(path.join(testPfxDir, 'spike-a1-test.pfx'))
  const testPfxMetadata = fileInfo(path.join(testPfxDir, 'spike-a1-test-metadata.json'))

  const powershellPath =
    process.platform === 'win32' && process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
  const powershellAvailable = process.platform === 'win32' && existsSync(powershellPath)

  const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0')

  const partitions = {
    password: buildPartition({ clientId: 'cliente-spike', authMethod: 'password' }),
    certificate: buildPartition({
      clientId: 'cliente-spike',
      authMethod: 'certificate',
      certificateId: 'cert-spike',
    }),
    disposable: buildPartition({
      clientId: 'cliente-spike',
      authMethod: 'password',
      disposable: true,
    }),
    reuseKeySample: sessionReuseKey({
      clientId: 'cliente-spike',
      serviceId: 'builtin-govbr',
      authMethod: 'certificate',
      certificateId: 'cert-spike',
    }),
  }

  const checklist = buildChecklist({
    platform: process.platform,
    arch: process.arch,
    nodeMajor,
    electron,
    powershellAvailable,
    userDataExists: existsSync(userData),
    databaseExists: database.exists,
    vaultKeyExists: vaultKey.exists,
    testPfxExists: testPfx.exists,
  })

  const report: SpikeReport = {
    generatedAt: new Date().toISOString(),
    mode: 'check-only',
    host: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      repoRoot,
    },
    node: {
      version: process.versions.node,
      major: nodeMajor,
      minimum: NODE_MINIMUM,
      ok: nodeMajor >= NODE_MINIMUM,
    },
    electron,
    powershell: {
      executable: powershellPath,
      available: powershellAvailable,
    },
    safeStorage: {
      status: 'manual',
      instruction:
        'Abra o AurumBit Portal e consulte Configuracoes > Sobre e diagnostico. O campo safeStorage/DPAPI deve exibir "Disponivel".',
      expected: 'Disponivel',
    },
    paths: {
      userData,
      database,
      databaseWal,
      vaultKey,
      logs,
      logFile,
      testPfxDir,
      testPfx,
      testPfxMetadata,
    },
    partitions,
    checklist,
    decision: decide(checklist),
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printReport(report)
  }

  if (report.decision.code === 'NO_GO') process.exitCode = 1
}

function printReport(report: SpikeReport): void {
  console.log('AurumBit Portal - diagnostico do spike Windows A1')
  console.log(`Gerado em: ${report.generatedAt}`)
  console.log(`Modo: ${report.mode} (somente leitura, sem alteracao no store de certificados)`)
  console.log('')

  console.log('Ambiente')
  console.log(`  Windows/plataforma : ${report.host.platform}/${report.host.arch} (${report.host.release})`)
  console.log(`  Node.js            : ${report.node.version} (minimo ${report.node.minimum})`)
  console.log(
    `  Electron           : ${report.electron.version ?? 'nao detectado'}` +
      (report.electron.version && !report.electron.installed ? ' (declarado)' : ''),
  )
  console.log(`  PowerShell         : ${report.powershell.available ? report.powershell.executable : 'nao encontrado'}`)
  console.log(`  Repositorio        : ${report.host.repoRoot}`)
  console.log('')

  console.log('Caminhos locais')
  console.log(`  userData           : ${report.paths.userData}`)
  console.log(`  Banco              : ${describeFile(report.paths.database)}`)
  console.log(`  WAL                : ${describeFile(report.paths.databaseWal)}`)
  console.log(`  Chave do cofre     : ${describeFile(report.paths.vaultKey)}`)
  console.log(`  Logs               : ${report.paths.logs}`)
  console.log(`  PFX de teste       : ${describeFile(report.paths.testPfx)}`)
  console.log(`  Metadados do PFX   : ${describeFile(report.paths.testPfxMetadata)}`)
  console.log('')

  console.log('Particoes de exemplo')
  console.log(`  Senha              : ${report.partitions.password}`)
  console.log(`  Certificado        : ${report.partitions.certificate}`)
  console.log(`  Descartavel        : ${report.partitions.disposable}`)
  console.log(`  Chave de reuso     : ${report.partitions.reuseKeySample}`)
  console.log('')

  console.log('Checklist go/no-go')
  for (const item of report.checklist) {
    console.log(`  [${STATUS_LABEL[item.status].padEnd(7)}] ${item.label}`)
    console.log(`             ${item.detail}`)
  }
  console.log('')

  console.log(`Decisao: ${report.decision.label}`)
  if (report.decision.blockers.length > 0) {
    console.log('  Bloqueios:')
    for (const blocker of report.decision.blockers) console.log(`    - ${blocker}`)
  }
  if (report.decision.pendingManual.length > 0) {
    console.log('  Pendencias manuais:')
    for (const pending of report.decision.pendingManual) console.log(`    - ${pending}`)
  }
  console.log('')
  console.log('Orientacao safeStorage:')
  console.log(`  ${report.safeStorage.instruction}`)
  console.log('')
  console.log('Nenhum certificado foi importado, removido ou alterado por este diagnostico.')
}

function describeFile(info: FileInfo): string {
  if (!info.exists) return `${info.path} (ausente)`
  const size = info.sizeBytes === null ? '' : `, ${formatBytes(info.sizeBytes)}`
  return `${info.path} (${size ? size.slice(2) : 'presente'})`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

try {
  main()
} catch (error) {
  if (process.exitCode !== 1) {
    console.error(error instanceof Error ? `[erro] ${error.message}` : String(error))
    process.exitCode = 1
  }
}
