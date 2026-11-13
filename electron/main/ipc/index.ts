import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z, type ZodType } from 'zod'
import type { IpcResponse } from '../../../shared/ipc'
import {
  IPC,
  auditExportSchema,
  auditFilterSchema,
  certificateExportBackupSchema,
  certificateFilterSchema,
  certificateIdSchema,
  certificateImportBatchSchema,
  certificateImportSchema,
  certificateLinkSchema,
  certificateUninstallSchema,
  certificateUnlinkSchema,
  clientFilterSchema,
  clientInputSchema,
  clientNoteCreateSchema,
  clientNoteDeleteSchema,
  clientNoteListSchema,
  clientNoteUpdateSchema,
  cnpjLookupSchema,
  credentialCreateSchema,
  credentialFilterSchema,
  departmentInputSchema,
  departmentSetActiveSchema,
  holidayIdSchema,
  holidayInputSchema,
  importFromWindowsSchema,
  listLinksByClientSchema,
  markNotificationReadSchema,
  obligationFilterSchema,
  obligationGroupIdSchema,
  obligationGroupInputSchema,
  obligationIdSchema,
  obligationInputSchema,
  obligationSetActiveSchema,
  applyGroupSchema,
  monthOverviewSchema,
  pasteLinksSchema,
  removeLinkSchema,
  setLinkSchema,
  setDeliverySchema,
  updateLinkSchema,
  passwordGeneratorSchema,
  pdfLoadPreviewSchema,
  pdfReleaseSchema,
  pdfRevealSchema,
  pdfSignSchema,
  pdfTestTsaSchema,
  recipeSaveSchema,
  recipeReRecordSchema,
  reportSavePdfSchema,
  serviceFilterSchema,
  serviceInputSchema,
  sessionExternalSchema,
  sessionIdSchema,
  sessionManualCredentialSchema,
  sessionNavigateSchema,
  sessionOpenSchema,
  sessionZoomSchema,
  settingsUpdateSchema,
  wizardIdSchema,
  wizardSaveSchema,
  wizardStartRecordSchema,
} from '../../../shared/contracts'
import type {
  AppInfo,
  AuditExportResult,
  Client,
  ClientFilter,
  CredentialCreateInput,
  CredentialUpdateInput,
  RecipeTestResult,
  Service,
  ServiceInput,
  UpdateCheckResult,
} from '../../../shared/types'
import type { RecipeDefinition } from '../../../shared/recipe'
import { BUILTIN_SERVICES } from '../../../shared/builtins'
import type { AppDatabase } from '../db/database'
import type { VaultService } from '../vault/service'
import type { CertificateService } from '../certificates/service'
import type { SessionManager } from '../sessions/manager'
import { TrustedContentsRegistry } from './trusted'
import { lookupCompanyByCnpj } from '../integrations/brasil-api'
import { refreshAllClientsFromBrasilApi } from '../clients/enrichment'
import { onlyDigits } from '../../../shared/validation'
import {
  archiveClientRecursively,
  getSettings,
  resetSettings,
  saveSettings,
  seedBuiltins,
} from '../db/seed'
import {
  createClient,
  createClientNote,
  deleteClientNote,
  getClient,
  getClientNoteRow,
  listClients,
  listClientNotes,
  setClientStatus,
  updateClient,
  updateClientNote,
} from '../db/repositories/clients'
import {
  createCredential,
  deleteCredential,
  getCredentialRow,
  listCredentials,
  revealCredential,
  setDefaultCredential,
  updateCredential,
} from '../db/repositories/credentials'
import {
  createService,
  deleteService,
  duplicateService,
  ensureUniqueSlug,
  getServiceRow,
  listServiceRows,
  mapService,
  setServiceLogo,
  updateService,
} from '../db/repositories/services'
import { buildAutoRecipe } from '../../../shared/custom-service'
import {
  applyGroup,
  addHoliday,
  createDepartment,
  createGroup,
  createObligation,
  deleteDepartment,
  deleteGroup,
  deleteObligation,
  listAllLinks,
  listDepartments,
  listGroups,
  listHolidays,
  listLinksByClient,
  listMonthOverview,
  listNotifications,
  listObligations,
  markAllNotificationsRead,
  markNotificationRead,
  clearReadNotifications,
  pasteLinks,
  removeHoliday,
  removeLink,
  setClientObligationLink,
  setDelivery,
  setDepartmentActive,
  setObligationActive,
  updateDepartment,
  updateGroup,
  updateLink,
  updateObligation,
} from '../db/repositories/obligations'
import type { AuthMethod } from '../../../shared/constants'
import {
  getRecipeByService,
  mapRecipeSummary,
  resetRecipe,
  saveRecipe,
} from '../db/repositories/recipes'
import {
  allAuditEvents,
  appendAuditEvent,
  countAuditEvents,
  listAuditEvents,
} from '../db/repositories/audit'
import { getCertificateRow, refreshWindowsPresence } from '../db/repositories/certificates'
import { AppError, asAppError } from '../errors'
import { logger } from '../logger'
import { generatePassword } from '../security/password'
import { fetchServiceFavicon, readLogoFile } from '../services/logo'
import { formatDocument, maskDocument } from '../../../shared/validation'
import { formatCentsToBRL } from '../../../shared/currency'

const idSchema = z.string().min(1).max(200)
const idPayloadSchema = z.object({ id: idSchema })
const idInputSchema = z.object({ id: idSchema, input: z.record(z.unknown()) })
const sessionIdPayload = sessionIdSchema
const serviceIdPayload = z.object({ serviceId: idSchema })

type Broadcast = (channel: string, payload: unknown) => void

export interface IpcHandlerDeps {
  db: AppDatabase
  vault: VaultService
  certificates: CertificateService
  sessions: SessionManager
  trusted: TrustedContentsRegistry
  broadcast: Broadcast
  databasePath: string
  /** Quando true, o app esta encerrando: handlers respondem SHUTTING_DOWN
   * sem tocar no banco (o banco fecha em before-quit antes do processo sair). */
  isShuttingDown?: () => boolean
}

function assertTrustedSender(event: IpcMainInvokeEvent, trusted: TrustedContentsRegistry): void {
  if (!trusted.has(event.sender)) {
    throw new AppError('FORBIDDEN', 'Origem IPC nao confiavel')
  }
  if (!event.senderFrame || event.senderFrame.parent) {
    throw new AppError('FORBIDDEN', 'IPC permitido apenas no frame principal da UI')
  }
}

function shuttingDownResponse(): IpcResponse<never> {
  return {
    ok: false,
    error: { code: 'SHUTTING_DOWN', message: 'O aplicativo está sendo encerrado.' },
  }
}

function toErrorResponse(error: unknown, isShuttingDown?: () => boolean): IpcResponse<never> {
  // Corrida de encerramento: se o app esta saindo, nao loga INTERNAL para
  // chamadas que apenas esbarram no banco ja fechado.
  if (isShuttingDown?.()) return shuttingDownResponse()
  const appError = asAppError(error)
  if (appError.code === 'INTERNAL') {
    logger.error('ipc.unhandled', {
      message: appError.message,
      name: appError.name,
    })
  }
  return {
    ok: false,
    error: {
      code: appError.code,
      message: appError.userMessage,
      details: appError.details,
    },
  }
}

async function prepareClientInput(
  input: z.input<typeof clientInputSchema>,
  db: AppDatabase,
): Promise<z.input<typeof clientInputSchema>> {
  if (input.name?.trim()) return input
  const document = onlyDigits(input.document)
  if (document.length !== 14) {
    return {
      ...input,
      name: input.name?.trim() || `Cliente ${document}`,
      type: input.type ?? (document.length === 14 ? 'PJ' : 'PF'),
    }
  }
  // Consentimento explícito do operador autoriza a consulta (cadastro em lote
  // marca consent:true; o botão "Buscar dados" do formulário é clique explícito).
  // O setting externalCnpjLookup continua valendo para consultas automáticas,
  // mas não bloqueia fluxos em que o operador autorizou na hora.
  // Apenas o CNPJ (14 dígitos) é enviado à Brasil API.
  const explicitConsent = input.consent === true
  const externalConsent = explicitConsent || getSettings(db).externalCnpjLookup
  const company = externalConsent ? await lookupCompanyByCnpj(document, { enabled: true }) : null
  if (externalConsent) {
    try {
      appendAuditEvent(db, {
        type: 'external.cnpj_lookup',
        entity: 'client',
        entityId: null,
        metadata: {
          provider: 'brasilapi.com.br',
          document: maskDocument(document),
          status: company ? 'ok' : 'unavailable',
          source: explicitConsent ? 'client_create_consent' : 'setting',
        },
      })
    } catch {
      // Auditoria nao deve bloquear o cadastro.
    }
  }
  return {
    ...input,
    type: input.type ?? 'PJ',
    name: company?.name || input.name?.trim() || `Cliente ${document}`,
    email: input.email ?? company?.email ?? null,
    phone: input.phone ?? company?.phone ?? null,
  }
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const { db, vault, certificates, sessions, trusted, broadcast, databasePath, isShuttingDown } =
    deps
  let brasilApiRefreshing = false

  const handle = <TInput, TResult>(
    channel: string,
    schema: ZodType<TInput> | null,
    fn: (input: TInput, event: IpcMainInvokeEvent) => TResult | Promise<TResult>,
  ): void => {
    ipcMain.handle(channel, async (event, raw): Promise<IpcResponse<TResult>> => {
      if (isShuttingDown?.()) return shuttingDownResponse()
      try {
        assertTrustedSender(event, trusted)
        const input = schema ? schema.parse(raw) : (undefined as TInput)
        return { ok: true, value: await fn(input, event) }
      } catch (error) {
        return toErrorResponse(error, isShuttingDown)
      }
    })
  }

  const audit = (
    type: string,
    entity: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ) => {
    try {
      appendAuditEvent(db, { type, entity, entityId, metadata })
    } catch (error) {
      logger.warn('audit.append_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const serviceView = (id: string): Service => {
    const row = getServiceRow(db, id)
    const recipe = getRecipeByService(db, id)
    const openSessions = sessions.list().filter((session) => session.serviceId === id).length
    const builtinLogo = BUILTIN_SERVICES.find((seed) => seed.id === id)?.logoAsset ?? null
    return mapService(
      row,
      recipe,
      openSessions,
      row.logoPath?.startsWith('data:') ? row.logoPath : builtinLogo,
    )
  }

  const saveCsv = async (
    event: IpcMainInvokeEvent,
    content: string,
    defaultName: string,
  ): Promise<string | null> => {
    const result = await saveDialogFor(event, {
      title: 'Exportar CSV',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, `\ufeff${content}`, { encoding: 'utf8', mode: 0o600 })
    return result.filePath
  }

  // ---------------------------------------------------------------------------
  // Clientes
  // ---------------------------------------------------------------------------
  handle(IPC.clients.list, clientFilterSchema, (filter) => listClients(db, filter as ClientFilter))
  handle(IPC.clients.get, idPayloadSchema, ({ id }) => getClient(db, id))
  handle(IPC.clients.create, clientInputSchema, async (input) => {
    const prepared = await prepareClientInput(input, db)

    const client = createClient(db, prepared)
    if (prepared.consent) {
      audit('client.consent_recorded', 'client', client.id, { source: 'creation' })
    }
    audit('client.created', 'client', client.id, { type: client.type })
    broadcast(IPC.events.clientsChanged, null)
    return client
  })
  handle(IPC.clients.update, idInputSchema, ({ id, input }) => {
    const client = updateClient(db, id, input)
    if (input.consent === true) {
      audit('client.consent_recorded', 'client', id, { source: 'update' })
    }
    audit('client.updated', 'client', id)
    broadcast(IPC.events.clientsChanged, null)
    return client
  })
  handle(IPC.clients.archive, idPayloadSchema, ({ id }) => {
    archiveClientRecursively(db, id)
    audit('client.archived', 'client', id)
    broadcast(IPC.events.clientsChanged, null)
    return getClient(db, id) as Client
  })
  handle(IPC.clients.restore, idPayloadSchema, ({ id }) => {
    const client = setClientStatus(db, id, 'active')
    audit('client.restored', 'client', id)
    broadcast(IPC.events.clientsChanged, null)
    return client
  })
  handle(IPC.clients.exportCsv, null, async (_input, event) => {
    const rows = listClients(db, { status: 'all' })
    const csv = [
      ['Tipo', 'Nome', 'Documento', 'Email', 'Telefone', 'Honorarios', 'Tags', 'Status', 'CriadoEm']
        .map(csvCell)
        .join(','),
      ...rows.map((client) =>
        [
          client.type,
          client.name,
          formatDocument(client.document),
          client.email ?? '',
          client.phone ?? '',
          client.honorariosCents === null ? '' : formatCentsToBRL(client.honorariosCents),
          client.tags.join('; '),
          client.status,
          client.createdAt,
        ]
          .map(csvCell)
          .join(','),
      ),
    ].join('\r\n')
    const filePath = await saveCsv(event, csv, `clientes-${dateStamp()}.csv`)
    if (!filePath) return { path: '', count: 0 }
    audit('audit.exported', 'client', null, { scope: 'clients-csv', count: rows.length })
    return { path: filePath, count: rows.length }
  })
  handle(IPC.clients.cnpjLookup, cnpjLookupSchema, async ({ document }) => {
    // A consulta manual e um consentimento explicito: o operador digitou o CNPJ
    // e acionou o botao "Buscar dados" no formulario do cliente.
    const company = await lookupCompanyByCnpj(document, { enabled: true })
    try {
      appendAuditEvent(db, {
        type: 'external.cnpj_lookup',
        entity: 'client',
        entityId: null,
        metadata: {
          provider: 'brasilapi.com.br',
          document: maskDocument(document),
          source: 'client_form',
          status: company ? 'ok' : 'unavailable',
        },
      })
    } catch {
      // Auditoria nao deve bloquear a consulta.
    }
    if (!company) {
      throw new AppError(
        'NOT_FOUND',
        'CNPJ não encontrado na base pública (brasilapi.com.br). Confira o número e tente novamente em alguns segundos, ou preencha os dados manualmente.',
      )
    }
    return company
  })
  handle(IPC.clients.refreshFromBrasilApi, null, async () => {
    // Consentimento explícito: o operador acionou "Atualizar todos (Brasil API)"
    // na lista de clientes. Apenas os CNPJs são enviados; a atualização toca
    // somente o cadastro (nome/e-mail/telefone) — certificados, credenciais e
    // sessões não são alterados.
    if (brasilApiRefreshing) {
      throw new AppError('CONFLICT', 'Aguarde a atualização em andamento concluir')
    }
    brasilApiRefreshing = true
    try {
      const report = await refreshAllClientsFromBrasilApi(db, {
        lookup: lookupCompanyByCnpj,
        onAudit: (type, entity, entityId, metadata) => audit(type, entity, entityId, metadata),
        onProgress: (progress) => broadcast(IPC.events.clientsRefreshProgress, progress),
      })
      audit('client.brasil_api_refresh_finished', 'client', null, {
        total: report.total,
        updated: report.updated,
        skipped: report.skipped,
        errors: report.errors,
      })
      broadcast(IPC.events.clientsChanged, null)
      return report
    } finally {
      brasilApiRefreshing = false
    }
  })
  handle(IPC.clients.listNotes, clientNoteListSchema, ({ clientId }) =>
    listClientNotes(db, clientId),
  )
  handle(IPC.clients.createNote, clientNoteCreateSchema, ({ clientId, text }) => {
    const note = createClientNote(db, clientId, text)
    audit('client.note_created', 'client', clientId, { noteId: note.id })
    broadcast(IPC.events.clientsChanged, null)
    return note
  })
  handle(IPC.clients.updateNote, clientNoteUpdateSchema, ({ id, text }) => {
    const existing = getClientNoteRow(db, id)
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Nota nao encontrada')
    }
    const note = updateClientNote(db, id, text)
    audit('client.note_updated', 'client', existing.clientId, { noteId: note.id })
    broadcast(IPC.events.clientsChanged, null)
    return note
  })
  handle(IPC.clients.deleteNote, clientNoteDeleteSchema, ({ id }) => {
    const existing = getClientNoteRow(db, id)
    if (!existing) {
      throw new AppError('NOT_FOUND', 'Nota nao encontrada')
    }
    deleteClientNote(db, id)
    audit('client.note_deleted', 'client', existing.clientId, { noteId: id })
    broadcast(IPC.events.clientsChanged, null)
    return undefined as void
  })

  // ---------------------------------------------------------------------------
  // Obrigações
  // ---------------------------------------------------------------------------
  const obligationsChanged = () => broadcast(IPC.events.obligationsChanged, null)
  const notificationsChanged = () => broadcast(IPC.events.notificationsChanged, null)

  handle(IPC.obligations.listDepartments, null, () => listDepartments(db))
  handle(IPC.obligations.createDepartment, departmentInputSchema, (input) => {
    const department = createDepartment(db, input)
    audit('department.created', 'department', department.id, { name: department.name })
    obligationsChanged()
    return department
  })
  handle(IPC.obligations.updateDepartment, idInputSchema, ({ id, input }) => {
    const department = updateDepartment(db, id, input)
    audit('department.updated', 'department', id)
    obligationsChanged()
    return department
  })
  handle(IPC.obligations.setDepartmentActive, departmentSetActiveSchema, ({ id, active }) => {
    const department = setDepartmentActive(db, id, active)
    audit(active ? 'department.reactivated' : 'department.inactivated', 'department', id)
    obligationsChanged()
    return department
  })
  handle(IPC.obligations.deleteDepartment, idPayloadSchema, ({ id }) => {
    deleteDepartment(db, id)
    audit('department.deleted', 'department', id)
    obligationsChanged()
    return undefined as void
  })

  handle(IPC.obligations.listObligations, obligationFilterSchema, (filter) =>
    listObligations(db, filter),
  )
  handle(IPC.obligations.createObligation, obligationInputSchema, (input) => {
    const obligation = createObligation(db, input)
    audit('obligation.created', 'obligation', obligation.id, {
      sigla: obligation.sigla,
      departmentId: obligation.departmentId,
    })
    obligationsChanged()
    return obligation
  })
  handle(IPC.obligations.updateObligation, idInputSchema, ({ id, input }) => {
    const obligation = updateObligation(db, id, input)
    audit('obligation.updated', 'obligation', id)
    obligationsChanged()
    return obligation
  })
  handle(IPC.obligations.setObligationActive, obligationSetActiveSchema, ({ id, active }) => {
    const obligation = setObligationActive(db, id, active)
    audit(active ? 'obligation.reactivated' : 'obligation.inactivated', 'obligation', id)
    obligationsChanged()
    return obligation
  })
  handle(IPC.obligations.deleteObligation, obligationIdSchema, ({ id }) => {
    const result = deleteObligation(db, id)
    audit('obligation.deleted', 'obligation', id, {
      deletedInactiveLinks: result.deletedInactiveLinks,
    })
    obligationsChanged()
    return undefined as void
  })

  handle(IPC.obligations.listGroups, null, () => listGroups(db))
  handle(IPC.obligations.createGroup, obligationGroupInputSchema, (input) => {
    const group = createGroup(db, input)
    audit('obligation_group.created', 'obligation_group', group.id, {
      name: group.name,
      obligations: group.obligationIds.length,
    })
    obligationsChanged()
    return group
  })
  handle(IPC.obligations.updateGroup, idInputSchema, ({ id, input }) => {
    const group = updateGroup(db, id, input)
    audit('obligation_group.updated', 'obligation_group', id)
    obligationsChanged()
    return group
  })
  handle(IPC.obligations.deleteGroup, obligationGroupIdSchema, ({ id }) => {
    deleteGroup(db, id)
    audit('obligation_group.deleted', 'obligation_group', id)
    obligationsChanged()
    return undefined as void
  })
  handle(IPC.obligations.applyGroup, applyGroupSchema, (input) => {
    const result = applyGroup(db, input)
    audit('obligation_group.applied', 'obligation_group', input.groupId, {
      clients: new Set(input.clientIds).size,
      ...result,
    })
    obligationsChanged()
    return result
  })

  handle(IPC.obligations.listLinks, null, () => listAllLinks(db))
  handle(IPC.obligations.listLinksByClient, listLinksByClientSchema, ({ clientId }) =>
    listLinksByClient(db, clientId),
  )
  handle(IPC.obligations.setLink, setLinkSchema, ({ clientId, obligationId, active }) => {
    const result = setClientObligationLink(db, { clientId, obligationId, active })
    if (result.changed) {
      if (result.created) {
        audit('obligation_link.created', 'client', clientId, { obligationId })
      } else if (result.reactivated) {
        audit('obligation_link.reactivated', 'client', clientId, { obligationId })
      } else {
        audit('obligation_link.removed', 'client', clientId, { obligationId })
      }
    }
    obligationsChanged()
    return result
  })
  handle(IPC.obligations.updateLink, updateLinkSchema, ({ id, ...rest }) => {
    const link = updateLink(db, { id, ...rest })
    audit('obligation_link.updated', 'client', link.clientId, { obligationId: link.obligationId })
    obligationsChanged()
    return link
  })
  handle(IPC.obligations.removeLink, removeLinkSchema, ({ id }) => {
    const removed = removeLink(db, id)
    audit('obligation_link.deleted', 'client', removed.clientId, {
      obligationId: removed.obligationId,
    })
    obligationsChanged()
    return undefined as void
  })
  handle(IPC.obligations.pasteLinks, pasteLinksSchema, (input) => {
    const result = pasteLinks(db, input)
    audit('obligation_link.pasted', 'client', input.targetClientId, { ...result })
    obligationsChanged()
    return result
  })
  handle(IPC.obligations.listMonth, monthOverviewSchema, ({ month }) =>
    listMonthOverview(db, month),
  )
  handle(IPC.obligations.setDelivery, setDeliverySchema, (input) => {
    const result = setDelivery(db, input)
    audit(
      result.delivered ? 'obligation_delivery.completed' : 'obligation_delivery.reverted',
      'client',
      input.clientId,
      { obligationId: input.obligationId, dueDate: input.dueDate },
    )
    obligationsChanged()
    return result
  })

  handle(IPC.obligations.listNotifications, null, () => listNotifications(db))
  handle(IPC.obligations.markNotificationRead, markNotificationReadSchema, ({ id }) => {
    markNotificationRead(db, id)
    notificationsChanged()
    return undefined as void
  })
  handle(IPC.obligations.markAllNotificationsRead, null, () => {
    markAllNotificationsRead(db)
    notificationsChanged()
    return undefined as void
  })
  handle(IPC.obligations.clearReadNotifications, null, () => {
    clearReadNotifications(db)
    notificationsChanged()
    return undefined as void
  })

  handle(IPC.obligations.listHolidays, null, () => listHolidays(db))
  handle(IPC.obligations.addHoliday, holidayInputSchema, (input) => {
    const holiday = addHoliday(db, input)
    audit('holiday.added', 'holiday', holiday.id, {
      date: holiday.date,
      name: holiday.name,
      icon: holiday.icon,
      color: holiday.color,
    })
    obligationsChanged()
    return holiday
  })
  handle(IPC.obligations.removeHoliday, holidayIdSchema, ({ id }) => {
    removeHoliday(db, id)
    audit('holiday.removed', 'holiday', id)
    obligationsChanged()
    return undefined as void
  })

  // ---------------------------------------------------------------------------
  // Credenciais
  // ---------------------------------------------------------------------------
  handle(IPC.credentials.list, credentialFilterSchema, (filter) => listCredentials(db, filter))
  handle(IPC.credentials.create, credentialCreateSchema, (input) => {
    const credential = createCredential(db, vault, input as CredentialCreateInput)
    audit('credential.created', 'credential', credential.id, {
      clientId: credential.clientId,
      serviceId: credential.serviceId,
    })
    return credential
  })
  handle(IPC.credentials.update, idInputSchema, ({ id, input }) => {
    const credential = updateCredential(db, vault, id, input as CredentialUpdateInput)
    audit('credential.updated', 'credential', id, {
      passwordChanged: input.password !== undefined,
    })
    return credential
  })
  handle(IPC.credentials.delete, idPayloadSchema, ({ id }) => {
    const row = getCredentialRow(db, id)
    deleteCredential(db, id)
    audit('credential.deleted', 'credential', id, {
      clientId: row.clientId,
      serviceId: row.serviceId,
    })
    return undefined
  })
  handle(IPC.credentials.reveal, idPayloadSchema, ({ id }) => {
    throttled(`reveal:${id}`, 800)
    const secret = revealCredential(db, vault, id)
    const settings = getSettings(db)
    audit('credential.revealed', 'credential', id, { reason: 'manual-reveal' })
    return {
      password: secret.password,
      expiresAt: new Date(Date.now() + settings.passwordRevealSeconds * 1000).toISOString(),
    }
  })
  handle(IPC.credentials.copy, idPayloadSchema, ({ id }) => {
    throttled(`copy:${id}`, 800)
    const secret = revealCredential(db, vault, id)
    const settings = getSettings(db)
    const copied = secret.password
    void clipboard.writeText(copied)
    setTimeout(() => {
      void clipboard
        .readText()
        .then((current) => {
          if (current === copied) clipboard.clear()
        })
        .catch(() => {
          // A area de transferencia pode estar indisponivel durante o encerramento.
        })
    }, settings.clipboardClearSeconds * 1000).unref()
    audit('credential.copied', 'credential', id, {
      clearAfterSeconds: settings.clipboardClearSeconds,
    })
    return {
      expiresAt: new Date(Date.now() + settings.clipboardClearSeconds * 1000).toISOString(),
    }
  })
  handle(IPC.credentials.generate, passwordGeneratorSchema.partial(), (options) => {
    const generated = generatePassword(options)
    audit('credential.password_generated', 'credential', null, {
      length: generated.password.length,
    })
    return generated
  })
  handle(IPC.credentials.setDefault, idPayloadSchema, ({ id }) => {
    const credential = setDefaultCredential(db, id)
    audit('credential.default_changed', 'credential', id, { clientId: credential.clientId })
    return credential
  })

  // ---------------------------------------------------------------------------
  // Certificados
  // ---------------------------------------------------------------------------
  handle(IPC.certificates.list, certificateFilterSchema, (filter) => certificates.list(filter))
  handle(IPC.certificates.get, certificateIdSchema, ({ id }) => certificates.get(id))
  handle(IPC.certificates.details, certificateIdSchema, ({ id }) => certificates.details(id))
  handle(IPC.certificates.stats, null, () => certificates.stats())
  handle(IPC.certificates.refreshAll, null, async () => {
    // Revarredura completa: atualiza a presença dos certificados no Windows e
    // retorna a lista ja enriquecida (status de vencimento, renovacao, etc.)
    // recalculada sobre o universo completo.
    await refreshWindowsPresence(db, new Set())
    const list = certificates.list({})
    const stats = certificates.stats()
    broadcast(IPC.events.certificatesChanged, null)
    return { certificates: list, stats }
  })
  handle(IPC.certificates.pickPfxFiles, null, async (_input, event) => {
    const result = await openDialogFor(event, {
      title: 'Selecionar certificados A1',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Certificados PFX/P12', extensions: ['pfx', 'p12'] }],
    })
    return result.canceled ? [] : result.filePaths
  })
  handle(IPC.certificates.import, certificateImportSchema, (input) =>
    certificates.importSingle({ ...input, install: input.install ?? true }),
  )
  handle(IPC.certificates.importBatch, certificateImportBatchSchema, (input) =>
    certificates.importBatch({ ...input, install: input.install ?? true }),
  )
  handle(IPC.certificates.listWindows, null, async () => {
    try {
      return await certificates.listWindows()
    } catch (error) {
      throw new AppError(
        'UNAVAILABLE',
        error instanceof Error ? error.message : 'Falha ao listar certificados do Windows',
        'Nao foi possivel ler o repositorio de certificados do Windows.',
      )
    }
  })
  handle(IPC.certificates.importFromWindows, importFromWindowsSchema, (input) =>
    certificates.importFromWindows(input),
  )
  handle(IPC.certificates.install, certificateIdSchema, ({ id }) => certificates.install(id))
  handle(IPC.certificates.uninstall, certificateUninstallSchema, (input) =>
    certificates.uninstall(input),
  )
  handle(IPC.certificates.test, certificateIdSchema, async ({ id }) => {
    const certificate = certificates.get(id)
    if (!certificate.installed) await certificates.install(id)
    return certificates.test(id)
  })
  handle(IPC.certificates.linkClient, certificateLinkSchema, (input) =>
    certificates.linkClient(input),
  )
  handle(IPC.certificates.unlinkClient, certificateUnlinkSchema, (input) =>
    certificates.unlinkClient(input),
  )
  handle(IPC.certificates.exportBackup, certificateExportBackupSchema, async (input, event) => {
    const certificate = certificates.get(input.id)
    const result = await saveDialogFor(event, {
      title: 'Exportar backup criptografado do certificado',
      defaultPath: path.join(
        app.getPath('documents'),
        `${safeFilename(certificate.holderName)}-${dateStamp()}.pvbackup`,
      ),
      filters: [{ name: 'Backup AurumBit Portal', extensions: ['pvbackup'] }],
    })
    if (result.canceled || !result.filePath) {
      throw new AppError('UNAVAILABLE', 'Exportacao cancelada')
    }
    return certificates.exportBackup(input.id, input.passphrase, result.filePath)
  })

  // ---------------------------------------------------------------------------
  // Servicos
  // ---------------------------------------------------------------------------
  handle(IPC.services.list, serviceFilterSchema, (filter) =>
    listServiceRows(db, filter).map((row) => serviceView(row.id)),
  )
  handle(IPC.services.get, idPayloadSchema, ({ id }) => serviceView(id))
  handle(IPC.services.create, serviceInputSchema as any, (input) => {
    // Slug único por baixo dos panos: o usuário comum não vê nem edita o slug.
    const requested = input as ServiceInput
    const row = createService(db, { ...requested, slug: ensureUniqueSlug(db, requested.slug) })
    // Automação de login gerada automaticamente ("por baixo dos panos").
    // Nunca bloqueia o cadastro: se falhar, o site é criado mesmo assim e o
    // usuário pode gerar a automação em seguida em Avançado.
    try {
      const autoRecipe = buildAutoRecipe({
        slug: row.slug,
        baseUrl: row.baseUrl,
        authMethods: row.authMethods as AuthMethod[],
      })
      const recipe = saveRecipe(db, row.id, autoRecipe)
      audit('recipe.auto_generated', 'recipe', recipe.id, {
        serviceId: row.id,
        slug: row.slug,
        auth: autoRecipe.auth,
      })
    } catch (error) {
      logger.warn('recipe.auto_generate_failed', {
        serviceId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    audit('service.created', 'service', row.id, { slug: row.slug })
    broadcast(IPC.events.servicesChanged, null)
    return serviceView(row.id)
  })
  handle(IPC.services.update, idInputSchema, ({ id, input }) => {
    updateService(db, id, input)
    audit('service.updated', 'service', id)
    broadcast(IPC.events.servicesChanged, null)
    return serviceView(id)
  })
  handle(IPC.services.delete, idPayloadSchema, ({ id }) => {
    deleteService(db, id)
    audit('service.deleted', 'service', id)
    broadcast(IPC.events.servicesChanged, null)
    return undefined
  })
  handle(IPC.services.duplicate, idPayloadSchema, ({ id }) => {
    const row = duplicateService(db, id)
    audit('service.created', 'service', row.id, { duplicatedFrom: id })
    broadcast(IPC.events.servicesChanged, null)
    return serviceView(row.id)
  })
  handle(IPC.services.restoreBuiltins, null, () => {
    seedBuiltins(db, true)
    audit('service.restored', 'service', null, { scope: 'builtins' })
    broadcast(IPC.events.servicesChanged, null)
    return listServiceRows(db).map((row) => serviceView(row.id))
  })
  handle(IPC.services.fetchLogo, idPayloadSchema, async ({ id }) => {
    const row = getServiceRow(db, id)
    const dataUrl = await fetchServiceFavicon(row)
    const updated = setServiceLogo(db, id, dataUrl)
    audit('service.updated', 'service', id, { field: 'logo', source: 'favicon' })
    broadcast(IPC.events.servicesChanged, null)
    return mapService(
      updated,
      getRecipeByService(db, id),
      sessions.list().filter((session) => session.serviceId === id).length,
      dataUrl,
    )
  })
  handle(IPC.services.uploadLogo, idPayloadSchema, async ({ id }, event) => {
    const result = await openDialogFor(event, {
      title: 'Enviar logomarca',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'svg'] }],
    })
    if (result.canceled || !result.filePaths[0]) {
      throw new AppError('UNAVAILABLE', 'Envio cancelado')
    }
    const dataUrl = await readLogoFile(result.filePaths[0])
    const updated = setServiceLogo(db, id, dataUrl)
    audit('service.updated', 'service', id, { field: 'logo', source: 'upload' })
    broadcast(IPC.events.servicesChanged, null)
    return mapService(
      updated,
      getRecipeByService(db, id),
      sessions.list().filter((session) => session.serviceId === id).length,
      dataUrl,
    )
  })

  // ---------------------------------------------------------------------------
  // Receitas
  // ---------------------------------------------------------------------------
  handle(IPC.recipes.get, serviceIdPayload, ({ serviceId }) => {
    const row = getRecipeByService(db, serviceId)
    return row ? mapRecipeSummary(row) : null
  })
  handle(IPC.recipes.save, recipeSaveSchema, ({ serviceId, definition }) => {
    const recipe = saveRecipe(db, serviceId, definition as RecipeDefinition)
    audit('recipe.updated', 'recipe', recipe.id, { serviceId, version: recipe.version })
    broadcast(IPC.events.servicesChanged, null)
    return recipe
  })
  handle(IPC.recipes.reset, serviceIdPayload, ({ serviceId }) => {
    const recipe = resetRecipe(db, serviceId)
    if (recipe) audit('recipe.updated', 'recipe', recipe.id, { serviceId, reset: true })
    broadcast(IPC.events.servicesChanged, null)
    return recipe
  })
  handle(IPC.recipes.test, serviceIdPayload, async ({ serviceId }) => {
    const service = getServiceRow(db, serviceId)
    const recipe = getRecipeByService(db, serviceId)
    const testedAt = new Date().toISOString()
    if (!recipe) {
      return {
        ok: false,
        status: 'disabled',
        message: 'Nenhuma receita cadastrada para este servico.',
        failedStep: null,
        testedAt,
      } satisfies RecipeTestResult
    }
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(service.baseUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'AurumBitPortal/0.1 recipe-test' },
      }).finally(() => clearTimeout(timer))
      const reachable = response.status < 500
      return {
        ok: reachable,
        status: recipe.status,
        message: reachable
          ? 'Portal alcancavel. A homologacao do fluxo real exige abrir uma sessao e concluir o login.'
          : `Portal respondeu HTTP ${response.status}; a receita pode estar desatualizada.`,
        failedStep: null,
        testedAt,
      } satisfies RecipeTestResult
    } catch (error) {
      return {
        ok: false,
        status: recipe.status,
        message:
          error instanceof Error
            ? `Falha de conectividade: ${error.message}`
            : 'Falha de conectividade ao testar o portal.',
        failedStep: null,
        testedAt,
      } satisfies RecipeTestResult
    }
  })

  // ---------------------------------------------------------------------------
  // Gravação Assistida (Fase 1) — wizard de gravação + reRecord
  // ---------------------------------------------------------------------------
  handle(IPC.wizard.startRecord, wizardStartRecordSchema, async (input) => {
    return sessions.openRecorder({
      serviceId: input.serviceId,
      clientId: input.clientId,
      authMethod: input.authMethod,
      credentialId: input.credentialId ?? null,
    })
  })
  handle(IPC.wizard.state, wizardIdSchema, ({ wizardId }) => sessions.getWizardState(wizardId))
  handle(IPC.wizard.finish, wizardIdSchema, async ({ wizardId }) =>
    sessions.finishRecorder(wizardId, { reason: 'Gravação concluída pelo assistente' }),
  )
  handle(IPC.wizard.cancel, wizardIdSchema, ({ wizardId }) => {
    sessions.cancelRecorder(wizardId)
    return undefined
  })
  handle(IPC.wizard.save, wizardSaveSchema, ({ wizardId, autoSubmit, removedStepIndexes }) => {
    const recipe = sessions.saveRecordedRecipe(wizardId, { autoSubmit, removedStepIndexes })
    audit('recipe.updated', 'recipe', recipe.id, {
      serviceId: recipe.serviceId,
      version: recipe.version,
      origin: 'recorded',
    })
    broadcast(IPC.events.servicesChanged, null)
    return recipe
  })
  handle(IPC.wizard.discard, wizardIdSchema, ({ wizardId }) => {
    sessions.discardRecorded(wizardId)
    return undefined
  })
  handle(IPC.recipes.reRecord, recipeReRecordSchema, async (input) => {
    const service = getServiceRow(db, input.serviceId)
    if (service.isBuiltin) {
      throw new AppError(
        'FORBIDDEN',
        'Serviços nativos mantêm a automação de fábrica (use "Regenerar automação").',
      )
    }
    return sessions.openRecorder({
      serviceId: input.serviceId,
      clientId: input.clientId,
      authMethod: input.authMethod,
      credentialId: input.credentialId ?? null,
    })
  })

  // ---------------------------------------------------------------------------
  // Sessoes
  // ---------------------------------------------------------------------------
  handle(IPC.sessions.open, sessionOpenSchema, (input) => sessions.open(input))
  handle(IPC.sessions.focus, sessionIdPayload, ({ sessionId }) => {
    sessions.focus(sessionId)
    return undefined
  })
  handle(IPC.sessions.close, sessionIdPayload, ({ sessionId }) => {
    sessions.close(sessionId)
    return undefined
  })
  handle(IPC.sessions.list, null, () => sessions.list())
  handle(IPC.sessions.details, sessionIdPayload, ({ sessionId }) => sessions.details(sessionId))
  handle(IPC.sessions.navigate, sessionNavigateSchema, ({ sessionId, url }) => {
    sessions.navigate(sessionId, url)
    return undefined
  })
  handle(IPC.sessions.reload, sessionIdPayload, ({ sessionId }) => {
    sessions.reload(sessionId)
    return undefined
  })
  handle(IPC.sessions.stop, sessionIdPayload, ({ sessionId }) => {
    sessions.stop(sessionId)
    return undefined
  })
  handle(IPC.sessions.back, sessionIdPayload, ({ sessionId }) => {
    sessions.back(sessionId)
    return undefined
  })
  handle(IPC.sessions.forward, sessionIdPayload, ({ sessionId }) => {
    sessions.forward(sessionId)
    return undefined
  })
  handle(IPC.sessions.setZoom, sessionZoomSchema, ({ sessionId, zoomFactor }) => {
    sessions.setZoom(sessionId, zoomFactor)
    return undefined
  })
  handle(IPC.sessions.openExternal, sessionExternalSchema, async ({ sessionId, url }) => {
    await sessions.openExternal(sessionId, url)
    return undefined
  })
  handle(IPC.sessions.getCredentialForManual, sessionManualCredentialSchema, (input) =>
    sessions.getCredentialForManual(input.sessionId, input.credentialId, input.field),
  )
  handle(IPC.sessions.retryRecipe, sessionIdPayload, ({ sessionId }) =>
    sessions.retryRecipe(sessionId),
  )
  handle(IPC.sessions.reveal, sessionIdPayload, ({ sessionId }) => {
    sessions.reveal(sessionId)
    return undefined
  })

  // ---------------------------------------------------------------------------
  // Configuracoes e auditoria
  // ---------------------------------------------------------------------------
  handle(IPC.settings.get, null, () => getSettings(db))
  handle(IPC.settings.set, settingsUpdateSchema, (patch) => {
    const next = saveSettings(db, patch)
    audit('settings.updated', 'settings', null, { keys: Object.keys(patch) })
    return next
  })
  handle(IPC.settings.reset, null, () => {
    const next = resetSettings(db)
    audit('settings.updated', 'settings', null, { reset: true })
    return next
  })
  handle(IPC.reports.savePdf, reportSavePdfSchema, async (input, event) => {
    const bytes = Buffer.from(input.dataBase64, 'base64')
    if (bytes.length === 0) {
      throw new AppError('VALIDATION', 'PDF vazio', 'Nenhum dado foi recebido.')
    }
    if (bytes.length > 5 * 1024 * 1024) {
      throw new AppError('VALIDATION', 'PDF muito grande', 'Use no máximo 5 MB por relatório.')
    }
    if (!bytes.subarray(0, 5).toString('utf8').startsWith('%PDF-')) {
      throw new AppError('VALIDATION', 'Arquivo inválido', 'O conteúdo não é um PDF.')
    }
    const filename = `${safeFilename(path.parse(input.filename || 'relatorio').name) || 'relatorio'}.pdf`
    const result = await saveDialogFor(event, {
      title: 'Salvar relatório (PDF)',
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) {
      throw new AppError('UNAVAILABLE', 'Exportação cancelada')
    }
    await writeFile(result.filePath, bytes, { mode: 0o600 })
    audit('report.pdf_exported', 'report', null, {
      title: input.title ?? null,
      trackingCode: input.trackingCode ?? null,
      sizeBytes: bytes.length,
    })
    return { path: result.filePath, trackingCode: input.trackingCode ?? null }
  })
  handle(IPC.audit.list, auditFilterSchema, (filter) => listAuditEvents(db, filter))
  handle(IPC.audit.export, auditExportSchema, async (input, event): Promise<AuditExportResult> => {
    const events = allAuditEvents(db, input.filter)
    const extension = input.format
    const result = await saveDialogFor(event, {
      title: `Exportar auditoria (${extension.toUpperCase()})`,
      defaultPath: path.join(
        app.getPath('documents'),
        `auditoria-aurumbit-portal-${dateStamp()}.${extension}`,
      ),
      filters: [
        {
          name: input.format === 'csv' ? 'CSV' : 'JSON',
          extensions: [extension],
        },
      ],
    })
    if (result.canceled || !result.filePath) {
      throw new AppError('UNAVAILABLE', 'Exportacao cancelada')
    }
    const payload =
      input.format === 'csv'
        ? `\ufeff${[
            ['Data', 'Tipo', 'Entidade', 'EntidadeId', 'Metadados'].map(csvCell).join(','),
            ...events.map((auditEvent) =>
              [
                auditEvent.createdAt,
                auditEvent.type,
                auditEvent.entity,
                auditEvent.entityId ?? '',
                JSON.stringify(auditEvent.metadata),
              ]
                .map(csvCell)
                .join(','),
            ),
          ].join('\r\n')}`
        : JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              application: 'AurumBit Portal',
              count: events.length,
              events,
            },
            null,
            2,
          )
    await writeFile(result.filePath, payload, { encoding: 'utf8', mode: 0o600 })
    audit('audit.exported', 'audit', null, {
      format: input.format,
      count: events.length,
    })
    return { path: result.filePath, count: events.length }
  })

  // ---------------------------------------------------------------------------
  // Aplicativo
  // ---------------------------------------------------------------------------
  let lastUpdateStatus: AppInfo['updateStatus'] = 'idle'

  handle(IPC.app.info, null, async (): Promise<AppInfo> => {
    let databaseSizeBytes = 0
    try {
      databaseSizeBytes = (await stat(databasePath)).size
    } catch {
      databaseSizeBytes = 0
    }
    return {
      name: app.getName(),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      isDev: Boolean(process.env.AURUMBIT_DEV_URL) || !app.isPackaged,
      safeStorageAvailable: safeStorage.isEncryptionAvailable(),
      databasePath,
      databaseSizeBytes,
      userDataPath: app.getPath('userData'),
      logsPath: app.getPath('logs'),
      auditCount: countAuditEvents(db),
      updateStatus: lastUpdateStatus,
    }
  })
  handle(IPC.app.lock, null, () => {
    sessions.closeAll()
    audit('app.locked', 'app', null, { reason: 'manual' })
    broadcast(IPC.events.appLocked, true)
    return undefined
  })
  handle(IPC.app.unlock, null, () => {
    audit('app.unlocked', 'app', null)
    broadcast(IPC.events.appLocked, false)
    return undefined
  })
  handle(IPC.app.openLogs, null, async () => {
    await shell.openPath(app.getPath('logs'))
    return undefined
  })
  handle(IPC.app.checkUpdates, null, async (): Promise<UpdateCheckResult> => {
    if (!app.isPackaged) {
      lastUpdateStatus = 'disabled'
      return {
        status: 'disabled',
        version: null,
        message: 'Verificacao de atualizacoes desabilitada em desenvolvimento.',
      }
    }
    lastUpdateStatus = 'checking'
    broadcast(IPC.events.updateStatus, {
      status: 'checking',
      version: null,
      message: 'Verificando atualizacoes...',
    })
    try {
      const updaterModule = await import('electron-updater')
      const autoUpdater = updaterModule.autoUpdater
      autoUpdater.autoDownload = false
      autoUpdater.channel = getSettings(db).autoUpdateChannel
      const result = await Promise.race([
        autoUpdater.checkForUpdates(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('Tempo esgotado ao verificar atualizacoes')), 20_000),
        ),
      ])
      const version = result?.updateInfo?.version ?? null
      const available = Boolean(version && version !== app.getVersion())
      lastUpdateStatus = available ? 'available' : 'not-available'
      const response: UpdateCheckResult = {
        status: lastUpdateStatus,
        version,
        message: available
          ? `Atualizacao ${version} disponivel.`
          : 'Voce ja esta usando a versao mais recente deste canal.',
      }
      audit('update.checked', 'app', null, { status: response.status, version })
      broadcast(IPC.events.updateStatus, response)
      return response
    } catch (error) {
      lastUpdateStatus = 'error'
      const response: UpdateCheckResult = {
        status: 'error',
        version: null,
        message:
          error instanceof Error
            ? `Falha ao verificar atualizacoes: ${error.message}`
            : 'Falha ao verificar atualizacoes.',
      }
      audit('update.checked', 'app', null, { status: 'error' })
      broadcast(IPC.events.updateStatus, response)
      return response
    }
  })

  // ---------------------------------------------------------------------------
  // Assinatura de PDF (PAdES-B-T)
  // ---------------------------------------------------------------------------
  handle(IPC.pdf.pickFile, null, async (_input, event) => {
    const { pickPdfFile } = await import('../pdf/pick')
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    return pickPdfFile(parent)
  })
  handle(IPC.pdf.loadPreview, pdfLoadPreviewSchema, async ({ token }) => {
    const { getCachedPdf } = await import('../pdf/pick')
    const entry = await getCachedPdf(token)
    // Cópia exata do slice (evita vazar bytes da pool do Buffer além do arquivo).
    const copy = Buffer.from(entry.buffer)
    return {
      token,
      fileName: path.basename(entry.path),
      sizeBytes: entry.sizeBytes,
      data: copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
      pageCount: entry.pageCount,
    }
  })
  handle(IPC.pdf.release, pdfReleaseSchema, async ({ token }) => {
    const { releaseCachedPdf } = await import('../pdf/pick')
    releaseCachedPdf(token)
    return undefined as void
  })
  handle(IPC.pdf.reveal, pdfRevealSchema, async ({ path: targetPath }) => {
    const info = await stat(targetPath).catch(() => null)
    if (!info || !info.isFile()) {
      throw new AppError('NOT_FOUND', 'Arquivo assinado nao encontrado')
    }
    shell.showItemInFolder(targetPath)
    return undefined as void
  })
  handle(IPC.pdf.testTsa, pdfTestTsaSchema, async ({ url }) => {
    const { testTsa } = await import('../pdf/timestamp')
    const settings = getSettings(db)
    const tsaUrl = url ?? settings.signTsaUrl
    const result = await testTsa(tsaUrl)
    return { ok: result.ok, message: result.message, latencyMs: result.latencyMs, tsaUrl }
  })
  // Fila de 1 assinatura por vez (ADR 0008): evita corrida sobre o mesmo
  // token/buffer e pico de memória com PDFs grandes.
  let pdfSigning = false
  handle(IPC.pdf.sign, pdfSignSchema, async (input) => {
    if (pdfSigning) {
      throw new AppError('CONFLICT', 'Aguarde a assinatura em andamento concluir')
    }
    pdfSigning = true
    const { getCachedPdf, releaseCachedPdf } = await import('../pdf/pick')
    const { signPdfInWorker } = await import('../pdf/worker-client')
    let auditFileName: string | null = null
    const auditCertId: string | null = input.certificateId
    try {
      const entry = await getCachedPdf(input.token)
      auditFileName = path.basename(entry.path)

      const certRow = getCertificateRow(db, input.certificateId)
      if (!certRow) {
        throw new AppError('NOT_FOUND', 'Certificado nao encontrado')
      }
      const validToMs = new Date(certRow.validTo).getTime()
      if (Number.isNaN(validToMs) || validToMs <= Date.now()) {
        throw new AppError('CERTIFICATE_EXPIRED', 'Certificado vencido nao pode assinar')
      }
      // Material de assinatura SEM pedir arquivo/senha ao operador
      // (igual Adobe/SERPRO): usa o que a ferramenta já tem.
      //  1) PFX já selado no cofre (source pfx) — caminho rápido.
      //  2) Certificado instalado no Windows — exporta transitoriamente
      //     a chave privada para assinar, sem pedir PFX ao usuário.
      const hasVaultMaterial = Boolean(certRow.pfxEnc && certRow.pfxPasswordEnc)
      if (!hasVaultMaterial && !certRow.installed) {
        throw new AppError(
          'VALIDATION',
          'Certificado sem material de assinatura disponivel — verifique se esta instalado no Windows',
        )
      }
      // Revalidação extra: página contra o documento cacheado (evita stale do renderer).
      if (!Number.isInteger(input.page) || input.page < 1 || input.page > entry.pageCount) {
        throw new AppError(
          'VALIDATION',
          `Pagina ${input.page} fora do documento (1..${entry.pageCount})`,
        )
      }
      if (
        !Number.isFinite(input.xPct) ||
        !Number.isFinite(input.yPct) ||
        input.xPct < 0 ||
        input.xPct > 1 ||
        input.yPct < 0 ||
        input.yPct > 1
      ) {
        throw new AppError('VALIDATION', 'Posicao do carimbo invalida')
      }
      let pfx: Buffer | null = null
      let password: string | null = null
      let result: Awaited<ReturnType<typeof signPdfInWorker>>
      if (certRow.pfxEnc && certRow.pfxPasswordEnc) {
        try {
          pfx = vault.openPfx(certRow.id, certRow.pfxEnc)
          password = vault.openPfxPassword(certRow.id, certRow.pfxPasswordEnc)
        } catch {
          throw new AppError('CERTIFICATE_INVALID', 'Nao foi possivel abrir o PFX do cofre')
        }
      } else {
        // Certificado instalado no Windows sem PFX no cofre:
        // exporta transitoriamente a chave instalada (sem pedir arquivo/senha).
        const { exportPfxFromWindowsStore } = await import('../certificates/windows-store')
        try {
          const exported = await exportPfxFromWindowsStore(certRow.thumbprintSha1)
          pfx = exported.pfx
          password = exported.password
          audit('certificate.exported_for_signing', 'certificate', certRow.id, {
            source: certRow.source,
            stage: 'windows-export',
          })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message.slice(0, 300)
              : 'Falha ao usar o certificado instalado'
          audit('pdf.sign_failed', 'certificate', certRow.id, {
            fileName: auditFileName ?? 'desconhecido',
            error: message.slice(0, 200),
            stage: 'windows-export',
          })
          throw new AppError('CERTIFICATE_INVALID', message, message)
        }
      }

      const settings = getSettings(db)
      const tsaUrl = settings.signTsaUrl

      try {
        result = await signPdfInWorker({
          pfx,
          password,
          pdfBytes: entry.buffer,
          fileName: path.basename(entry.path),
          certificate: {
            holderName: certRow.holderName,
            document: certRow.document,
            documentType: certRow.documentType as 'CPF' | 'CNPJ' | 'OTHER',
            issuerDn: certRow.issuerDn,
            thumbprintSha256: certRow.thumbprintSha256,
            validTo: certRow.validTo,
          },
          page: input.page,
          xPct: input.xPct,
          yPct: input.yPct,
          size: input.size,
          widthPct: input.widthPct,
          heightPct: input.heightPct,
          tsaUrl,
        })
      } catch (error) {
        // Worker devolve mensagem PT-BR; preservar como userMessage para o
        // operador saber o que corrigir (fail-closed, sem INTERNAL genérico).
        const message =
          error instanceof Error ? error.message.slice(0, 300) : 'Falha ao assinar o PDF'
        audit('pdf.sign_failed', 'certificate', certRow.id, {
          fileName: auditFileName ?? path.basename(entry.path),
          error: message.slice(0, 200),
          stage: 'worker',
        })
        if (error instanceof AppError) throw error
        if (/tsa|carimbo de tempo|12 s|tempo esgotado|encerrou/i.test(message)) {
          throw new AppError('UNAVAILABLE', message, message)
        }
        if (/senha do pfx|chave privada|pfx/i.test(message)) {
          throw new AppError('CERTIFICATE_INVALID', message, message)
        }
        throw new AppError('VALIDATION', message, message)
      } finally {
        pfx?.fill(0)
      }

      const resultPdf =
        result.pdf && (result.pdf as unknown as Uint8Array).length > 0
          ? Buffer.isBuffer(result.pdf)
            ? (result.pdf as unknown as Buffer)
            : Buffer.from(result.pdf as unknown as Uint8Array)
          : null
      if (!resultPdf) {
        audit('pdf.sign_failed', 'certificate', certRow.id, {
          fileName: auditFileName ?? path.basename(entry.path),
          error: 'PDF assinado vazio (0 bytes)',
          stage: 'write',
        })
        throw new AppError(
          'VALIDATION',
          'PDF assinado vazio (0 bytes) — a assinatura nao gerou bytes',
        )
      }
      result.pdf = resultPdf as unknown as Buffer

      const dir = path.dirname(entry.path)
      const baseName = path.basename(entry.path, path.extname(entry.path))
      const ext = path.extname(entry.path) || '.pdf'
      let suffix = 1
      let targetPath = path.join(
        dir,
        `${baseName}-assinado${suffix > 1 ? ` (${suffix})` : ''}${ext}`,
      )
      try {
        while (true) {
          try {
            await writeFile(targetPath, result.pdf, { flag: 'wx', mode: 0o600 })
            break
          } catch (error) {
            const code =
              error instanceof Error && 'code' in error
                ? (error as NodeJS.ErrnoException).code
                : undefined
            if (code !== 'EEXIST') throw error
            suffix += 1
            targetPath = path.join(dir, `${baseName}-assinado (${suffix})${ext}`)
          }
        }
      } catch (error) {
        audit('pdf.sign_failed', 'certificate', certRow.id, {
          fileName: path.basename(entry.path),
          error:
            error instanceof Error ? error.message.slice(0, 200) : 'Falha ao gravar o PDF assinado',
          stage: 'write',
        })
        if (error instanceof AppError) throw error
        throw new AppError(
          'UNAVAILABLE',
          'Nao foi possivel gravar o PDF assinado — verifique pasta e permissao',
        )
      } finally {
        result.pdf?.fill?.(0)
      }

      audit('pdf.signed', 'certificate', certRow.id, {
        fileName: path.basename(entry.path),
        outputFileName: path.basename(targetPath),
        sha256: result.sha256,
        thumbprint: result.thumbprint,
        tsaHost: result.tsaHost,
        sizeBytes: entry.sizeBytes,
      })
      releaseCachedPdf(input.token)
      return {
        outputFileName: path.basename(targetPath),
        outputPath: targetPath,
        sha256: result.sha256,
        signedAt: result.signedAt,
        certificateThumbprint: result.thumbprint,
        tsaHost: result.tsaHost,
      }
    } catch (error) {
      // Audita também falhas de pré-condição (token, cert, decrypt) com stage,
      // sem vazar PFX/senha/bytes. Evita duplicar auditoria do catch worker:
      // worker já auditou com stage 'worker', então só audita se ainda não for AppError com stage?
      const appError = error instanceof AppError ? error : null
      const message = error instanceof Error ? error.message.slice(0, 200) : 'erro desconhecido'
      const alreadyAudited = message === undefined
      if (!alreadyAudited && !(error instanceof Error && /worker/i.test(message))) {
        // Só audita pré-condição aqui; worker/write já auditaram acima e o
        // fluxo re-lança AppError já auditado — detectar pela mensagem de
        // worker evita dupla contagem, mas manter fail-closed simples:
        // audita quando ainda não houve stage (token/cert/decrypt/etc).
        const isPreflight =
          appError?.code === 'NOT_FOUND' ||
          appError?.code === 'CONFLICT' ||
          appError?.code === 'CERTIFICATE_EXPIRED' ||
          appError?.code === 'CERTIFICATE_INVALID' ||
          (appError?.code === 'VALIDATION' && auditFileName === null) ||
          (appError?.code === 'UNAVAILABLE' && /cofre|tsa/i.test(message) && auditFileName === null)
        if (isPreflight) {
          audit('pdf.sign_failed', 'certificate', auditCertId, {
            fileName: auditFileName ?? 'desconhecido',
            error: message.slice(0, 200),
            stage: 'preflight',
          })
        }
      }
      throw error
    } finally {
      pdfSigning = false
    }
  })
}

async function openDialogFor(
  event: IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions,
): Promise<Electron.OpenDialogReturnValue> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

async function saveDialogFor(
  event: IpcMainInvokeEvent,
  options: Electron.SaveDialogOptions,
): Promise<Electron.SaveDialogReturnValue> {
  const parent = BrowserWindow.fromWebContents(event.sender)
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function safeFilename(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'certificado'
  )
}

const sensitiveRate = new Map<string, number>()
function throttled(key: string, intervalMs: number): void {
  const now = Date.now()
  const last = sensitiveRate.get(key) ?? 0
  if (now - last < intervalMs) {
    throw new AppError('FORBIDDEN', 'Aguarde antes de repetir esta acao')
  }
  sensitiveRate.set(key, now)
  if (sensitiveRate.size > 500) {
    for (const [entry, timestamp] of sensitiveRate) {
      if (now - timestamp > 60_000) sensitiveRate.delete(entry)
    }
  }
}
