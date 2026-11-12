import type { LetterheadSettings } from './types'
export type { LetterheadSettings } from './types'

/**
 * Timbrado padrão dos relatórios: presets, padrões e código de rastreio.
 *
 * Fonte única de verdade para a identidade visual dos documentos gerados
 * localmente. Sem servidor: o código é único por documento e verificável
 * offline pelo dígito de verificação (dois dígitos, estilo mod-97).
 */

export interface LetterheadPreset {
  id: string
  name: string
  description: string
  category: string
  colors: Pick<
    LetterheadSettings,
    'primaryColor' | 'accentColor' | 'inkColor' | 'mutedColor' | 'surfaceColor'
  >
}

/** Mini biblioteca de 20 temas: agrupa por família para facilitar a escolha. */
export const LETTERHEAD_PRESET_CATEGORIES = [
  'Clássicos',
  'Verdes',
  'Azulados',
  'Quentes',
  'Neutros',
] as const

export const LETTERHEAD_PRESETS: LetterheadPreset[] = [
  {
    id: 'institucional',
    name: 'Institucional',
    description: 'Azul governamental do AurumBit Portal.',
    category: 'Clássicos',
    colors: {
      primaryColor: '#243C9E',
      accentColor: '#C9A227',
      inkColor: '#0F1B2D',
      mutedColor: '#475569',
      surfaceColor: '#EAF0FE',
    },
  },
  {
    id: 'grafite',
    name: 'Grafite Editorial',
    description: 'Cinza sóbrio, clássico e atemporal.',
    category: 'Clássicos',
    colors: {
      primaryColor: '#1F2937',
      accentColor: '#9CA3AF',
      inkColor: '#111827',
      mutedColor: '#4B5563',
      surfaceColor: '#F3F4F6',
    },
  },
  {
    id: 'fiscal',
    name: 'Verde Fiscal',
    description: 'Verde profundo, leitura formal.',
    category: 'Clássicos',
    colors: {
      primaryColor: '#14532D',
      accentColor: '#84CC16',
      inkColor: '#052E16',
      mutedColor: '#3F6212',
      surfaceColor: '#F0FDF4',
    },
  },
  {
    id: 'dourado',
    name: 'Dourado Clássico',
    description: 'Marinho com filete dourado.',
    category: 'Clássicos',
    colors: {
      primaryColor: '#1E3A5F',
      accentColor: '#C9A227',
      inkColor: '#0B1C2E',
      mutedColor: '#475569',
      surfaceColor: '#F8F5EA',
    },
  },
  {
    id: 'minimalista',
    name: 'Minimalista',
    description: 'Preto no branco, sem faixas de cor.',
    category: 'Clássicos',
    colors: {
      primaryColor: '#111827',
      accentColor: '#111827',
      inkColor: '#111827',
      mutedColor: '#6B7280',
      surfaceColor: '#FFFFFF',
    },
  },
  {
    id: 'esmeralda',
    name: 'Esmeralda',
    description: 'Verde joia, fresco e confiável.',
    category: 'Verdes',
    colors: {
      primaryColor: '#065F46',
      accentColor: '#34D399',
      inkColor: '#022C22',
      mutedColor: '#047857',
      surfaceColor: '#ECFDF5',
    },
  },
  {
    id: 'oliva',
    name: 'Oliva',
    description: 'Verde campestre, discreto.',
    category: 'Verdes',
    colors: {
      primaryColor: '#3F6212',
      accentColor: '#A3E635',
      inkColor: '#1A2E05',
      mutedColor: '#65A30D',
      surfaceColor: '#F7FEE7',
    },
  },
  {
    id: 'petroleo',
    name: 'Petróleo',
    description: 'Verde azulado profundo.',
    category: 'Verdes',
    colors: {
      primaryColor: '#155E63',
      accentColor: '#2DD4BF',
      inkColor: '#042F2E',
      mutedColor: '#0F766E',
      surfaceColor: '#F0FDFA',
    },
  },
  {
    id: 'oceano',
    name: 'Oceano Profundo',
    description: 'Azul-petróleo com brilho frio.',
    category: 'Azulados',
    colors: {
      primaryColor: '#083344',
      accentColor: '#22D3EE',
      inkColor: '#082F3A',
      mutedColor: '#155E75',
      surfaceColor: '#ECFEFF',
    },
  },
  {
    id: 'indigo',
    name: 'Índigo',
    description: 'Roxo-azulado moderno.',
    category: 'Azulados',
    colors: {
      primaryColor: '#3730A3',
      accentColor: '#818CF8',
      inkColor: '#1E1B4B',
      mutedColor: '#4338CA',
      surfaceColor: '#EEF2FF',
    },
  },
  {
    id: 'marinho',
    name: 'Marinho',
    description: 'Azul-noite austero.',
    category: 'Azulados',
    colors: {
      primaryColor: '#172554',
      accentColor: '#60A5FA',
      inkColor: '#020617',
      mutedColor: '#1D4ED8',
      surfaceColor: '#EFF6FF',
    },
  },
  {
    id: 'horizonte',
    name: 'Horizonte',
    description: 'Azul céu, leve e claro.',
    category: 'Azulados',
    colors: {
      primaryColor: '#0369A1',
      accentColor: '#7DD3FC',
      inkColor: '#082F49',
      mutedColor: '#0284C7',
      surfaceColor: '#F0F9FF',
    },
  },
  {
    id: 'bordo',
    name: 'Bordô',
    description: 'Vinho clássico com filete dourado.',
    category: 'Quentes',
    colors: {
      primaryColor: '#7F1D1D',
      accentColor: '#D4A017',
      inkColor: '#450A0A',
      mutedColor: '#991B1B',
      surfaceColor: '#FEF2F2',
    },
  },
  {
    id: 'terracota',
    name: 'Terracota',
    description: 'Laranja queimado terroso.',
    category: 'Quentes',
    colors: {
      primaryColor: '#9A3412',
      accentColor: '#F59E0B',
      inkColor: '#431407',
      mutedColor: '#9A3412',
      surfaceColor: '#FFF7ED',
    },
  },
  {
    id: 'areia',
    name: 'Areia',
    description: 'Âmbar quente e acolhedor.',
    category: 'Quentes',
    colors: {
      primaryColor: '#92400E',
      accentColor: '#D97706',
      inkColor: '#451A03',
      mutedColor: '#B45309',
      surfaceColor: '#FFFBEB',
    },
  },
  {
    id: 'rosa-queimado',
    name: 'Rosa Queimado',
    description: 'Magenta profundo, marcante.',
    category: 'Quentes',
    colors: {
      primaryColor: '#9D174D',
      accentColor: '#F472B6',
      inkColor: '#500724',
      mutedColor: '#BE185D',
      surfaceColor: '#FDF2F8',
    },
  },
  {
    id: 'ardosia',
    name: 'Ardósia',
    description: 'Cinza azulado de pedra.',
    category: 'Neutros',
    colors: {
      primaryColor: '#334155',
      accentColor: '#94A3B8',
      inkColor: '#0F172A',
      mutedColor: '#475569',
      surfaceColor: '#F1F5F9',
    },
  },
  {
    id: 'urbano',
    name: 'Cinza Urbano',
    description: 'Cinza neutro contemporâneo.',
    category: 'Neutros',
    colors: {
      primaryColor: '#3F3F46',
      accentColor: '#A1A1AA',
      inkColor: '#18181B',
      mutedColor: '#52525B',
      surfaceColor: '#F4F4F5',
    },
  },
  {
    id: 'prata',
    name: 'Prata',
    description: 'Cinza claro, quase monocromático.',
    category: 'Neutros',
    colors: {
      primaryColor: '#525252',
      accentColor: '#A3A3A3',
      inkColor: '#171717',
      mutedColor: '#404040',
      surfaceColor: '#FAFAFA',
    },
  },
  {
    id: 'carbono',
    name: 'Carbono',
    description: 'Preto suave sobre branco puro.',
    category: 'Neutros',
    colors: {
      primaryColor: '#18181B',
      accentColor: '#71717A',
      inkColor: '#09090B',
      mutedColor: '#3F3F46',
      surfaceColor: '#FFFFFF',
    },
  },
]

export const DEFAULT_LETTERHEAD: LetterheadSettings = {
  presetId: 'institucional',
  primaryColor: '#243C9E',
  accentColor: '#C9A227',
  inkColor: '#0F1B2D',
  mutedColor: '#475569',
  surfaceColor: '#EAF0FE',
  barStyle: 'solid',
  barWidth: 3,
  logoSize: 'm',
  titleFont: 'helvetica',
  showCnpj: true,
  showRegistrations: true,
  showAddress: true,
  showContact: true,
  showManager: true,
  showTradeName: true,
  showBarcodeOnAllPages: true,
}

/** Aplica um preset sobre as cores atuais (mantém barra, tamanhos e visibilidade). */
export function applyLetterheadPreset(
  current: LetterheadSettings,
  presetId: string,
): LetterheadSettings {
  const preset = LETTERHEAD_PRESETS.find((item) => item.id === presetId)
  if (!preset) return current
  return { ...current, presetId: preset.id, ...preset.colors }
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

/** `#RRGGBB` → canal RGB em 0..1 (pdf-lib). Cor inválida vira preto. */
export function hexToRgbTuple(value: string): [number, number, number] {
  if (!isHexColor(value)) return [0, 0, 0]
  const r = Number.parseInt(value.slice(1, 3), 16) / 255
  const g = Number.parseInt(value.slice(3, 5), 16) / 255
  const b = Number.parseInt(value.slice(5, 7), 16) / 255
  return [r, g, b]
}

/* ------------------------------------------------------------------ */
/* Código de rastreio: PV-AAAAMM-XXXXXXXX-DD                          */
/* ------------------------------------------------------------------ */

/** Alfabeto sem caracteres ambíguos (sem 0/O/1/I/L). */
export const TRACKING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const TRACKING_CODE_PATTERN = /^PV-\d{6}-[A-Z2-9]{8}-\d{2}$/

function yyyymmOf(date: Date): string {
  const year = UTC(date.getUTCFullYear())
  const month = UTC(date.getUTCMonth() + 1)
  return `${year}${month}`
}

function UTC(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Dígitos de verificação (mod-97 sobre ano-mês + corpo).
 * Determinístico: permite validar o código offline sem servidor.
 */
export function trackingCheckDigits(prefix: string, body: string): string {
  const numeric = `${prefix}${body}`.replace(/[A-Z]/g, (char) => {
    const index = TRACKING_ALPHABET.indexOf(char)
    return index >= 0 ? String(index).padStart(2, '0') : char
  })
  let remainder = 0
  for (const digit of numeric) {
    remainder = (remainder * 10 + Number(digit)) % 97
  }
  return String(remainder).padStart(2, '0')
}

/**
 * Gera um código de rastreio único: `PV-AAAAMM-XXXXXXXX-DD`.
 * `random` é injetável para testes determinísticos.
 */
export function generateTrackingCode(
  date: Date = new Date(),
  random: () => number = Math.random,
): string {
  const prefix = yyyymmOf(date)
  let body = ''
  for (let index = 0; index < 8; index += 1) {
    const slot = Math.floor(random() * TRACKING_ALPHABET.length)
    body += TRACKING_ALPHABET[Math.min(slot, TRACKING_ALPHABET.length - 1)]
  }
  return `PV-${prefix}-${body}-${trackingCheckDigits(prefix, body)}`
}

/** true quando formato + dígito de verificação conferem. */
export function isValidTrackingCode(code: string): boolean {
  const trimmed = (code ?? '').trim().toUpperCase()
  if (!TRACKING_CODE_PATTERN.test(trimmed)) return false
  const parts = trimmed.split('-')
  if (parts.length !== 4) return false
  const [, prefix, body, check] = parts as [string, string, string, string]
  return trackingCheckDigits(prefix, body) === check
}
