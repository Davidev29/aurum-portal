import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  Certificate,
  CertificateDetails,
  CertificateFilter,
  CertificateTestResult,
  ImportFileSpec,
  ImportItemResult,
  ImportProgressEvent,
  ImportReport,
  WindowsCertificate,
  WindowsImportItemResult,
  WindowsImportSummary,
} from '../../../shared/types'
import type { ParsedPfx } from './parse'
import { parsePfx } from './parse'
import type { AppDatabase } from '../db/database'
import type { VaultService } from '../vault/service'
import { appendAuditEvent } from '../db/repositories/audit'
import {
  certificateStats,
  createPfxCertificate,
  createWindowsCertificate,
  findCertificateBySha1,
  findCertificateByThumbprint,
  getCertificateDetails,
  getCertificateRow,
  getCertificateView,
  linkClientToCertificate,
  listCertificates,
  refreshWindowsPresence,
  setCertificateInstalled,
  unlinkClientFromCertificate,
} from '../db/repositories/certificates'
import { createClient, findClientByDocument } from '../db/repositories/clients'
import { lookupCompanyByCnpj } from '../integrations/brasil-api'
import type { CompanyLookupFn } from '../clients/enrichment'
import { applyCompanyDataToClient, fetchCompanyByCnpj } from '../clients/enrichment'
import { AppError } from '../errors'
import { logger } from '../logger'
import { maskDocument } from '../../../shared/validation'
import type { WindowsCertificateRecord } from './windows-store'
import {
  installPfxInWindowsStore,
  listWindowsCertificates,
  removePfxFromWindowsStore,
} from './windows-store'
import { parsePfxFilesInWorker } from './worker-client'
import { encryptBackup } from '../vault/backup'

export interface WindowsStoreAdapter {
  list(): Promise<WindowsCertificateRecord[]>
  install(
    pfx: Buffer,
    password: string,
  ): Promise<{ ok: boolean; thumbprint: string | null; error: string | null }>
  remove(thumbprintSha1: string): Promise<{ ok: boolean; error: string | null }>
}

/**
 * Totais da importação em lote do Windows exigem apenas esses campos do
 * registro — mantemos o helper puro para poder conferir a seleção (todos vs.
 * selecionados) sem depender do PowerShell nem do banco.
 */
export function selectWindowsImportTargets(
  records: WindowsCertificateRecord[],
  input: { thumbprints?: string[]; importAll?: boolean },
): { targets: WindowsCertificateRecord[]; missingThumbprints: string[] } {
  const normalizedRecords = records.filter((record) => record.thumbprintSha1?.length === 40)
  if (input.importAll === true) {
    const seen = new Set<string>()
    const targets: WindowsCertificateRecord[] = []
    for (const record of normalizedRecords) {
      const key = record.thumbprintSha1.toUpperCase()
      if (seen.has(key)) continue
      seen.add(key)
      targets.push(record)
    }
    return { targets, missingThumbprints: [] }
  }

  const wanted = [
    ...new Set(
      (input.thumbprints ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean),
    ),
  ]
  if (wanted.length === 0) return { targets: [], missingThumbprints: [] }

  const targets: WindowsCertificateRecord[] = []
  const missingThumbprints: string[] = []
  for (const thumbprint of wanted) {
    const found = normalizedRecords.find(
      (item) =>
        item.thumbprintSha1.toUpperCase() === thumbprint ||
        (item.thumbprintSha256?.toUpperCase() === thumbprint && thumbprint.length === 64),
    )
    if (found) {
      if (
        !targets.some(
          (item) => item.thumbprintSha1.toUpperCase() === found.thumbprintSha1.toUpperCase(),
        )
      ) {
        targets.push(found)
      }
    } else {
      missingThumbprints.push(thumbprint)
    }
  }
  return { targets, missingThumbprints }
}

const defaultWindowsAdapter: WindowsStoreAdapter = {
  list: listWindowsCertificates,
  install: installPfxInWindowsStore,
  remove: removePfxFromWindowsStore,
}

export interface CertificateServiceDeps {
  db: AppDatabase
  vault: VaultService
  windows?: WindowsStoreAdapter
  isCertificateInUse?: (certificateId: string) => boolean
  onChanged?: () => void
  onImportProgress?: (progress: ImportProgressEvent) => void
  testCertificate?: (certificateId: string) => Promise<CertificateTestResult>
  /**
   * Consulta de CNPJ na Brasil API. Injetável para testes; o padrão usa a
   * rede real. Em produção, só é chamada quando o operador autorizou
   * explicitamente a importação (consentimento) e o documento é CNPJ — apenas
   * os 14 dígitos saem da estação.
   */
  lookupCompany?: CompanyLookupFn
}

interface ProcessOptions {
  clientId?: string | null
  consent: boolean
  install: boolean
  label?: string
}

export class CertificateService {
  private readonly windows: WindowsStoreAdapter

  constructor(private readonly deps: CertificateServiceDeps) {
    this.windows = deps.windows ?? defaultWindowsAdapter
  }

  list(filter: CertificateFilter = {}): Certificate[] {
    return listCertificates(this.deps.db, filter)
  }

  get(id: string): Certificate {
    return getCertificateView(this.deps.db, id)
  }

  details(id: string): CertificateDetails {
    return getCertificateDetails(this.deps.db, id)
  }

  stats(): ReturnType<typeof certificateStats> {
    return certificateStats(this.deps.db)
  }

  async refreshPresence(): Promise<WindowsCertificateRecord[] | null> {
    try {
      const records = await this.windows.list()
      refreshWindowsPresence(
        this.deps.db,
        new Set(records.map((record) => record.thumbprintSha1.toUpperCase())),
      )
      return records
    } catch (error) {
      logger.warn('certificates.refresh_presence_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  async listWindows(): Promise<WindowsCertificate[]> {
    const records = await this.windows.list()
    refreshWindowsPresence(
      this.deps.db,
      new Set(records.map((record) => record.thumbprintSha1.toUpperCase())),
    )
    return records.map((record) => {
      const existing =
        (record.thumbprintSha256
          ? findCertificateByThumbprint(this.deps.db, record.thumbprintSha256)
          : null) ?? findCertificateBySha1(this.deps.db, record.thumbprintSha1)
      const document = record.document
      return {
        thumbprintSha1: record.thumbprintSha1,
        thumbprintSha256: record.thumbprintSha256,
        subject: record.subject,
        issuer: record.issuer,
        holderName: record.holderName,
        document,
        notBefore: record.notBefore,
        notAfter: record.notAfter,
        serialNumber: record.serialNumber,
        hasPrivateKey: record.hasPrivateKey,
        alreadyImported: Boolean(existing),
        certificateId: existing?.id ?? null,
      }
    })
  }

  async importSingle(input: {
    filePath: string
    password: string
    clientId?: string | null
    install: boolean
    consent?: boolean
  }): Promise<ImportReport> {
    this.assertConsent(input.clientId ?? null, input.consent === true)
    const jobId = randomUUID()
    const startedAt = new Date().toISOString()
    const report = this.emptyReport(jobId, 1, startedAt)
    this.emit({
      jobId,
      total: 1,
      completed: 0,
      currentFile: path.basename(input.filePath),
      success: 0,
      duplicates: 0,
      errors: 0,
      stage: 'reading',
    })
    const item = await this.importOne(
      input.filePath,
      input.password,
      { clientId: input.clientId, consent: input.consent === true, install: input.install },
      jobId,
      1,
      0,
    )
    this.applyItemToReport(report, item)
    this.emit({
      jobId,
      total: 1,
      completed: 1,
      currentFile: null,
      success: report.success,
      duplicates: report.duplicates,
      errors: report.errors,
      stage: 'done',
    })
    report.finishedAt = new Date().toISOString()
    this.record('certificate.batch_finished', null, {
      jobId,
      total: report.total,
      success: report.success,
      errors: report.errors,
      duplicates: report.duplicates,
      expired: report.expired,
    })
    this.deps.onChanged?.()
    return report
  }

  async importBatch(input: {
    files: ImportFileSpec[]
    sharedPassword?: string
    install: boolean
    clientId?: string | null
    consent?: boolean
  }): Promise<ImportReport> {
    this.assertConsent(input.clientId ?? null, input.consent === true)
    const jobId = randomUUID()
    const startedAt = new Date().toISOString()
    const report = this.emptyReport(jobId, input.files.length, startedAt)
    this.record('certificate.batch_started', null, { jobId, total: input.files.length })
    this.emit({
      jobId,
      total: input.files.length,
      completed: 0,
      currentFile: null,
      success: 0,
      duplicates: 0,
      errors: 0,
      stage: 'reading',
    })

    const passwords = input.files.map((file) => file.password ?? input.sharedPassword ?? '')

    let parsedResults: Array<{
      filePath: string
      ok: boolean
      parsed: ParsedPfx | null
      error: string | null
    }>
    try {
      parsedResults = await parsePfxFilesInWorker(
        input.files.map((file, index) => ({
          filePath: file.filePath,
          password: passwords[index] ?? '',
        })),
        (completed) => {
          this.emit({
            jobId,
            total: input.files.length,
            completed,
            currentFile: null,
            success: report.success,
            duplicates: report.duplicates,
            errors: report.errors,
            stage: 'validating',
          })
        },
      )
    } catch (error) {
      logger.warn('certificates.worker_fallback', {
        message: error instanceof Error ? error.message : String(error),
      })
      parsedResults = []
      for (let index = 0; index < input.files.length; index += 1) {
        const file = input.files[index] as ImportFileSpec
        try {
          const buffer = await readFile(file.filePath)
          parsedResults.push({
            filePath: file.filePath,
            ok: true,
            parsed: parsePfx(buffer, passwords[index] ?? ''),
            error: null,
          })
        } catch (parseError) {
          parsedResults.push({
            filePath: file.filePath,
            ok: false,
            parsed: null,
            error: parseError instanceof Error ? parseError.message : 'Erro ao ler PFX',
          })
        }
      }
    }

    for (let index = 0; index < parsedResults.length; index += 1) {
      const result = parsedResults[index]
      if (!result) continue
      let item: ImportItemResult
      if (!result.ok || !result.parsed) {
        item = {
          filePath: result.filePath,
          fileName: path.basename(result.filePath),
          status: 'error',
          message: result.error ?? 'PFX invalido',
          certificateId: null,
          holderName: null,
          document: null,
          documentType: null,
          validTo: null,
          installed: false,
        }
        this.record('certificate.import_failed', null, {
          jobId,
          fileName: item.fileName,
          error: item.message,
        })
      } else {
        item = await this.processParsed(
          result.filePath,
          passwords[index] ?? '',
          result.parsed,
          { clientId: input.clientId, consent: input.consent === true, install: input.install },
          jobId,
          input.files.length,
          index,
        )
      }
      this.applyItemToReport(report, item)
      this.emit({
        jobId,
        total: input.files.length,
        completed: index + 1,
        currentFile: item.fileName,
        success: report.success,
        duplicates: report.duplicates,
        errors: report.errors,
        stage: 'saving',
      })
    }

    report.finishedAt = new Date().toISOString()
    this.emit({
      jobId,
      total: input.files.length,
      completed: input.files.length,
      currentFile: null,
      success: report.success,
      duplicates: report.duplicates,
      errors: report.errors,
      stage: 'done',
    })
    this.record('certificate.batch_finished', null, {
      jobId,
      total: report.total,
      success: report.success,
      errors: report.errors,
      duplicates: report.duplicates,
      expired: report.expired,
    })
    if (input.install) await this.refreshPresence()
    this.deps.onChanged?.()
    return report
  }

  private async importOne(
    filePath: string,
    password: string,
    options: ProcessOptions,
    jobId: string,
    total: number,
    index: number,
  ): Promise<ImportItemResult> {
    try {
      const fileName = path.basename(filePath)
      if (!/\.(pfx|p12)$/i.test(fileName)) {
        throw new Error('Extensao invalida: use .pfx ou .p12')
      }
      const info = await stat(filePath)
      if (!info.isFile() || info.size > 20 * 1024 * 1024) {
        throw new Error('Arquivo invalido ou maior que 20 MB')
      }
      this.emit({
        jobId,
        total,
        completed: index,
        currentFile: fileName,
        success: 0,
        duplicates: 0,
        errors: 0,
        stage: 'validating',
      })
      const buffer = await readFile(filePath)
      const parsed = parsePfx(buffer, password)
      return await this.saveParsed(filePath, password, parsed, options)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao importar PFX'
      this.record('certificate.import_failed', null, {
        jobId,
        fileName: path.basename(filePath),
        error: message,
      })
      return {
        filePath,
        fileName: path.basename(filePath),
        status: 'error',
        message,
        certificateId: null,
        holderName: null,
        document: null,
        documentType: null,
        validTo: null,
        installed: false,
      }
    }
  }

  private async processParsed(
    filePath: string,
    password: string,
    parsed: ParsedPfx,
    options: ProcessOptions,
    jobId: string,
    total: number,
    index: number,
  ): Promise<ImportItemResult> {
    try {
      return await this.saveParsed(filePath, password, parsed, options, { jobId, total, index })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao importar PFX'
      this.record('certificate.import_failed', null, {
        jobId,
        fileName: path.basename(filePath),
        error: message,
      })
      return {
        filePath,
        fileName: path.basename(filePath),
        status: 'error',
        message,
        certificateId: null,
        holderName: parsed.holderName,
        document: parsed.document,
        documentType: parsed.documentType,
        validTo: parsed.validTo,
        installed: false,
      }
    }
  }

  private async saveParsed(
    filePath: string,
    password: string,
    parsed: ParsedPfx,
    options: ProcessOptions,
    progress?: { jobId: string; total: number; index: number },
  ): Promise<ImportItemResult> {
    const existing = findCertificateByThumbprint(this.deps.db, parsed.thumbprintSha256)
    if (existing) {
      if (options.clientId) {
        linkClientToCertificate(this.deps.db, existing.id, options.clientId, options.consent)
      }
      return {
        filePath,
        fileName: path.basename(filePath),
        status: 'duplicate',
        message: options.clientId
          ? 'Certificado ja importado; vinculo com o cliente atualizado.'
          : 'Certificado ja importado anteriormente.',
        certificateId: existing.id,
        holderName: existing.holderName,
        document: existing.document,
        documentType: existing.documentType,
        validTo: existing.validTo,
        installed: existing.installed,
      }
    }

    let clientId = options.clientId ?? null
    if (!clientId && options.consent && parsed.document) {
      // resolveOrCreate já enriquece PJ existente com a Brasil API (apenas CNPJ).
      clientId = await this.resolveOrCreateClientFromDocument(parsed.document, parsed.holderName)
    }

    if (clientId && !options.consent) {
      throw new AppError('FORBIDDEN', 'Consentimento obrigatorio para vincular certificado')
    }

    const buffer = await readFile(filePath)
    let installed = false
    let installError: string | null = null
    if (options.install && !parsed.isExpired) {
      if (progress) {
        this.emit({
          jobId: progress.jobId,
          total: progress.total,
          completed: progress.index,
          currentFile: path.basename(filePath),
          success: 0,
          duplicates: 0,
          errors: 0,
          stage: 'installing',
        })
      }
      const result = await this.windows.install(buffer, password)
      if (result.ok && result.thumbprint?.toUpperCase() === parsed.thumbprintSha1.toUpperCase()) {
        installed = true
      } else {
        installError = result.error ?? 'O Windows nao confirmou o thumbprint instalado'
      }
    }

    const row = createPfxCertificate(this.deps.db, this.deps.vault, {
      parsed,
      pfx: buffer,
      password,
      clientId,
      consent: options.consent,
      install: options.install,
      installed,
    })
    this.record('certificate.imported', row.id, {
      holderName: parsed.holderName,
      document: parsed.document ? maskDocument(parsed.document) : null,
      source: 'pfx',
      installed,
      expired: parsed.isExpired,
    })
    this.deps.onChanged?.()
    if (parsed.isExpired) {
      return {
        filePath,
        fileName: path.basename(filePath),
        status: 'expired',
        message: 'Certificado importado, mas esta vencido e nao pode autenticar.',
        certificateId: row.id,
        holderName: parsed.holderName,
        document: parsed.document,
        documentType: parsed.documentType,
        validTo: parsed.validTo,
        installed,
      }
    }
    return {
      filePath,
      fileName: path.basename(filePath),
      status: 'success',
      message: installError
        ? `Importado no cofre; falha ao instalar no Windows: ${installError}`
        : installed
          ? 'Importado e instalado no Windows.'
          : 'Importado no cofre.',
      certificateId: row.id,
      holderName: parsed.holderName,
      document: parsed.document,
      documentType: parsed.documentType,
      validTo: parsed.validTo,
      installed,
    }
  }

  private lookupCompany(): CompanyLookupFn {
    return this.deps.lookupCompany ?? lookupCompanyByCnpj
  }

  /**
   * Cadastro completo a partir do certificado (PFX ou Windows).
   *
   * Só é chamada quando o operador marcou a autorização do titular
   * (consentimento explícito na importação). Para CNPJ (PJ), consulta a
   * Brasil API usando **apenas os 14 dígitos** e usa a razão social oficial
   * (nome) + e-mail + telefone para o cadastro; o nome do titular do
   * certificado é só fallback quando a API está indisponível. Para CPF
   * (PF) não há consulta externa: usa o nome do titular.
   *
   * Cliente já existente (PJ ativo) é enriquecido no local: nome, e-mail e
   * telefone são corrigidos com os dados oficiais. Vínculos, status, tags e
   * notas nunca são alterados aqui.
   * Privacidade: nenhum outro dado (nome, e-mail, titular) é enviado à API.
   */
  private async resolveOrCreateClientFromDocument(
    document: string,
    holderName: string,
  ): Promise<string | null> {
    const digits = (document ?? '').replace(/\D+/g, '')
    if (digits.length !== 11 && digits.length !== 14) return null

    const lookup = this.lookupCompany()
    const isPj = digits.length === 14
    const fallbackName = holderName?.trim() || `Cliente ${digits}`

    if (isPj) {
      const company = await fetchCompanyByCnpj(digits, lookup)
      this.record('external.cnpj_lookup', null, {
        provider: 'brasilapi.com.br',
        document: maskDocument(digits),
        status: company ? 'ok' : 'unavailable',
        source: 'certificate_import',
      })
      const existing = findClientByDocument(this.deps.db, digits)
      if (existing) {
        if (existing.status !== 'active') return existing.id
        const { client } = applyCompanyDataToClient(this.deps.db, existing, company)
        this.record('client.brasil_api_enriched', client.id, {
          document: maskDocument(digits),
          source: 'certificate_import',
          updated: company ? true : false,
        })
        return client.id
      }
      const name = company?.name?.trim() || fallbackName
      const email = company?.email?.trim() || null
      const phone = company?.phone?.trim() || null
      try {
        const client = createClient(this.deps.db, {
          type: 'PJ',
          name,
          document: digits,
          email,
          phone,
          consent: true,
        })
        return client.id
      } catch {
        const fallback = findClientByDocument(this.deps.db, digits)
        if (fallback) {
          if (fallback.status === 'active') {
            const enriched = applyCompanyDataToClient(this.deps.db, fallback, company).client
            return enriched.id
          }
          return fallback.id
        }
        return null
      }
    }

    // PF: sem consulta externa.
    const existing = findClientByDocument(this.deps.db, digits)
    if (existing) return existing.id
    try {
      const client = createClient(this.deps.db, {
        type: 'PF',
        name: fallbackName,
        document: digits,
        email: null,
        phone: null,
        consent: true,
      })
      return client.id
    } catch {
      const fallback = findClientByDocument(this.deps.db, digits)
      return fallback?.id ?? null
    }
  }

  async install(id: string): Promise<Certificate> {
    const current = getCertificateRow(this.deps.db, id)
    if (current.installed) return getCertificateView(this.deps.db, id)
    if (!current.pfxEnc || !current.pfxPasswordEnc) {
      // Certificado importado do Windows: basta verificar se ainda esta presente.
      const records = await this.windows.list()
      const found = records.some(
        (record) => record.thumbprintSha1.toUpperCase() === current.thumbprintSha1.toUpperCase(),
      )
      setCertificateInstalled(this.deps.db, id, found)
      if (!found) {
        throw new AppError(
          'CERTIFICATE_NOT_INSTALLED',
          'Certificado nao esta instalado no Windows e nao ha PFX no cofre',
        )
      }
      this.deps.onChanged?.()
      return getCertificateView(this.deps.db, id)
    }
    const pfx = this.deps.vault.openPfx(id, current.pfxEnc)
    const password = this.deps.vault.openPfxPassword(id, current.pfxPasswordEnc)
    const result = await this.windows.install(pfx, password)
    if (!result.ok || result.thumbprint?.toUpperCase() !== current.thumbprintSha1.toUpperCase()) {
      const message = result.error ?? 'Thumbprint instalado nao confere'
      this.record('certificate.install_failed', id, { error: message })
      throw new AppError(
        'CERTIFICATE_NOT_INSTALLED',
        message,
        'Nao foi possivel instalar o certificado no Windows.',
      )
    }
    setCertificateInstalled(this.deps.db, id, true)
    this.record('certificate.installed', id, { source: 'pfx' })
    this.deps.onChanged?.()
    return getCertificateView(this.deps.db, id)
  }

  async uninstall(input: { id: string; confirmation: string }): Promise<Certificate> {
    if (input.confirmation !== 'REMOVER') {
      throw new AppError('VALIDATION', 'Confirmacao de remocao invalida')
    }
    if (this.deps.isCertificateInUse?.(input.id)) {
      throw new AppError(
        'CONFLICT',
        'Certificado em uso por uma sessao aberta',
        'Feche as sessoes que usam este certificado antes de remove-lo do Windows.',
      )
    }
    const current = getCertificateRow(this.deps.db, input.id)
    const result = await this.windows.remove(current.thumbprintSha1)
    if (!result.ok) {
      throw new AppError(
        'CERTIFICATE_NOT_INSTALLED',
        result.error ?? 'Falha ao remover certificado',
        'Nao foi possivel remover o certificado do Windows.',
      )
    }
    setCertificateInstalled(this.deps.db, input.id, false)
    this.record('certificate.removed', input.id, { source: current.source })
    this.deps.onChanged?.()
    return getCertificateView(this.deps.db, input.id)
  }

  async linkClient(input: {
    id: string
    clientId: string
    consent: boolean
  }): Promise<Certificate> {
    if (!input.consent) {
      throw new AppError('FORBIDDEN', 'Consentimento obrigatorio para vincular certificado')
    }
    linkClientToCertificate(this.deps.db, input.id, input.clientId, true)
    this.record('certificate.linked', input.id, { clientId: input.clientId })
    this.deps.onChanged?.()
    return getCertificateView(this.deps.db, input.id)
  }

  unlinkClient(input: { id: string; clientId: string }): Certificate {
    unlinkClientFromCertificate(this.deps.db, input.id, input.clientId)
    this.record('certificate.unlinked', input.id, { clientId: input.clientId })
    this.deps.onChanged?.()
    return getCertificateView(this.deps.db, input.id)
  }

  async importFromWindows(input: {
    thumbprints?: string[]
    importAll?: boolean
    clientId?: string | null
    consent?: boolean
  }): Promise<WindowsImportSummary> {
    this.assertConsent(input.clientId ?? null, input.consent === true)
    const thumbprints = input.thumbprints ?? []
    const importAll = input.importAll === true
    if (!importAll && thumbprints.length === 0) {
      throw new AppError(
        'VALIDATION',
        'Nenhum certificado selecionado',
        'Selecione ao menos um certificado ou use "Importar todos".',
      )
    }

    const jobId = randomUUID()
    const startedAt = new Date().toISOString()
    const records = await this.windows.list()
    refreshWindowsPresence(
      this.deps.db,
      new Set(records.map((record) => record.thumbprintSha1.toUpperCase())),
    )

    const { targets, missingThumbprints } = selectWindowsImportTargets(records, {
      thumbprints,
      importAll,
    })

    const items: WindowsImportItemResult[] = []
    const touched: string[] = []
    let imported = 0
    let duplicates = 0
    let errors = 0

    this.record('certificate.windows_batch_started', null, {
      jobId,
      total: targets.length + missingThumbprints.length,
      importAll,
      clientId: input.clientId ?? null,
    })
    this.emit({
      jobId,
      total: targets.length + missingThumbprints.length,
      completed: 0,
      currentFile: null,
      success: 0,
      duplicates: 0,
      errors: 0,
      stage: 'reading',
    })

    for (const thumbprint of missingThumbprints) {
      errors += 1
      items.push({
        thumbprintSha1: thumbprint,
        holderName: null,
        document: null,
        status: 'error',
        message: 'Certificado nao encontrado no repositorio do Windows (pode ter sido removido).',
        certificateId: null,
      })
    }

    for (let index = 0; index < targets.length; index += 1) {
      const record = targets[index] as WindowsCertificateRecord
      try {
        const existing =
          (record.thumbprintSha256
            ? findCertificateByThumbprint(this.deps.db, record.thumbprintSha256)
            : null) ?? findCertificateBySha1(this.deps.db, record.thumbprintSha1)
        if (existing) {
          if (input.clientId) {
            linkClientToCertificate(
              this.deps.db,
              existing.id,
              input.clientId,
              input.consent === true,
            )
          }
          duplicates += 1
          items.push({
            thumbprintSha1: record.thumbprintSha1.toUpperCase(),
            holderName: record.holderName,
            document: record.document,
            status: 'duplicate',
            message: 'Certificado ja cadastrado anteriormente.',
            certificateId: existing.id,
          })
          if (!touched.includes(existing.id)) touched.push(existing.id)
        } else if (!record.thumbprintSha256 || record.thumbprintSha256.length !== 64) {
          errors += 1
          items.push({
            thumbprintSha1: record.thumbprintSha1.toUpperCase(),
            holderName: record.holderName,
            document: record.document,
            status: 'error',
            message: 'Certificado sem thumbprint SHA-256 valido para cadastro.',
            certificateId: null,
          })
          this.record('certificate.import_failed', null, {
            jobId,
            thumbprintSha1: record.thumbprintSha1.toUpperCase(),
            error: 'Thumbprint SHA-256 indisponivel',
          })
        } else {
          let clientId = input.clientId ?? null
          if (!clientId && input.consent === true && record.document) {
            // resolveOrCreate já enriquece PJ existente com a Brasil API (apenas CNPJ).
            clientId = await this.resolveOrCreateClientFromDocument(
              record.document,
              record.holderName,
            )
          }
          const view: WindowsCertificate = {
            thumbprintSha1: record.thumbprintSha1,
            thumbprintSha256: record.thumbprintSha256,
            subject: record.subject,
            issuer: record.issuer,
            holderName: record.holderName,
            document: record.document,
            notBefore: record.notBefore,
            notAfter: record.notAfter,
            serialNumber: record.serialNumber,
            hasPrivateKey: record.hasPrivateKey,
            alreadyImported: false,
            certificateId: null,
          }
          const row = createWindowsCertificate(this.deps.db, view, clientId, input.consent === true)
          if (!touched.includes(row.id)) touched.push(row.id)
          imported += 1
          const isExpired = new Date(record.notAfter).getTime() <= Date.now()
          items.push({
            thumbprintSha1: record.thumbprintSha1.toUpperCase(),
            holderName: record.holderName,
            document: record.document,
            status: isExpired ? 'expired' : 'imported',
            message: isExpired ? 'Importado, mas vencido e nao pode autenticar.' : 'Importado.',
            certificateId: row.id,
          })
          this.record('certificate.imported', row.id, {
            source: 'windows',
            holderName: record.holderName,
            expired: isExpired,
            batch: true,
          })
        }
      } catch (error) {
        errors += 1
        const message =
          error instanceof Error ? error.message : 'Falha ao importar certificado do Windows'
        items.push({
          thumbprintSha1: record.thumbprintSha1.toUpperCase(),
          holderName: record.holderName,
          document: record.document,
          status: 'error',
          message,
          certificateId: null,
        })
        this.record('certificate.import_failed', null, {
          jobId,
          thumbprintSha1: record.thumbprintSha1.toUpperCase(),
          error: message,
        })
      }
      this.emit({
        jobId,
        total: targets.length + missingThumbprints.length,
        completed: missingThumbprints.length + index + 1,
        currentFile: record.holderName,
        success: imported,
        duplicates,
        errors,
        stage: 'saving',
      })
      // Libera o event loop entre certificados em lotes grandes.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    const finishedAt = new Date().toISOString()
    this.emit({
      jobId,
      total: targets.length + missingThumbprints.length,
      completed: targets.length + missingThumbprints.length,
      currentFile: null,
      success: imported,
      duplicates,
      errors,
      stage: 'done',
    })
    this.record('certificate.windows_batch_finished', null, {
      jobId,
      total: targets.length + missingThumbprints.length,
      imported,
      duplicates,
      errors,
      importAll,
      startedAt,
      finishedAt,
    })
    this.deps.onChanged?.()
    return {
      total: targets.length + missingThumbprints.length,
      imported,
      duplicates,
      errors,
      certificates: touched.map((id) => getCertificateView(this.deps.db, id)),
      items,
    }
  }

  async exportBackup(id: string, passphrase: string, filePath: string): Promise<{ path: string }> {
    const row = getCertificateRow(this.deps.db, id)
    if (!row.pfxEnc) {
      throw new AppError('UNAVAILABLE', 'Certificado importado do Windows nao possui PFX no cofre')
    }
    const pfx = this.deps.vault.openPfx(id, row.pfxEnc)
    const serialized = await encryptBackup(pfx, passphrase)
    await writeFile(filePath, serialized, { encoding: 'utf8', mode: 0o600 })
    this.record('backup.created', id, { scope: 'certificate-pfx' })
    return { path: filePath }
  }

  async test(id: string): Promise<CertificateTestResult> {
    if (!this.deps.testCertificate) {
      return {
        ok: false,
        presentedThumbprintSha256: null,
        expectedThumbprintSha256: getCertificateRow(this.deps.db, id).thumbprintSha256,
        message: 'Teste de injecao indisponivel neste ambiente.',
        testedAt: new Date().toISOString(),
      }
    }
    const result = await this.deps.testCertificate(id)
    this.record('certificate.test_completed', id, {
      ok: result.ok,
      presentedThumbprint: result.presentedThumbprintSha256,
    })
    return result
  }

  private assertConsent(clientId: string | null, consent: boolean): void {
    if (clientId && !consent) {
      throw new AppError(
        'FORBIDDEN',
        'Consentimento obrigatorio',
        'Confirme a autorizacao do titular antes de vincular um certificado.',
      )
    }
  }

  private emptyReport(jobId: string, total: number, startedAt: string): ImportReport {
    return {
      jobId,
      total,
      success: 0,
      duplicates: 0,
      errors: 0,
      expired: 0,
      items: [],
      startedAt,
      finishedAt: startedAt,
    }
  }

  private applyItemToReport(report: ImportReport, item: ImportItemResult): void {
    report.items.push(item)
    if (item.status === 'success') report.success += 1
    else if (item.status === 'duplicate') report.duplicates += 1
    else if (item.status === 'expired') report.expired += 1
    else report.errors += 1
  }

  private emit(progress: ImportProgressEvent): void {
    this.deps.onImportProgress?.(progress)
  }

  private record(type: string, entityId: string | null, metadata: Record<string, unknown>): void {
    try {
      appendAuditEvent(this.deps.db, {
        type,
        entity: 'certificate',
        entityId,
        metadata,
      })
    } catch (error) {
      logger.warn('audit.append_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
