import type { AuthMethod, CertificateStatus, ServiceCategory, SessionStatus } from './constants'
import type { RecipeDefinition } from './recipe'

export type ClientType = 'PF' | 'PJ'
export type ClientStatus = 'active' | 'archived'
export type UsernameType = 'cpf' | 'cnpj' | 'email' | 'other'
export type CertificateSource = 'pfx' | 'windows'
export type RecipeStatus = 'draft' | 'verified' | 'broken' | 'disabled'
export type ThemePreference = 'light' | 'dark' | 'system'
export type CloseBehavior = 'quit' | 'ask'

export interface Client {
  id: string
  type: ClientType
  name: string
  document: string
  email: string | null
  phone: string | null
  notes: string | null
  /** Honorários em centavos (R$ 350,00 → 35000). null = não informado. */
  honorariosCents: number | null
  tags: string[]
  status: ClientStatus
  consentAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ClientNote {
  id: string
  clientId: string
  text: string
  createdAt: string
  updatedAt: string
}

export interface CertificateClientLink {
  id: string
  name: string
  document: string
}

export interface Certificate {
  id: string
  clientId: string | null
  clients: CertificateClientLink[]
  label: string
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  subjectDn: string
  issuerDn: string
  serialHex: string
  thumbprintSha1: string
  thumbprintSha256: string
  validFrom: string
  validTo: string
  source: CertificateSource
  installed: boolean
  installedAt: string | null
  lastSeenAt: string | null
  status: CertificateStatus
  daysUntilExpiry: number
  chainStatus: string | null
  hasPfx: boolean
  /** Já foi renovado: existe certificado mais novo, do mesmo documento, ainda válido. */
  isRenewed?: boolean
  /** Existe sucessor com data válida (validTo no futuro). */
  hasNewerValid?: boolean
  /** ID do certificado que renovou este (o sucessor válido mais antigo), quando houver. */
  renewedById?: string | null
  /** validTo do certificado que renovou este, quando houver. */
  renewedByValidTo?: string | null
  /** Há certificado anterior do mesmo documento. */
  hasOlderCertificate?: boolean
  /** Há certificado mais novo do mesmo documento (mesmo que também vencido). */
  hasNewerCertificate?: boolean
  /**
   * Vencimento efetivo da cadeia de renovação: o `validTo` mais distante entre
   * todos os certificados do mesmo documento/titular (o fim da validade do
   * último certificado da cadeia). É a data que a UI deve exibir como validade
   * e usar para o alerta de "a vencer" (30 dias antes). Igual a `validTo`
   * quando não há sucessor mais distante.
   */
  effectiveValidTo?: string | null
  createdAt: string
  updatedAt: string
}

export interface CertificateRenewalEntry {
  id: string
  label: string
  holderName: string
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER'
  validFrom: string
  validTo: string
  source: CertificateSource
  installed: boolean
  status: string
  createdAt: string
  isCurrent: boolean
}

/** Detalhe completo exibido no "olhinho": dados + histórico de renovação do documento. */
export interface CertificateDetails {
  certificate: Certificate
  /** Todos os certificados do mesmo documento/titular, em ordem cronológica de validade. */
  history: CertificateRenewalEntry[]
  /** Este certificado já foi renovado (novo importado com data válida). */
  isRenewed: boolean
  /** Sucessor válido que renovou este, quando houver. */
  renewedBy: CertificateRenewalEntry | null
  /** Certificado anterior imediato na linha do tempo, quando houver. */
  previous: CertificateRenewalEntry | null
  /** Próximo certificado na linha do tempo, quando houver. */
  next: CertificateRenewalEntry | null
  hasHistory: boolean
}

export interface Credential {
  id: string
  clientId: string
  clientName: string
  serviceId: string
  serviceName: string
  serviceSlug: string
  label: string
  username: string
  usernameType: UsernameType
  notes: string | null
  isDefault: boolean
  reused: boolean
  lastUsedAt: string | null
  passwordChangedAt: string | null
  fields: CredentialField[] | null
  createdAt: string
  updatedAt: string
}

export interface CredentialField {
  name: string
  kind: 'username' | 'password' | 'text'
  value?: string
}

export interface RecipeSummary {
  id: string
  serviceId: string
  version: number
  status: RecipeStatus
  autoSubmit: boolean
  lastVerifiedAt: string | null
  definition: RecipeDefinition
}

export interface Service {
  id: string
  slug: string
  name: string
  category: ServiceCategory
  baseUrl: string
  allowedDomains: string[]
  authMethods: AuthMethod[]
  defaultAuth: AuthMethod
  logoUrl: string | null
  notes: string | null
  recipe: RecipeSummary | null
  isBuiltin: boolean
  enabled: boolean
  favorite: boolean
  sortOrder: number
  openSessions: number
  createdAt: string
  updatedAt: string
}

export interface SessionCertificateSummary {
  id: string
  label: string
  holderName: string
  thumbprintSha256: string
  validTo: string
}

export interface PortalSession {
  id: string
  clientId: string
  clientName: string
  serviceId: string
  serviceName: string
  serviceSlug: string
  certificateId: string | null
  certificate: SessionCertificateSummary | null
  authMethod: AuthMethod
  partition: string
  status: SessionStatus
  statusMessage: string | null
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  recipeRunning: boolean
  openedAt: string
  closedAt: string | null
  lastError: string | null
}

export type WizardWarningCode =
  | 'credential-mismatch'
  | 'no-credential-bound'
  | 'value-not-recorded'
  | 'otp-not-recorded'
  | 'low-confidence'
  | 'seed-lost'
  | 'step-cap-reached'
  | 'recording-max-duration'

/** Aviso da revisão da gravação — metadados apenas, nunca valores digitados. */
export interface WizardWarning {
  code: WizardWarningCode
  detail: string
}

export type WizardStatus = 'recording' | 'finishing' | 'review' | 'saved' | 'error'

/** Estado do wizard de gravação (poll via `wizard:state`). */
export interface WizardState {
  wizardId: string
  status: WizardStatus
  stepCount: number
  screenCount: number
  /** Eventos perdidos por navegação (lacuna de seq). */
  gaps: number
  warnings: WizardWarning[]
  /** true quando a sonda leve detectou área logada — banner "Parece que você entrou". */
  loggedInHint: boolean
  /** true quando faltam ≤5 min para o teto de 15 min (aviso prévio). */
  durationWarning: boolean
  /** Só em 'review'/'saved': definição compilada, para a revisão. */
  definition?: RecipeDefinition
}

/** Entrada do `wizard:save` (e do botão "Salvar robô"). */
export interface WizardSaveInput {
  wizardId: string
  autoSubmit: boolean
  /** Etapas removidas pelo usuário na revisão (índices 0-based, N3). */
  removedStepIndexes?: number[]
}

export interface SessionDetails extends PortalSession {
  allowedDomains: string[]
  canProvideCredentials: boolean
  credentialId: string | null
  zoomFactor: number
  /** true quando a WebContentsView do portal está visível para o usuário. */
  portalVisible: boolean
  /** true quando a sessão exige interação humana para concluir o login. */
  requiresHumanAction: boolean
  /** true quando a sessão nasceu em modo Gravação Assistida. */
  isRecording: boolean
  /** Presente durante a gravação (para o chrome da sessão exibir a barra de controle). */
  recording?: {
    wizardId: string
    stepCount: number
    screenCount: number
    gaps: number
    loggedInHint: boolean
    durationWarning: boolean
  }
}

export interface WindowsCertificate {
  thumbprintSha1: string
  thumbprintSha256: string | null
  subject: string
  issuer: string
  holderName: string
  document: string | null
  notBefore: string
  notAfter: string
  serialNumber: string
  hasPrivateKey: boolean
  alreadyImported: boolean
  certificateId: string | null
}

export type WindowsImportItemStatus = 'imported' | 'duplicate' | 'error' | 'expired'

export interface WindowsImportItemResult {
  thumbprintSha1: string
  holderName: string | null
  document: string | null
  status: WindowsImportItemStatus
  message: string | null
  certificateId: string | null
}

export interface WindowsImportSummary {
  total: number
  imported: number
  duplicates: number
  errors: number
  certificates: Certificate[]
  items: WindowsImportItemResult[]
}

export interface ImportFileSpec {
  filePath: string
  password?: string
}

export type ImportItemStatus = 'success' | 'duplicate' | 'error' | 'expired'

export interface ImportItemResult {
  filePath: string
  fileName: string
  status: ImportItemStatus
  message: string | null
  certificateId: string | null
  holderName: string | null
  document: string | null
  documentType: 'CPF' | 'CNPJ' | 'OTHER' | null
  validTo: string | null
  installed: boolean
}

export interface ImportReport {
  jobId: string
  total: number
  success: number
  duplicates: number
  errors: number
  expired: number
  items: ImportItemResult[]
  startedAt: string
  finishedAt: string
}

export interface ImportProgressEvent {
  jobId: string
  total: number
  completed: number
  currentFile: string | null
  success: number
  duplicates: number
  errors: number
  stage: 'reading' | 'validating' | 'saving' | 'installing' | 'done'
}

export interface CertificateTestResult {
  ok: boolean
  presentedThumbprintSha256: string | null
  expectedThumbprintSha256: string
  message: string
  testedAt: string
}

export interface ClientFilter {
  search?: string
  status?: ClientStatus | 'all'
  tag?: string
}

export interface CredentialFilter {
  clientId?: string
  serviceId?: string
  search?: string
}

export interface CertificateFilter {
  clientId?: string
  status?: CertificateStatus | 'all'
  search?: string
  /**
   * Interno: inclui os certificados históricos já renovados ("arquivados" pela
   * renovação) no resultado. Por padrão a listagem traz apenas o certificado
   * atual de cada cadeia (mesmo CPF/CNPJ); os históricos só aparecem no
   * histórico de renovação do modal de detalhes.
   */
  includeHistory?: boolean
}

export interface ServiceFilter {
  search?: string
  category?: ServiceCategory | 'all'
  favorite?: boolean
  enabledOnly?: boolean
}

export interface AuditEvent {
  id: string
  type: string
  entity: string
  entityId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface AuditFilter {
  types?: string[]
  entity?: string
  entityId?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface AuditPage {
  events: AuditEvent[]
  total: number
}

export interface AuditExportResult {
  path: string
  count: number
}

/**
 * Dados do escritório / responsável pelo sistema.
 * Utilizados para relatórios customizados (cabeçalho, identificação e
 * logomarca). `cnpj`/`managerCpf` são armazenados apenas com dígitos;
 * `logoBase64` é um Data URL (`data:image/...;base64,...`) sem o arquivo
 * original.
 */
export interface OfficeProfile {
  /** Razão social do escritório. */
  legalName: string
  /** Nome fantasia (preenchido via Brasil API, quando disponível). */
  tradeName: string
  /** CNPJ do escritório, apenas dígitos (14) ou vazio. */
  cnpj: string
  /** Gestor / responsável pelo escritório. */
  managerName: string
  /** CPF do gestor / responsável, apenas dígitos (11) ou vazio. */
  managerCpf: string
  /** Inscrição municipal. */
  municipalRegistration: string
  /** Inscrição estadual. */
  stateRegistration: string
  /** Logradouro / endereço do escritório (timbrado). */
  address: string
  /** Cidade do escritório (timbrado). */
  city: string
  /** UF do escritório (timbrado), ex.: "SP". */
  state: string
  /** Telefone do escritório (timbrado). */
  phone: string
  /** E-mail do escritório (timbrado). */
  email: string
  /** Site do escritório (timbrado). */
  website: string
  /** Registro profissional (CRC etc., timbrado). */
  registration: string
  /** Logomarca em Base64 (Data URL PNG/JPG/WebP) ou null. */
  logoBase64: string | null
}

export type LetterheadBarStyle = 'solid' | 'double' | 'thin'
export type LetterheadLogoSize = 's' | 'm' | 'l'
export type LetterheadTitleFont = 'helvetica' | 'times'

/**
 * Identidade visual do timbrado aplicado a todos os relatórios em PDF.
 * Cores em hexadecimal `#RRGGBB`. O código de rastreio é obrigatório
 * em todo documento (sem lisagem para desativá-lo).
 */
export interface LetterheadSettings {
  /** Preset aplicado por último ('custom' quando o operador editar cores). */
  presetId: string
  /** Cor primária: barra divisória, título e cabeçalho de tabelas. */
  primaryColor: string
  /** Cor de acento: filete fino abaixo da barra e detalhes. */
  accentColor: string
  /** Cor do texto principal. */
  inkColor: string
  /** Cor do texto secundário / metadados. */
  mutedColor: string
  /** Cor de fundo da faixa do título do relatório. */
  surfaceColor: string
  barStyle: LetterheadBarStyle
  /** Espessura da barra primária (1–4pt). */
  barWidth: number
  logoSize: LetterheadLogoSize
  titleFont: LetterheadTitleFont
  showCnpj: boolean
  showRegistrations: boolean
  showAddress: boolean
  showContact: boolean
  showManager: boolean
  showTradeName: boolean
  /**
   * Legado: o barcode (imagem) fica SEMPRE no cabeçalho da primeira
   * página, à direita acima da barra. Este campo é mantido por
   * compatibilidade e ignorado pelo renderizador; o código em texto
   * aparece no rodapé de todas as páginas.
   */
  showBarcodeOnAllPages: boolean
}

export interface AppSettings {
  theme: ThemePreference
  language: 'pt-BR'
  closeBehavior: CloseBehavior
  clipboardClearSeconds: number
  maskPasswords: boolean
  passwordRevealSeconds: number
  confirmOpenExternal: boolean
  sessionLimit: number
  autoCheckUpdates: boolean
  autoUpdateChannel: 'stable' | 'beta'
  idleLockMinutes: number
  retainAuditDays: number
  externalCnpjLookup: boolean
  signTsaUrl: string
  signStampReason: string
  office: OfficeProfile
  letterhead: LetterheadSettings
}

export interface AppInfo {
  name: string
  version: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  arch: string
  isDev: boolean
  safeStorageAvailable: boolean
  databasePath: string
  databaseSizeBytes: number
  userDataPath: string
  logsPath: string
  auditCount: number
  updateStatus: 'idle' | 'checking' | 'available' | 'not-available' | 'error' | 'disabled'
}

export interface UpdateCheckResult {
  status: AppInfo['updateStatus']
  version: string | null
  message: string
}

export interface SessionOpenRequest {
  serviceId: string
  clientId: string
  certificateId?: string | null
  authMethod: AuthMethod
  credentialId?: string | null
  forceNew?: boolean
  /** Origem do teste explícito do robô gravado (§14-F) — vai para o metadata do audit. */
  origin?: 'verify-test'
}

export interface SessionOpenResult {
  sessionId: string
  reused: boolean
}

export interface GeneratedPassword {
  password: string
  strength: number
}

export interface PasswordGeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
}

export interface CredentialCreateInput {
  clientId: string
  serviceId: string
  label: string
  username: string
  usernameType: UsernameType
  password: string
  notes?: string | null
  fields?: CredentialField[] | null
  isDefault?: boolean
}

export interface CredentialUpdateInput {
  label?: string
  username?: string
  usernameType?: UsernameType
  password?: string
  notes?: string | null
  fields?: CredentialField[] | null
  isDefault?: boolean
}

export interface ClientInput {
  type?: ClientType
  name?: string
  document: string
  email?: string | null
  phone?: string | null
  notes?: string | null
  /** Honorários em centavos (inteiro ≥ 0). null limpa o valor. */
  honorariosCents?: number | null
  tags?: string[]
  consent?: boolean
}

/** Dados publicos trazidos da Brasil API a partir de um CNPJ. */
export interface CnpjLookupResult {
  name: string | null
  tradeName: string | null
  email: string | null
  phone: string | null
  /** Inscrição municipal retornada pela Brasil API, quando disponível. */
  municipalRegistration?: string | null
  /** Inscrição estadual retornada pela Brasil API, quando disponível. */
  stateRegistration?: string | null
}

export type ClientBrasilApiRefreshStatus = 'updated' | 'skipped' | 'error'

export interface ClientBrasilApiRefreshItem {
  clientId: string
  document: string
  status: ClientBrasilApiRefreshStatus
  message: string | null
}

export interface ClientBrasilApiRefreshReport {
  total: number
  updated: number
  skipped: number
  errors: number
  items: ClientBrasilApiRefreshItem[]
}

export type ClientBrasilApiRefreshStage = 'starting' | 'updating' | 'done'

export interface ClientBrasilApiRefreshProgress {
  total: number
  completed: number
  remaining: number
  updated: number
  skipped: number
  errors: number
  currentClientId: string | null
  currentDocument: string | null
  currentName: string | null
  stage: ClientBrasilApiRefreshStage
}

export interface ServiceInput {
  name: string
  slug: string
  category: ServiceCategory
  baseUrl: string
  allowedDomains: string[]
  authMethods: AuthMethod[]
  defaultAuth: AuthMethod
  notes?: string | null
  enabled?: boolean
  favorite?: boolean
}

export interface RecipeTestResult {
  ok: boolean
  status: RecipeStatus
  message: string
  failedStep: number | null
  testedAt: string
}

export interface SessionErrorEvent {
  sessionId: string
  type: 'certificate_not_offered' | 'certificate_missing' | 'recipe_failed' | 'load_failed'
  message: string
}

/* ---------------------------------------------------------------------------
 * Módulo Obrigações
 * ------------------------------------------------------------------------- */

export type RecurrenceType =
  'mensal' | 'bimestral' | 'trimestral' | 'semestral' | 'anual' | 'eventual'
export type DueRuleType = 'dia_fixo' | 'dia_util'

export interface Department {
  id: string
  name: string
  description: string | null
  active: boolean
  /** Quantidade de obrigações vinculadas (ativas ou não). */
  obligationsCount: number
  createdAt: string
  updatedAt: string
}

export interface DepartmentInput {
  name: string
  description?: string | null
  active?: boolean
}

export interface Obligation {
  id: string
  name: string
  sigla: string
  description: string | null
  departmentId: string
  departmentName: string
  recurrence: RecurrenceType
  dueRule: DueRuleType | null
  diaFixo: number | null
  diaUtil: number | null
  mesReferencia: number | null
  antecedenciaNotificacaoDias: number
  active: boolean
  /** Próxima ocorrência (YYYY-MM-DD), null quando eventual. */
  nextDueDate: string | null
  createdAt: string
  updatedAt: string
}

export interface ObligationInput {
  name: string
  sigla: string
  description?: string | null
  departmentId: string
  recurrence: RecurrenceType
  dueRule?: DueRuleType | null
  diaFixo?: number | null
  diaUtil?: number | null
  mesReferencia?: number | null
  antecedenciaNotificacaoDias?: number
  active?: boolean
}

export interface ObligationGroupObligation {
  id: string
  sigla: string
  name: string
  departmentName: string
  recurrence: RecurrenceType
  active: boolean
}

export interface ObligationGroup {
  id: string
  name: string
  description: string | null
  obligationIds: string[]
  obligations: ObligationGroupObligation[]
  createdAt: string
  updatedAt: string
}

export interface ObligationGroupInput {
  name: string
  description?: string | null
  obligationIds: string[]
}

export interface ClientObligation {
  id: string
  clientId: string
  obligationId: string
  dataInicio: string
  dataFim: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface ApplyGroupInput {
  groupId: string
  clientIds: string[]
  dataInicio?: string | null
}

export interface ApplyGroupResult {
  created: number
  reactivated: number
  skipped: number
}

export interface PasteLinksInput {
  targetClientId: string
  obligationIds: string[]
  dataInicio?: string | null
}

export interface PasteLinksResult {
  created: number
  reactivated: number
  /** Obrigações que já estavam vinculadas (ativas) e foram ignoradas. */
  skipped: number
}

export interface SetLinkResult {
  link: ClientObligation
  created: boolean
  reactivated: boolean
  /** true quando o estado do vínculo foi efetivamente alterado. */
  changed: boolean
}

export type LinkStatusFilter = 'active' | 'inactive' | 'all'

export interface ObligationFilter {
  search?: string
  departmentId?: string | 'all'
  recurrence?: RecurrenceType | 'all'
  active?: 'active' | 'inactive' | 'all'
}

export interface ExtraHoliday {
  id: string
  /** AAAA-MM-DD */
  date: string
  name: string
  /** Chave de ícone (EXTRA_HOLIDAY_ICONS); null = bandeira. */
  icon: string | null
  /** Cor em hex (#RRGGBB); null = vermelho padrão. */
  color: string | null
  createdAt: string
}

export type NotificationType = 'obligation.due'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  obligationId: string | null
  clientId: string | null
  /** AAAA-MM-DD do vencimento que originou o aviso. */
  dueDate: string | null
  read: boolean
  createdAt: string
}

export interface NotificationList {
  notifications: AppNotification[]
  unreadCount: number
}

/* ---------------------------------------------------------------------------
 * Obrigações — entregas (baixa) e visão mensal
 * ------------------------------------------------------------------------- */

/**
 * Item da visão mensal: uma ocorrência (ou um vínculo eventual) de obrigação
 * para um cliente no mês selecionado.
 */
export interface ObligationMonthItem {
  linkId: string
  clientId: string
  clientName: string
  clientDocument: string
  obligationId: string
  sigla: string
  obligationName: string
  departmentName: string
  recurrence: RecurrenceType
  /** AAAA-MM-DD do vencimento no mês, ou null para obrigações eventuais. */
  dueDate: string | null
  /** Data de início do vínculo (AAAA-MM-DD). */
  dataInicio: string
  delivered: boolean
  deliveredAt: string | null
}

export interface SetDeliveryResult {
  delivered: boolean
  completedAt: string | null
}
