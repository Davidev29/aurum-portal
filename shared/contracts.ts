import { z } from 'zod'
import { SERVICE_CATEGORIES } from './constants'
import { matchesDomainPattern } from './network'
import { letterheadSettingsSchema, officeProfileSchema } from './settings'
import { recipeDefinitionSchema } from './recipe'
import { isValidDocument } from './validation'
import type { PickedPdfFile, PdfPreviewData, SignPdfResult, TsaTestResult } from './signature'
import type {
  AppInfo,
  AuditExportResult,
  AuditFilter,
  AuditPage,
  AppSettings,
  ApplyGroupInput,
  ApplyGroupResult,
  Certificate,
  CertificateDetails,
  CertificateFilter,
  CertificateTestResult,
  Client,
  ClientFilter,
  ClientNote,
  ClientObligation,
  Credential,
  CredentialCreateInput,
  CredentialFilter,
  CredentialRevealResult,
  CredentialUpdateInput,
  CnpjLookupResult,
  Department,
  ExtraHoliday,
  GeneratedPassword,
  ImportProgressEvent,
  ImportReport,
  NotificationList,
  Obligation,
  ObligationFilter,
  ObligationGroup,
  ObligationMonthItem,
  PasteLinksInput,
  PasteLinksResult,
  SetDeliveryResult,
  PasswordGeneratorOptions,
  PortalSession,
  RecipeSummary,
  RecipeTestResult,
  Service,
  ServiceFilter,
  SessionDetails,
  SessionErrorEvent,
  SessionOpenRequest,
  SessionOpenResult,
  WizardState,
  SetLinkResult,
  UpdateCheckResult,
  WindowsCertificate,
  WindowsImportSummary,
  ClientBrasilApiRefreshReport,
  ClientBrasilApiRefreshProgress,
} from './types'
import { obligationRuleIssues, RECURRENCE_TYPES } from './obligation-rules'
import { isDateOnly, EXTRA_HOLIDAY_ICONS } from './holidays'

export const IPC = {
  clients: {
    list: 'clients:list',
    get: 'clients:get',
    create: 'clients:create',
    update: 'clients:update',
    archive: 'clients:archive',
    restore: 'clients:restore',
    exportCsv: 'clients:exportCsv',
    cnpjLookup: 'clients:cnpjLookup',
    refreshFromBrasilApi: 'clients:refreshFromBrasilApi',
    listNotes: 'clients:listNotes',
    createNote: 'clients:createNote',
    updateNote: 'clients:updateNote',
    deleteNote: 'clients:deleteNote',
  },
  credentials: {
    list: 'credentials:list',
    create: 'credentials:create',
    update: 'credentials:update',
    delete: 'credentials:delete',
    reveal: 'credentials:reveal',
    copy: 'credentials:copy',
    copyPlain: 'credentials:copyPlain',
    generate: 'credentials:generate',
    setDefault: 'credentials:setDefault',
  },
  certificates: {
    list: 'certificates:list',
    get: 'certificates:get',
    details: 'certificates:details',
    pickPfxFiles: 'certificates:pickPfxFiles',
    import: 'certificates:import',
    importBatch: 'certificates:importBatch',
    listWindows: 'certificates:listWindows',
    importFromWindows: 'certificates:importFromWindows',
    install: 'certificates:install',
    uninstall: 'certificates:uninstall',
    test: 'certificates:test',
    linkClient: 'certificates:linkClient',
    unlinkClient: 'certificates:unlinkClient',
    stats: 'certificates:stats',
    refreshAll: 'certificates:refreshAll',
    exportBackup: 'certificates:exportBackup',
  },
  services: {
    list: 'services:list',
    get: 'services:get',
    create: 'services:create',
    update: 'services:update',
    delete: 'services:delete',
    duplicate: 'services:duplicate',
    restoreBuiltins: 'services:restoreBuiltins',
    fetchLogo: 'services:fetchLogo',
    uploadLogo: 'services:uploadLogo',
  },
  sessions: {
    open: 'sessions:open',
    focus: 'sessions:focus',
    close: 'sessions:close',
    list: 'sessions:list',
    details: 'sessions:details',
    navigate: 'sessions:navigate',
    reload: 'sessions:reload',
    stop: 'sessions:stop',
    back: 'sessions:back',
    forward: 'sessions:forward',
    setZoom: 'sessions:setZoom',
    openExternal: 'sessions:openExternal',
    getCredentialForManual: 'sessions:getCredentialForManual',
    retryRecipe: 'sessions:retryRecipe',
    reveal: 'sessions:reveal',
  },
  recipes: {
    get: 'recipes:get',
    save: 'recipes:save',
    test: 'recipes:test',
    reset: 'recipes:reset',
    reRecord: 'recipes:reRecord',
  },
  wizard: {
    startRecord: 'wizard:startRecord',
    state: 'wizard:state',
    finish: 'wizard:finish',
    cancel: 'wizard:cancel',
    save: 'wizard:save',
    discard: 'wizard:discard',
    /** Marca a gravação como teto de 15 min? Não exposto — interno. */
  },
  pdf: {
    pickFile: 'pdf:pickFile',
    loadPreview: 'pdf:loadPreview',
    sign: 'pdf:sign',
    testTsa: 'pdf:testTsa',
    release: 'pdf:release',
    reveal: 'pdf:reveal',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    reset: 'settings:reset',
  },
  reports: {
    /** Salva um PDF gerado no renderer (relatório timbrado) via diálogo nativo. */
    savePdf: 'reports:savePdf',
  },
  audit: {
    list: 'audit:list',
    export: 'audit:export',
  },
  obligations: {
    listDepartments: 'obligations:departments:list',
    createDepartment: 'obligations:departments:create',
    updateDepartment: 'obligations:departments:update',
    setDepartmentActive: 'obligations:departments:setActive',
    deleteDepartment: 'obligations:departments:delete',
    listObligations: 'obligations:list',
    createObligation: 'obligations:create',
    updateObligation: 'obligations:update',
    setObligationActive: 'obligations:setActive',
    deleteObligation: 'obligations:delete',
    listGroups: 'obligations:groups:list',
    createGroup: 'obligations:groups:create',
    updateGroup: 'obligations:groups:update',
    deleteGroup: 'obligations:groups:delete',
    applyGroup: 'obligations:groups:apply',
    listLinks: 'obligations:links:list',
    listLinksByClient: 'obligations:links:listByClient',
    setLink: 'obligations:links:set',
    updateLink: 'obligations:links:update',
    removeLink: 'obligations:links:remove',
    pasteLinks: 'obligations:links:paste',
    listMonth: 'obligations:month:list',
    setDelivery: 'obligations:deliveries:set',
    listNotifications: 'obligations:notifications:list',
    markNotificationRead: 'obligations:notifications:markRead',
    markAllNotificationsRead: 'obligations:notifications:markAllRead',
    clearReadNotifications: 'obligations:notifications:clearRead',
    listHolidays: 'obligations:holidays:list',
    addHoliday: 'obligations:holidays:add',
    removeHoliday: 'obligations:holidays:remove',
  },
  app: {
    info: 'app:info',
    lock: 'app:lock',
    unlock: 'app:unlock',
    openLogs: 'app:openLogs',
    checkUpdates: 'app:checkUpdates',
  },
  events: {
    sessionsChanged: 'sessions:changed',
    certificatesChanged: 'certificates:changed',
    clientsChanged: 'clients:changed',
    clientsRefreshProgress: 'clients:refreshProgress',
    servicesChanged: 'services:changed',
    credentialsChanged: 'credentials:changed',
    importProgress: 'import:progress',
    downloadProgress: 'download:progress',
    appLocked: 'app:locked',
    sessionError: 'session:error',
    updateStatus: 'app:updateStatus',
    obligationsChanged: 'obligations:changed',
    notificationsChanged: 'notifications:changed',
    wizardProgress: 'wizard:progress',
  },
} as const

const idSchema = z.string().min(1).max(120)
const nameSchema = z.string().trim().min(1).max(200)
const documentSchema = z
  .string()
  .transform((value) => value.replace(/\D+/g, ''))
  .refine(isValidDocument, 'CPF/CNPJ invalido')
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .refine((value) => {
    const withoutWildcard = value.startsWith('*.') ? value.slice(2) : value
    // IP literal (intranets e portais internos por IP) — curinga IPv4 não existe.
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(withoutWildcard)) {
      return withoutWildcard.split('.').every((label) => Number(label) <= 255)
    }
    return /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  }, 'Dominio invalido')

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => new URL(value).protocol === 'https:', 'A URL deve usar HTTPS')

const authMethodSchema = z.enum(['certificate', 'password'])

// Base sem defaults: o update parcial herda desta base (zod 4 aplicaria
// .default([]) em .partial()).
const clientBaseObject = z.object({
  type: z.enum(['PF', 'PJ']).optional(),
  name: nameSchema.optional(),
  document: documentSchema,
  email: z.string().trim().email().max(254).nullish(),
  phone: z.string().trim().max(30).nullish(),
  notes: z.string().trim().max(5000).nullish(),
  honorariosCents: z.number().int().min(0).max(99_999_999_999).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  consent: z.boolean().optional(),
})

export const clientInputSchema = clientBaseObject.extend({
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
})

export const clientUpdateSchema = clientBaseObject.partial()

export const clientNoteCreateSchema = z.object({
  clientId: idSchema,
  text: z.string().trim().min(1).max(5000),
})
export const clientNoteUpdateSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1).max(5000),
})
export const clientNoteListSchema = z.object({ clientId: idSchema })
export const clientNoteDeleteSchema = z.object({ id: idSchema })

export const clientFilterSchema = z
  .object({
    search: z.string().max(200).optional(),
    status: z.enum(['active', 'archived', 'all']).optional(),
    tag: z.string().max(40).optional(),
  })
  .optional()

/** Consulta manual solicitada pelo operador no formulario do cliente (CNPJ). */
export const cnpjLookupSchema = z.object({
  document: documentSchema.refine(
    (value) => value.length === 14,
    'Informe os 14 digitos de um CNPJ',
  ),
})

export const credentialCreateSchema = z.object({
  clientId: idSchema,
  serviceId: idSchema,
  label: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(200),
  usernameType: z.enum(['cpf', 'cnpj', 'email', 'other']),
  password: z.string().min(1).max(1024),
  notes: z.string().trim().max(2000).nullish(),
  fields: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        value: z.string().max(1024).optional(),
        kind: z.enum(['username', 'password', 'text']),
      }),
    )
    .nullable()
    .optional(),
  isDefault: z.boolean().optional(),
})

export const credentialUpdateSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  username: z.string().trim().min(1).max(200).optional(),
  usernameType: z.enum(['cpf', 'cnpj', 'email', 'other']).optional(),
  password: z.string().min(1).max(1024).optional(),
  notes: z.string().trim().max(2000).nullish(),
  fields: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        value: z.string().max(1024).optional(),
        kind: z.enum(['username', 'password', 'text']),
      }),
    )
    .nullable()
    .optional(),
  isDefault: z.boolean().optional(),
})

export const credentialFilterSchema = z
  .object({
    clientId: idSchema.optional(),
    serviceId: idSchema.optional(),
    search: z.string().max(200).optional(),
  })
  .optional()

export const passwordGeneratorSchema = z.object({
  length: z.number().int().min(8).max(128).default(24),
  uppercase: z.boolean().default(true),
  lowercase: z.boolean().default(true),
  numbers: z.boolean().default(true),
  symbols: z.boolean().default(true),
})

export const certificateFilterSchema = z
  .object({
    clientId: idSchema.optional(),
    status: z
      .enum([
        'valid',
        'expiring',
        'expired',
        'in_vault',
        'missing_windows',
        'chain_incomplete',
        'all',
      ])
      .optional(),
    search: z.string().max(200).optional(),
    // Interno: inclui certificados históricos já renovados (arquivados pela
    // renovação). Sem isso, a listagem traz apenas o certificado atual de
    // cada CPF/CNPJ.
    includeHistory: z.boolean().optional(),
  })
  .optional()

export const importFileSchema = z.object({
  filePath: z.string().min(3).max(4096),
  password: z.string().max(1024).optional(),
})

export const certificateImportSchema = z.object({
  filePath: z.string().min(3).max(4096),
  password: z.string().max(1024),
  clientId: idSchema.nullish(),
  install: z.boolean().default(true),
  consent: z.boolean().optional(),
})

export const certificateImportBatchSchema = z.object({
  files: z.array(importFileSchema).min(1).max(100),
  sharedPassword: z.string().max(1024).optional(),
  install: z.boolean().default(true),
  clientId: idSchema.nullish(),
  consent: z.boolean().optional(),
})

export const importFromWindowsSchema = z.object({
  thumbprints: z
    .array(z.string().regex(/^(?:[A-Fa-f0-9]{40}|[A-Fa-f0-9]{64})$/))
    .max(200)
    .default([]),
  /** Quando true, importa todos os certificados instalados no Windows de uma vez. */
  importAll: z.boolean().optional(),
  clientId: idSchema.nullish(),
  consent: z.boolean().optional(),
})

export const certificateIdSchema = z.object({ id: idSchema })

export const certificateLinkSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  consent: z.boolean(),
})

export const certificateUnlinkSchema = z.object({
  id: idSchema,
  clientId: idSchema,
})

export const certificateUninstallSchema = z.object({
  id: idSchema,
  confirmation: z.literal('REMOVER'),
})

export const certificateExportBackupSchema = z.object({
  id: idSchema,
  passphrase: z.string().min(12).max(1024),
})

// Base sem refinamentos: zod 4 não permite .partial() em objeto com checks,
// então o update parcial deriva da base (idêntica à origem do objeto refinado).
const serviceInputBaseObject = z.object({
  name: nameSchema,
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug invalido'),
  category: z.enum(SERVICE_CATEGORIES).default('Outros'),
  baseUrl: httpsUrlSchema,
  allowedDomains: z.array(domainSchema).max(30).default([]),
  authMethods: z.array(authMethodSchema).min(1).max(2).default(['password']),
  defaultAuth: authMethodSchema.optional(),
  notes: z.string().trim().max(5000).nullish(),
  enabled: z.boolean().optional(),
  favorite: z.boolean().optional(),
})

export const serviceInputObjectSchema = serviceInputBaseObject.superRefine((value, ctx) => {
  if (value.defaultAuth !== undefined && !value.authMethods.includes(value.defaultAuth)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultAuth'],
      message: 'O metodo padrao deve estar entre os metodos aceitos',
    })
  }
  if (new Set(value.authMethods).size !== value.authMethods.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['authMethods'],
      message: 'Metodos de autenticacao duplicados',
    })
  }
  const baseHost = new URL(value.baseUrl).hostname.toLowerCase()
  const effectiveDomains = value.allowedDomains.length > 0 ? value.allowedDomains : [baseHost]
  if (!effectiveDomains.some((domain) => matchesDomainPattern(baseHost, domain))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['allowedDomains'],
      message: 'A allowlist deve incluir o dominio da URL base',
    })
  }
})

export const serviceInputSchema = serviceInputObjectSchema.transform((value) => {
  const authMethods: ('certificate' | 'password')[] =
    value.authMethods && value.authMethods.length > 0
      ? (value.authMethods as ('certificate' | 'password')[])
      : ['password']
  const defaultAuth: 'certificate' | 'password' =
    (value.defaultAuth as 'certificate' | 'password' | undefined) ?? authMethods[0] ?? 'password'
  let allowedDomains = value.allowedDomains
  if (!allowedDomains || allowedDomains.length === 0) {
    try {
      allowedDomains = [new URL(value.baseUrl).hostname.toLowerCase()]
    } catch {
      allowedDomains = value.allowedDomains ?? []
    }
  }
  return {
    ...value,
    category: value.category ?? 'Outros',
    authMethods,
    defaultAuth,
    allowedDomains,
  }
})

// Update parcial: deriva da base (zod 4 proíbe .partial() em schema com checks).
// Refinamento de objeto completo não se aplica a updates parciais — o merge
// é validado pelo repositório no processo principal.
export const serviceUpdateSchema = serviceInputBaseObject.partial()

export const serviceFilterSchema = z
  .object({
    search: z.string().max(200).optional(),
    category: z.enum(SERVICE_CATEGORIES).or(z.literal('all')).optional(),
    favorite: z.boolean().optional(),
    enabledOnly: z.boolean().optional(),
  })
  .optional()

export const sessionOpenSchema = z.object({
  serviceId: idSchema,
  clientId: idSchema,
  certificateId: idSchema.nullish(),
  authMethod: authMethodSchema,
  credentialId: idSchema.nullish(),
  forceNew: z.boolean().optional(),
  /**
   * Marca de origem do teste explícito do robô gravado (§14-F). O audit
   * `session.opened`/`credential` inclui `origin` no metadata — sem tipo novo.
   */
  origin: z.literal('verify-test').optional(),
})

export const sessionIdSchema = z.object({ sessionId: idSchema })

export const sessionNavigateSchema = z.object({
  sessionId: idSchema,
  url: z.string().url().max(4000),
})

export const sessionZoomSchema = z.object({
  sessionId: idSchema,
  zoomFactor: z.number().min(0.5).max(2.5),
})

export const sessionExternalSchema = z.object({
  sessionId: idSchema,
  url: z.string().url().max(4000).optional(),
})

export const sessionManualCredentialSchema = z.object({
  sessionId: idSchema,
  credentialId: idSchema,
  field: z.enum(['username', 'password']),
})

export const recipeSaveSchema = z.object({
  serviceId: idSchema,
  definition: recipeDefinitionSchema,
})

export const recipeTestSchema = z.object({ serviceId: idSchema })

export const recipeIdSchema = z.object({ serviceId: idSchema })

export const recipeReRecordSchema = z.object({
  serviceId: idSchema,
  clientId: idSchema,
  authMethod: authMethodSchema,
  /** Opcional (C2) — null ⇒ fingerprint não avaliado (no-credential-bound). */
  credentialId: idSchema.nullish(),
  /** Obrigatório para certificado (A1 válido e vinculado ao cliente). */
  certificateId: idSchema.nullish(),
})

export const wizardStartRecordSchema = z.object({
  serviceId: idSchema,
  /** Opcional: ensinar o robô sem vincular cliente (o portal é o que importa). */
  clientId: idSchema.nullish(),
  authMethod: authMethodSchema,
  /** Opcional (C2). Ausente ⇒ fingerprint NÃO avaliado; warning no-credential-bound. */
  credentialId: idSchema.nullish(),
  /** Obrigatório para certificado (A1 válido e vinculado ao cliente). */
  certificateId: idSchema.nullish(),
})

export const wizardIdSchema = z.object({ wizardId: idSchema })

export const wizardSaveSchema = z.object({
  wizardId: idSchema,
  autoSubmit: z.boolean(),
  /** N3: etapas removidas na revisão (0-based). O servidor descarta e valida ≤60. */
  removedStepIndexes: z.array(z.number().int().min(0).max(59)).max(60).optional(),
})

export const pdfLoadPreviewSchema = z.object({ token: idSchema })

export const pdfReleaseSchema = z.object({ token: idSchema })

/** Caminho absoluto do PDF gerado (mostrar no Explorador). */
export const pdfRevealSchema = z.object({ path: z.string().trim().min(1).max(2048) })

export const pdfSignSchema = z
  .object({
    token: idSchema,
    certificateId: idSchema,
    page: z.number().int().min(1).max(2000),
    /**
     * Frações 0..1 no canto SUPERIOR-ESQUERDO da página EXIBIDA
     * (cropBox∩mediaBox, com /Rotate aplicado — mesma geometria da prévia).
     * O backend converte para user space (origem inferior-esquerda) ao desenhar.
     */
    xPct: z.number().min(0).max(1),
    yPct: z.number().min(0).max(1),
    size: z.enum(['small', 'medium', 'large']),
    /**
     * Tamanho desenhado pelo usuario (fracoes da pagina EXIBIDA). O bloco
     * adota exatamente o retangulo desenhado (como o Adobe Reader); o
     * piso absoluto fica no backend (SIGNATURE_STAMP_FLOOR, ~1 cm).
     * Aqui so se rejeitam valores degenerados/fora da pagina.
     */
    widthPct: z.number().min(0.005).max(0.95).optional(),
    heightPct: z.number().min(0.005).max(0.95).optional(),
    /** @deprecated localizacao removida do carimbo; ignorado. */
    location: z.string().trim().max(120).optional(),
    reason: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.widthPct !== undefined && value.xPct + value.widthPct > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Carimbo ultrapassa a largura da pagina',
        path: ['widthPct'],
      })
    }
    if (value.heightPct !== undefined && value.yPct + value.heightPct > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Carimbo ultrapassa a altura da pagina',
        path: ['heightPct'],
      })
    }
  })

export const pdfTestTsaSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => /^https?:$/.test(new URL(value).protocol), 'A TSA deve usar HTTP ou HTTPS')
    .optional(),
})

export const settingsUpdateSchema = z
  .object({
    theme: z.enum(['light', 'dark', 'system']),
    language: z.literal('pt-BR'),
    closeBehavior: z.enum(['quit', 'ask']),
    clipboardClearSeconds: z.number().int().min(5).max(300),
    maskPasswords: z.boolean(),
    passwordRevealSeconds: z.number().int().min(3).max(120),
    confirmOpenExternal: z.boolean(),
    sessionLimit: z.number().int().min(2).max(40),
    idleLockMinutes: z.number().int().min(0).max(240),
    retainAuditDays: z.number().int().min(30).max(3650),
    externalCnpjLookup: z.boolean(),
    signTsaUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => /^https?:$/.test(new URL(value).protocol), 'A TSA deve usar HTTP ou HTTPS')
      .optional(),
    signStampReason: z.string().trim().min(3).max(120).optional(),
    // Perfil do escritório: aceita atualização parcial campo a campo.
    office: officeProfileSchema.partial(),
    // Timbrado: aceita atualização parcial campo a campo.
    letterhead: letterheadSettingsSchema.partial(),
  })
  .partial()

export const auditFilterSchema = z
  .object({
    types: z.array(z.string().max(100)).max(50).optional(),
    entity: z.string().max(100).optional(),
    entityId: idSchema.optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .optional()

export const auditExportSchema = z.object({
  format: z.enum(['csv', 'json']),
  filter: auditFilterSchema,
})

/* ---------------------------------------------------------------------------
 * Obrigações — schemas
 * ------------------------------------------------------------------------- */

const dateOnlySchema = z.string().refine(isDateOnly, 'Informe uma data válida (AAAA-MM-DD)')

export const departmentInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do departamento').max(120),
  description: z.string().trim().max(500).nullish(),
  active: z.boolean().optional(),
})
export const departmentUpdateSchema = departmentInputSchema.partial()
export const departmentIdSchema = z.object({ id: idSchema })
export const departmentSetActiveSchema = z.object({
  id: idSchema,
  active: z.boolean(),
})

const siglaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Informe a sigla')
  .max(12, 'A sigla deve ter no máximo 12 caracteres')
  .regex(/^[A-Z0-9.\-/]+$/, 'Use apenas letras, números, ponto, hífen e barra na sigla')

const nullableInt = z.number().int().nullable().optional()

export const obligationInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Informe o nome da obrigação').max(160),
    sigla: siglaSchema,
    description: z.string().trim().max(500).nullish(),
    departmentId: idSchema,
    recurrence: z.enum(RECURRENCE_TYPES),
    dueRule: z.enum(['dia_fixo', 'dia_util']).nullable().optional(),
    diaFixo: nullableInt,
    diaUtil: nullableInt,
    mesReferencia: nullableInt,
    antecedenciaNotificacaoDias: z.number().int().min(0).max(90).default(7),
    active: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    for (const issue of obligationRuleIssues(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue })
    }
  })

export const obligationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  sigla: siglaSchema.optional(),
  description: z.string().trim().max(500).nullish(),
  departmentId: idSchema.optional(),
  recurrence: z.enum(RECURRENCE_TYPES).optional(),
  dueRule: z.enum(['dia_fixo', 'dia_util']).nullable().optional(),
  diaFixo: nullableInt,
  diaUtil: nullableInt,
  mesReferencia: nullableInt,
  antecedenciaNotificacaoDias: z.number().int().min(0).max(90).optional(),
  active: z.boolean().optional(),
})

export const obligationFilterSchema = z
  .object({
    search: z.string().max(200).optional(),
    departmentId: z.string().max(120).optional(),
    recurrence: z.enum([...RECURRENCE_TYPES, 'all']).optional(),
    active: z.enum(['active', 'inactive', 'all']).optional(),
  })
  .optional()

export const obligationIdSchema = z.object({ id: idSchema })
export const obligationSetActiveSchema = z.object({
  id: idSchema,
  active: z.boolean(),
})

export const obligationGroupInputSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome do grupo').max(120),
  description: z.string().trim().max(500).nullish(),
  obligationIds: z.array(idSchema).max(300).default([]),
})
export const obligationGroupUpdateSchema = obligationGroupInputSchema.partial()
export const obligationGroupIdSchema = z.object({ id: idSchema })

export const applyGroupSchema = z.object({
  groupId: idSchema,
  clientIds: z.array(idSchema).min(1, 'Selecione ao menos um cliente').max(500),
  dataInicio: dateOnlySchema.nullish(),
})

export const setLinkSchema = z.object({
  clientId: idSchema,
  obligationId: idSchema,
  active: z.boolean(),
})
export const updateLinkSchema = z.object({
  id: idSchema,
  dataInicio: dateOnlySchema.optional(),
  dataFim: dateOnlySchema.nullish(),
  active: z.boolean().optional(),
})
export const removeLinkSchema = z.object({ id: idSchema })
export const listLinksByClientSchema = z.object({ clientId: idSchema })

export const pasteLinksSchema = z.object({
  targetClientId: idSchema,
  obligationIds: z.array(idSchema).min(1).max(500),
  dataInicio: dateOnlySchema.nullish(),
})

export const markNotificationReadSchema = z.object({ id: idSchema })
export const clearReadNotificationsSchema = z.object({}).optional()

export const monthOverviewSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Informe o mês no formato AAAA-MM'),
})

export const setDeliverySchema = z.object({
  clientId: idSchema,
  obligationId: idSchema,
  dueDate: dateOnlySchema,
  delivered: z.boolean(),
})

export const holidayInputSchema = z.object({
  date: dateOnlySchema,
  name: z.string().trim().min(1, 'Informe o nome do feriado').max(120),
  icon: z.enum(EXTRA_HOLIDAY_ICONS).nullish(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Informe uma cor em hexadecimal (#RRGGBB)')
    .nullish(),
})
export const holidayIdSchema = z.object({ id: idSchema })

/** PDF de relatório timbrado gerado no renderer (bytes em base64). */
export const reportSavePdfSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  // 5 MB binários ≈ 6.7 MB em base64 — deixa uma margem pequena.
  dataBase64: z.string().min(8).max(7_000_000),
  trackingCode: z.string().trim().max(40).optional(),
  title: z.string().trim().max(200).optional(),
})

export interface ReportSavePdfResult {
  path: string
  trackingCode: string | null
}

export const appUnlockSchema = z.object({}).optional()

export interface DownloadProgress {
  id: string
  filename: string
  state: 'started' | 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
  savePath: string | null
}

export interface AurumBitPortalEvents {
  onSessionsChanged(callback: (sessions: PortalSession[]) => void): () => void
  onCertificatesChanged(callback: () => void): () => void
  onClientsChanged(callback: () => void): () => void
  onCredentialsChanged(callback: () => void): () => void
  onClientsRefreshProgress(callback: (progress: ClientBrasilApiRefreshProgress) => void): () => void
  onServicesChanged(callback: () => void): () => void
  onImportProgress(callback: (progress: ImportProgressEvent) => void): () => void
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void
  onAppLocked(callback: (locked: boolean) => void): () => void
  onSessionError(callback: (event: SessionErrorEvent) => void): () => void
  onUpdateStatus(callback: (result: UpdateCheckResult) => void): () => void
  onObligationsChanged(callback: () => void): () => void
  onNotificationsChanged(callback: (payload: { created: number } | null) => void): () => void
  onWizardProgress(
    callback: (progress: {
      wizardId: string
      stepCount: number
      screen: number
      gaps: number
    }) => void,
  ): () => void
}

export interface AurumBitPortalApi {
  clients: {
    list(filter?: ClientFilter): Promise<Client[]>
    get(id: string): Promise<Client | null>
    create(input: z.input<typeof clientInputSchema>): Promise<Client>
    update(id: string, input: z.input<typeof clientUpdateSchema>): Promise<Client>
    archive(id: string): Promise<Client>
    restore(id: string): Promise<Client>
    exportCsv(): Promise<{ path: string; count: number }>
    cnpjLookup(input: z.input<typeof cnpjLookupSchema>): Promise<CnpjLookupResult>
    refreshFromBrasilApi(): Promise<ClientBrasilApiRefreshReport>
    listNotes(clientId: string): Promise<ClientNote[]>
    createNote(input: z.input<typeof clientNoteCreateSchema>): Promise<ClientNote>
    updateNote(input: z.input<typeof clientNoteUpdateSchema>): Promise<ClientNote>
    deleteNote(id: string): Promise<void>
  }
  credentials: {
    list(filter?: CredentialFilter): Promise<Credential[]>
    create(input: CredentialCreateInput): Promise<Credential>
    update(id: string, input: CredentialUpdateInput): Promise<Credential>
    delete(id: string): Promise<void>
    /** Todos os campos declarados, resolvidos em memória (extras já
     * descriptografados). Nada persiste. */
    reveal(id: string): Promise<CredentialRevealResult>
    /** Copia um campo para a área de transferência (limpeza automática).
     * Sem `field`, copia a senha principal. O texto claro não passa pelo
     * renderer — a cópia acontece no processo principal. */
    copy(id: string, field?: string): Promise<{ expiresAt: string }>
    /** Copia um texto arbitrário (ex.: valor revelado na sessão) para a área
     * de transferência COM limpeza automática e auditoria. Limite de 4 KB. */
    copyPlain(value: string): Promise<{ expiresAt: string }>
    generate(options: Partial<PasswordGeneratorOptions>): Promise<GeneratedPassword>
    setDefault(id: string): Promise<Credential>
  }
  certificates: {
    list(filter?: CertificateFilter): Promise<Certificate[]>
    get(id: string): Promise<Certificate | null>
    details(id: string): Promise<CertificateDetails>
    pickPfxFiles(): Promise<string[]>
    import(input: z.input<typeof certificateImportSchema>): Promise<ImportReport>
    importBatch(input: z.input<typeof certificateImportBatchSchema>): Promise<ImportReport>
    listWindows(): Promise<WindowsCertificate[]>
    importFromWindows(input: z.input<typeof importFromWindowsSchema>): Promise<WindowsImportSummary>
    install(id: string): Promise<Certificate>
    uninstall(input: z.input<typeof certificateUninstallSchema>): Promise<Certificate>
    test(id: string): Promise<CertificateTestResult>
    linkClient(input: z.input<typeof certificateLinkSchema>): Promise<Certificate>
    unlinkClient(input: z.input<typeof certificateUnlinkSchema>): Promise<Certificate>
    stats(): Promise<{
      total: number
      expiring: number
      expired: number
      missingWindows: number
      installed: number
    }>
    refreshAll(): Promise<{
      certificates: Certificate[]
      stats: {
        total: number
        expiring: number
        expired: number
        missingWindows: number
        installed: number
      }
    }>
    exportBackup(input: z.input<typeof certificateExportBackupSchema>): Promise<{ path: string }>
  }
  services: {
    list(filter?: ServiceFilter): Promise<Service[]>
    get(id: string): Promise<Service | null>
    create(input: z.input<typeof serviceInputSchema>): Promise<Service>
    update(id: string, input: z.input<typeof serviceUpdateSchema>): Promise<Service>
    delete(id: string): Promise<void>
    duplicate(id: string): Promise<Service>
    restoreBuiltins(): Promise<Service[]>
    fetchLogo(id: string): Promise<Service>
    uploadLogo(id: string): Promise<Service>
  }
  sessions: {
    open(input: SessionOpenRequest): Promise<SessionOpenResult>
    focus(sessionId: string): Promise<void>
    close(sessionId: string): Promise<void>
    list(): Promise<PortalSession[]>
    details(sessionId: string): Promise<SessionDetails | null>
    navigate(sessionId: string, url: string): Promise<void>
    reload(sessionId: string): Promise<void>
    stop(sessionId: string): Promise<void>
    back(sessionId: string): Promise<void>
    forward(sessionId: string): Promise<void>
    setZoom(sessionId: string, zoomFactor: number): Promise<void>
    openExternal(sessionId: string, url?: string): Promise<void>
    getCredentialForManual(
      sessionId: string,
      credentialId: string,
      field: 'username' | 'password',
    ): Promise<{ value: string; expiresAt: string }>
    retryRecipe(sessionId: string): Promise<RecipeTestResult>
    reveal(sessionId: string): Promise<void>
  }
  recipes: {
    get(serviceId: string): Promise<RecipeSummary | null>
    save(input: z.input<typeof recipeSaveSchema>): Promise<RecipeSummary>
    test(serviceId: string): Promise<RecipeTestResult>
    reset(serviceId: string): Promise<RecipeSummary | null>
    reRecord(input: z.input<typeof recipeReRecordSchema>): Promise<{
      wizardId: string
      sessionId: string
    }>
  }
  wizard: {
    startRecord(input: z.input<typeof wizardStartRecordSchema>): Promise<{
      wizardId: string
      sessionId: string
    }>
    state(wizardId: string): Promise<WizardState>
    finish(wizardId: string): Promise<WizardState>
    cancel(wizardId: string): Promise<void>
    save(input: z.input<typeof wizardSaveSchema>): Promise<RecipeSummary>
    discard(wizardId: string): Promise<void>
  }
  pdf: {
    pickFile(): Promise<PickedPdfFile>
    loadPreview(token: string): Promise<PdfPreviewData>
    sign(input: z.input<typeof pdfSignSchema>): Promise<SignPdfResult>
    testTsa(input?: z.input<typeof pdfTestTsaSchema>): Promise<TsaTestResult>
    release(token: string): Promise<void>
    /** Mostra o arquivo assinado no Explorador do Windows. */
    reveal(input: z.input<typeof pdfRevealSchema>): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    reset(): Promise<AppSettings>
  }
  reports: {
    savePdf(input: z.input<typeof reportSavePdfSchema>): Promise<ReportSavePdfResult>
  }
  audit: {
    list(filter?: AuditFilter): Promise<AuditPage>
    export(format: 'csv' | 'json', filter?: AuditFilter): Promise<AuditExportResult>
  }
  obligations: {
    listDepartments(): Promise<Department[]>
    createDepartment(input: z.input<typeof departmentInputSchema>): Promise<Department>
    updateDepartment(id: string, input: z.input<typeof departmentUpdateSchema>): Promise<Department>
    setDepartmentActive(id: string, active: boolean): Promise<Department>
    deleteDepartment(id: string): Promise<void>
    listObligations(filter?: ObligationFilter): Promise<Obligation[]>
    createObligation(input: z.input<typeof obligationInputSchema>): Promise<Obligation>
    updateObligation(id: string, input: z.input<typeof obligationUpdateSchema>): Promise<Obligation>
    setObligationActive(id: string, active: boolean): Promise<Obligation>
    deleteObligation(id: string): Promise<void>
    listGroups(): Promise<ObligationGroup[]>
    createGroup(input: z.input<typeof obligationGroupInputSchema>): Promise<ObligationGroup>
    updateGroup(
      id: string,
      input: z.input<typeof obligationGroupUpdateSchema>,
    ): Promise<ObligationGroup>
    deleteGroup(id: string): Promise<void>
    applyGroup(input: ApplyGroupInput): Promise<ApplyGroupResult>
    listLinks(): Promise<ClientObligation[]>
    listLinksByClient(clientId: string): Promise<ClientObligation[]>
    setLink(input: z.input<typeof setLinkSchema>): Promise<SetLinkResult>
    updateLink(input: z.input<typeof updateLinkSchema>): Promise<ClientObligation>
    removeLink(id: string): Promise<void>
    pasteLinks(input: PasteLinksInput): Promise<PasteLinksResult>
    listMonth(input: z.input<typeof monthOverviewSchema>): Promise<ObligationMonthItem[]>
    setDelivery(input: z.input<typeof setDeliverySchema>): Promise<SetDeliveryResult>
    listNotifications(): Promise<NotificationList>
    markNotificationRead(id: string): Promise<void>
    markAllNotificationsRead(): Promise<void>
    clearReadNotifications(): Promise<void>
    listHolidays(): Promise<ExtraHoliday[]>
    addHoliday(input: z.input<typeof holidayInputSchema>): Promise<ExtraHoliday>
    removeHoliday(id: string): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
    lock(): Promise<void>
    unlock(): Promise<void>
    openLogs(): Promise<void>
    checkUpdates(): Promise<UpdateCheckResult>
  }
  events: AurumBitPortalEvents
}

// matchesDomainPattern/isAllowedHost vivem em ./network (única fonte de
// verdade) e são reexportados aqui por compatibilidade com imports antigos.
export { isAllowedHost, matchesDomainPattern } from './network'
