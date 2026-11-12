import { z } from 'zod'
import type { AppSettings, LetterheadSettings, OfficeProfile } from './types'
import { DEFAULT_LETTERHEAD } from './letterhead'
import { isValidCNPJ, isValidCPF, onlyDigits } from './validation'

export const DEFAULT_OFFICE_PROFILE: OfficeProfile = {
  legalName: '',
  tradeName: '',
  cnpj: '',
  managerName: '',
  managerCpf: '',
  municipalRegistration: '',
  stateRegistration: '',
  address: '',
  city: '',
  state: '',
  phone: '',
  email: '',
  website: '',
  registration: '',
  logoBase64: null,
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'pt-BR',
  closeBehavior: 'ask',
  clipboardClearSeconds: 30,
  maskPasswords: true,
  passwordRevealSeconds: 12,
  confirmOpenExternal: true,
  sessionLimit: 20,
  autoCheckUpdates: false,
  autoUpdateChannel: 'stable',
  idleLockMinutes: 0,
  retainAuditDays: 365,
  externalCnpjLookup: false,
  signTsaUrl: 'https://timestamp.digicert.com',
  signStampReason: 'Documento assinado digitalmente',
  office: { ...DEFAULT_OFFICE_PROFILE },
  letterhead: { ...DEFAULT_LETTERHEAD },
}

/**
 * Logomarca do escritório convertida para Base64 (Data URL).
 *
 * - Apenas PNG, JPEG e WebP: são renderizados com segurança em `<img>` e em
 *   relatórios (PDF/impressão). SVG fica fora para evitar risco de script
 *   embutido em um schema compartilhado entre renderer e processo principal.
 * - Limite de 1 MB de imagem (≈ 1,4 MB em Base64), alinhado ao logo de
 *   serviços (`MAX_LOGO_BYTES` em `electron/main/services/logo.ts`).
 */
export const MAX_OFFICE_LOGO_BYTES = 1024 * 1024
export const MAX_OFFICE_LOGO_DATA_URL_CHARS = 1_500_000

const LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export const officeLogoBase64Schema = z
  .string()
  .max(MAX_OFFICE_LOGO_DATA_URL_CHARS, 'A logomarca deve ter no máximo 1 MB.')
  .refine(
    (value) => LOGO_DATA_URL_PATTERN.test(value),
    'A logomarca deve ser uma imagem PNG, JPG ou WebP.',
  )

/** CNPJ do escritório: vazio ou CNPJ válido; armazenado só com dígitos. */
export const officeCnpjSchema = z
  .string()
  .trim()
  .max(18)
  .transform((value) => onlyDigits(value))
  .refine((value) => value === '' || isValidCNPJ(value), {
    message: 'CNPJ do escritório inválido',
  })

/** CPF do gestor: vazio ou CPF válido; armazenado só com dígitos. */
export const officeManagerCpfSchema = z
  .string()
  .trim()
  .max(14)
  .transform((value) => onlyDigits(value))
  .refine((value) => value === '' || isValidCPF(value), {
    message: 'CPF do gestor inválido',
  })

export const officeProfileSchema = z.object({
  legalName: z.string().trim().max(200),
  tradeName: z.string().trim().max(200),
  cnpj: officeCnpjSchema,
  managerName: z.string().trim().max(200),
  managerCpf: officeManagerCpfSchema,
  municipalRegistration: z.string().trim().max(30),
  stateRegistration: z.string().trim().max(30),
  address: z.string().trim().max(255).default(''),
  city: z.string().trim().max(120).default(''),
  state: z.string().trim().toUpperCase().max(2).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z
    .union([z.string().trim().max(254), z.literal('')])
    .refine((value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'E-mail do escritório inválido',
    })
    .default(''),
  website: z.string().trim().max(200).default(''),
  registration: z.string().trim().max(30).default(''),
  logoBase64: officeLogoBase64Schema.nullable(),
})

const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor hexadecimal #RRGGBB')

export const letterheadSettingsSchema = z.object({
  presetId: z.string().trim().min(1).max(40),
  primaryColor: hexColorSchema,
  accentColor: hexColorSchema,
  inkColor: hexColorSchema,
  mutedColor: hexColorSchema,
  surfaceColor: hexColorSchema,
  barStyle: z.enum(['solid', 'double', 'thin']),
  barWidth: z.number().int().min(1).max(4),
  logoSize: z.enum(['s', 'm', 'l']),
  titleFont: z.enum(['helvetica', 'times']),
  showCnpj: z.boolean(),
  showRegistrations: z.boolean(),
  showAddress: z.boolean(),
  showContact: z.boolean(),
  showManager: z.boolean(),
  showTradeName: z.boolean(),
  showBarcodeOnAllPages: z.boolean(),
})

export type LetterheadSchema = z.infer<typeof letterheadSettingsSchema>
export type { LetterheadSettings }

export const appSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
  language: z.literal('pt-BR'),
  closeBehavior: z.enum(['quit', 'ask']),
  clipboardClearSeconds: z.number().int().min(5).max(300),
  maskPasswords: z.boolean(),
  passwordRevealSeconds: z.number().int().min(3).max(120),
  confirmOpenExternal: z.boolean(),
  sessionLimit: z.number().int().min(2).max(40),
  autoCheckUpdates: z.boolean(),
  autoUpdateChannel: z.enum(['stable', 'beta']),
  idleLockMinutes: z.number().int().min(0).max(240),
  retainAuditDays: z.number().int().min(30).max(3650),
  externalCnpjLookup: z.boolean(),
  // TSA usada no PAdES-B-T (RFC 3161). DigiCert publica timestamp gratuito em
  // https://timestamp.digicert.com; o operador pode trocar por outra TSA (ex.: ICP-Brasil).
  signTsaUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine((value) => /^https?:$/.test(new URL(value).protocol), 'A TSA deve usar HTTP ou HTTPS'),
  signStampReason: z.string().trim().min(3).max(120),
  office: officeProfileSchema,
  letterhead: letterheadSettingsSchema,
})

export function coerceSettings(raw: unknown): AppSettings {
  const base = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const merged: Record<string, unknown> = {
    ...(DEFAULT_SETTINGS as unknown as Record<string, unknown>),
  }
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
    if (!(key in base) || base[key] === undefined) continue
    if (key === 'office' || key === 'letterhead') {
      // `office`/`letterhead` são objetos aninhados: mescla campo a campo
      // para não apagar os demais dados ao salvar apenas parte (ex.:
      // ajustes parciais via IPC) e manter compatibilidade com bancos
      // salvos antes da criação destes campos.
      const defaults = key === 'office' ? DEFAULT_OFFICE_PROFILE : DEFAULT_LETTERHEAD
      const incoming = base[key]
      const incomingObject =
        typeof incoming === 'object' && incoming !== null
          ? (incoming as Record<string, unknown>)
          : {}
      merged[key] = { ...defaults, ...incomingObject }
      continue
    }
    merged[key] = base[key]
  }
  const parsed = appSettingsSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_SETTINGS
}
