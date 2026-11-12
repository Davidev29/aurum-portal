export const APP_NAME = 'AurumBit Portal'
/** Nome de apresentação da ferramenta (marcas/assinatura); APP_NAME segue como nome técnico. */
export const APP_DISPLAY_NAME = 'AurumBit Portal'
/** Logomarca do software (arquivo em `public/`, servido na raiz). */
export const APP_LOGO_FILE = 'Logomarca da empresa.png'
export const APP_LOGO_URL = '/Logomarca%20da%20empresa.png'
export const APP_PROTOCOL = 'aurumbit'
export const APP_SCHEME = 'app'
export const APP_HOST = 'aurumbit-portal'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`
export const DEFAULT_CLIPBOARD_CLEAR_SECONDS = 30
export const MAX_CLIPBOARD_CLEAR_SECONDS = 300
export const SESSION_WARNING_THRESHOLD = 12
export const DEFAULT_SESSION_LIMIT = 20
export const CERTIFICATE_WARNING_DAYS = [30] as const
export const SESSION_CHROME_HEIGHT = 96
export const SESSION_CHROME_FOOTER_HEIGHT = 26

export const SERVICE_CATEGORIES = [
  'Governo Federal',
  'Governo Estadual',
  'Prefeituras',
  'Outros',
] as const

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]

export const AUTH_METHODS = ['certificate', 'password'] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

export const AUTH_METHOD_LABELS: Record<AuthMethod, string> = {
  certificate: 'Certificado',
  password: 'Senha',
}

export const CERTIFICATE_WARNING_LABEL = 'A vencer'

export const BUILTIN_SERVICE_IDS = {
  govbr: 'builtin-govbr',
  redesim: 'builtin-redesim',
  ecac: 'builtin-ecac',
  jucec: 'builtin-jucec',
  pendenciasCnpj: 'builtin-pendencias-cnpj',
  fgtsDigital: 'builtin-fgts-digital',
  esocial: 'builtin-esocial',
  detTrabalhista: 'builtin-det-trabalhista',
  sigaSefazCe: 'builtin-siga-sefaz-ce',
  simplesNacional: 'builtin-simples-nacional',
  registrato: 'builtin-registrato',
  dteSefazCe: 'builtin-dte-sefaz-ce',
  speedgovTiangua: 'builtin-speedgov-tiangua',
  speedgovJuazeiroDoNorte: 'builtin-speedgov-juazeiro-do-norte',
  speedgovTaua: 'builtin-speedgov-taua',
  speedgovItarema: 'builtin-speedgov-itarema',
  speedgovPindoretama: 'builtin-speedgov-pindoretama',
  speedgovLimoeiroDoNorte: 'builtin-speedgov-limoeiro-do-norte',
  speedgovSobral: 'builtin-speedgov-sobral',
  speedgovCrateus: 'builtin-speedgov-crateus',
  speedgovIcapui: 'builtin-speedgov-icapui',
  speedgovParacuru: 'builtin-speedgov-paracuru',
} as const

export const AUDIT_TYPES = [
  'app.started',
  'app.locked',
  'app.unlocked',
  'client.created',
  'client.updated',
  'client.archived',
  'client.restored',
  'client.consent_recorded',
  'credential.created',
  'credential.updated',
  'credential.deleted',
  'credential.revealed',
  'credential.copied',
  'credential.password_generated',
  'credential.default_changed',
  'certificate.imported',
  'certificate.import_failed',
  'certificate.batch_started',
  'certificate.batch_finished',
  'certificate.installed',
  'certificate.install_failed',
  'certificate.removed',
  'certificate.linked',
  'certificate.unlinked',
  'certificate.test_completed',
  'certificate.selected',
  'certificate.not_offered',
  'certificate.cancelled',
  'service.created',
  'service.updated',
  'service.deleted',
  'service.restored',
  'session.opened',
  'session.closed',
  'session.auth_detected',
  'session.recipe_failed',
  'session.manual_mode',
  'recipe.updated',
  'settings.updated',
  'audit.exported',
  'backup.created',
  'update.checked',
  'app.second_instance',
  'department.created',
  'department.updated',
  'department.inactivated',
  'department.reactivated',
  'department.deleted',
  'obligation.created',
  'obligation.updated',
  'obligation.inactivated',
  'obligation.reactivated',
  'obligation.deleted',
  'obligation_group.created',
  'obligation_group.updated',
  'obligation_group.deleted',
  'obligation_group.applied',
  'obligation_link.created',
  'obligation_link.reactivated',
  'obligation_link.removed',
  'obligation_link.updated',
  'obligation_link.deleted',
  'obligation_link.pasted',
  'obligation_delivery.completed',
  'obligation_delivery.reverted',
  'holiday.added',
  'holiday.removed',
  'obligation.notifications_sent',
] as const

export type AuditType = (typeof AUDIT_TYPES)[number]

export const RECIPE_ACTIONS = [
  'goto',
  'waitFor',
  'waitForURL',
  'click',
  'fill',
  'press',
  'evaluate',
  'assert',
  'sleep',
] as const

export type RecipeAction = (typeof RECIPE_ACTIONS)[number]

export const SESSION_STATUSES = [
  'opening',
  'awaiting_login',
  'authenticated',
  'manual',
  'error',
  'closed',
] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const CERTIFICATE_STATUSES = [
  'valid',
  'expiring',
  'expired',
  'in_vault',
  'missing_windows',
  'chain_incomplete',
] as const

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number]
