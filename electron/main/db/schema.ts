import { index, integer, sqliteTable, text, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core'
import type { AuthMethod, CertificateStatus, SessionStatus } from '../../../shared/constants'
import type { CredentialField } from '../../../shared/types'
import type { RecipeDefinition } from '../../../shared/recipe'

export const clients = sqliteTable(
  'clients',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['PF', 'PJ'] }).notNull(),
    name: text('name').notNull(),
    document: text('document').notNull(),
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    honorariosCents: integer('honorarios_cents'),
    tags: text('tags_json', { mode: 'json' }).$type<string[]>().notNull(),
    status: text('status', { enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    consentAt: text('consent_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('clients_document_unique').on(table.document),
    index('clients_name_idx').on(table.name),
    index('clients_status_idx').on(table.status),
  ],
)

export const clientNotes = sqliteTable(
  'client_notes',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('client_notes_client_idx').on(table.clientId)],
)

export const certificates = sqliteTable(
  'certificates',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    holderName: text('holder_name').notNull(),
    document: text('document'),
    documentType: text('document_type', { enum: ['CPF', 'CNPJ', 'OTHER'] }).notNull(),
    subjectDn: text('subject_dn').notNull(),
    issuerDn: text('issuer_dn').notNull(),
    serialHex: text('serial_hex').notNull(),
    thumbprintSha1: text('thumbprint_sha1').notNull(),
    thumbprintSha256: text('thumbprint_sha256').notNull(),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to').notNull(),
    source: text('source', { enum: ['pfx', 'windows'] }).notNull(),
    pfxEnc: text('pfx_enc'),
    pfxPasswordEnc: text('pfx_password_enc'),
    installed: integer('installed', { mode: 'boolean' }).notNull().default(false),
    installedAt: text('installed_at'),
    lastSeenAt: text('last_seen_at'),
    chainStatus: text('chain_status'),
    statusOverride: text('status_override').$type<CertificateStatus | null>(),
    lastUsedAt: text('last_used_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('certificates_thumbprint_sha256_unique').on(table.thumbprintSha256),
    index('certificates_client_idx').on(table.clientId),
    index('certificates_valid_to_idx').on(table.validTo),
  ],
)

export const certificateClients = sqliteTable(
  'certificate_clients',
  {
    certificateId: text('certificate_id')
      .notNull()
      .references(() => certificates.id, { onDelete: 'cascade' }),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    consentAt: text('consent_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.certificateId, table.clientId] }),
    index('certificate_clients_client_idx').on(table.clientId),
  ],
)

export const services = sqliteTable(
  'services',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    baseUrl: text('base_url').notNull(),
    allowedDomains: text('allowed_domains_json', { mode: 'json' }).$type<string[]>().notNull(),
    authMethods: text('auth_methods_json', { mode: 'json' }).$type<AuthMethod[]>().notNull(),
    defaultAuth: text('default_auth', { enum: ['certificate', 'password'] }).notNull(),
    logoPath: text('logo_path'),
    notes: text('notes'),
    isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('services_slug_unique').on(table.slug),
    index('services_category_idx').on(table.category),
  ],
)

export const credentials = sqliteTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    username: text('username').notNull(),
    usernameType: text('username_type', { enum: ['cpf', 'cnpj', 'email', 'other'] }).notNull(),
    passwordEnc: text('password_enc').notNull(),
    passwordFingerprint: text('password_fingerprint').notNull(),
    notes: text('notes'),
    fields: text('fields_json', { mode: 'json' }).$type<CredentialField[] | null>(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    lastUsedAt: text('last_used_at'),
    passwordChangedAt: text('password_changed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('credentials_client_service_idx').on(table.clientId, table.serviceId),
    index('credentials_fingerprint_idx').on(table.passwordFingerprint),
  ],
)

export const recipes = sqliteTable(
  'recipes',
  {
    id: text('id').primaryKey(),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    definition: text('definition_json', { mode: 'json' }).$type<RecipeDefinition>().notNull(),
    autoSubmit: integer('auto_submit', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['draft', 'verified', 'broken', 'disabled'] })
      .notNull()
      .default('draft'),
    lastVerifiedAt: text('last_verified_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('recipes_service_unique').on(table.serviceId)],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    certificateId: text('certificate_id').references(() => certificates.id, {
      onDelete: 'set null',
    }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    credentialId: text('credential_id').references(() => credentials.id, {
      onDelete: 'set null',
    }),
    authMethod: text('auth_method', { enum: ['certificate', 'password'] }).notNull(),
    partition: text('partition').notNull(),
    status: text('status', {
      enum: ['opening', 'awaiting_login', 'authenticated', 'manual', 'error', 'closed'],
    })
      .notNull()
      .default('opening'),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
    lastError: text('last_error'),
  },
  (table) => [
    index('sessions_client_idx').on(table.clientId),
    index('sessions_opened_idx').on(table.openedAt),
  ],
)

export const departments = sqliteTable(
  'departments',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('departments_name_unique').on(table.name),
    index('departments_active_idx').on(table.active),
  ],
)

export const obligations = sqliteTable(
  'obligations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    sigla: text('sigla').notNull(),
    description: text('description'),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    recurrence: text('recurrence', {
      enum: ['mensal', 'bimestral', 'trimestral', 'semestral', 'anual', 'eventual'],
    }).notNull(),
    dueRule: text('due_rule', { enum: ['dia_fixo', 'dia_util'] }),
    diaFixo: integer('dia_fixo'),
    diaUtil: integer('dia_util'),
    mesReferencia: integer('mes_referencia'),
    antecedenciaNotificacaoDias: integer('antecedencia_notificacao_dias').notNull().default(7),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('obligations_department_sigla_unique').on(table.departmentId, table.sigla),
    index('obligations_department_idx').on(table.departmentId),
    index('obligations_active_idx').on(table.active),
  ],
)

export const obligationGroups = sqliteTable(
  'obligation_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('obligation_groups_name_unique').on(table.name)],
)

export const obligationGroupItems = sqliteTable(
  'obligation_group_items',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => obligationGroups.id, { onDelete: 'cascade' }),
    obligationId: text('obligation_id')
      .notNull()
      .references(() => obligations.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.obligationId] }),
    index('obligation_group_items_obligation_idx').on(table.obligationId),
  ],
)

export const clientObligations = sqliteTable(
  'client_obligations',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    obligationId: text('obligation_id')
      .notNull()
      .references(() => obligations.id, { onDelete: 'cascade' }),
    dataInicio: text('data_inicio').notNull(),
    dataFim: text('data_fim'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('client_obligations_unique').on(table.clientId, table.obligationId),
    index('client_obligations_obligation_idx').on(table.obligationId),
    index('client_obligations_active_idx').on(table.active),
  ],
)

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['obligation.due'] }).notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    obligationId: text('obligation_id').references(() => obligations.id, {
      onDelete: 'set null',
    }),
    clientId: text('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    dueDate: text('due_date'),
    read: integer('read', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('notifications_read_idx').on(table.read),
    index('notifications_created_idx').on(table.createdAt),
    index('notifications_dedupe_idx').on(
      table.type,
      table.obligationId,
      table.clientId,
      table.dueDate,
    ),
  ],
)

export const extraHolidays = sqliteTable(
  'extra_holidays',
  {
    id: text('id').primaryKey(),
    date: text('date').notNull(),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('extra_holidays_date_unique').on(table.date)],
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    metadata: text('metadata_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('audit_events_created_idx').on(table.createdAt),
    index('audit_events_type_idx').on(table.type),
    index('audit_events_entity_idx').on(table.entity, table.entityId),
  ],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const schema = {
  clients,
  clientNotes,
  certificates,
  certificateClients,
  services,
  credentials,
  recipes,
  sessions,
  departments,
  obligations,
  obligationGroups,
  obligationGroupItems,
  clientObligations,
  notifications,
  extraHolidays,
  auditEvents,
  settings,
}

export type ClientRow = typeof clients.$inferSelect
export type ClientNoteRow = typeof clientNotes.$inferSelect
export type CertificateRow = typeof certificates.$inferSelect
export type CertificateClientRow = typeof certificateClients.$inferSelect
export type ServiceRow = typeof services.$inferSelect
export type CredentialRow = typeof credentials.$inferSelect
export type RecipeRow = typeof recipes.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type DepartmentRow = typeof departments.$inferSelect
export type ObligationRow = typeof obligations.$inferSelect
export type ObligationGroupRow = typeof obligationGroups.$inferSelect
export type ObligationGroupItemRow = typeof obligationGroupItems.$inferSelect
export type ClientObligationRow = typeof clientObligations.$inferSelect
export type NotificationRow = typeof notifications.$inferSelect
export type ExtraHolidayRow = typeof extraHolidays.$inferSelect
export type AuditEventRow = typeof auditEvents.$inferSelect
export type SettingRow = typeof settings.$inferSelect
export type NewClientRow = typeof clients.$inferInsert
export type NewCertificateRow = typeof certificates.$inferInsert
export type NewCredentialRow = typeof credentials.$inferInsert
export type NewServiceRow = typeof services.$inferInsert
export type NewRecipeRow = typeof recipes.$inferInsert
export type NewSessionRow = typeof sessions.$inferInsert
export type NewDepartmentRow = typeof departments.$inferInsert
export type NewObligationRow = typeof obligations.$inferInsert
export type NewObligationGroupRow = typeof obligationGroups.$inferInsert
export type NewClientObligationRow = typeof clientObligations.$inferInsert
export type NewNotificationRow = typeof notifications.$inferInsert
export type NewExtraHolidayRow = typeof extraHolidays.$inferInsert
export type NewAuditEventRow = typeof auditEvents.$inferInsert
export type SessionStatusDb = Extract<SessionStatus, string>
