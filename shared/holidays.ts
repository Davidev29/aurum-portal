/**
 * Calendário de dias úteis brasileiro (feriados nacionais + extras configuráveis).
 *
 * Módulo puro e determinístico: usado pelo agendador de notificações (main
 * process), pelas telas (rótulos/prévias) e pelos testes unitários.
 * Datas usam sempre o formato `YYYY-MM-DD` (date-only), comparável como string.
 */

export interface NationalHoliday {
  date: string
  name: string
  /** true para os pontos facultativos tratados como não-úteis no cálculo. */
  facultative: boolean
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDateOnly(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function dateOnlyToUtc(dateStr: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  if (!match) throw new Error(`Data invalida (use AAAA-MM-DD): ${dateStr}`)
  const [, y, m, d] = match
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`Data invalida (use AAAA-MM-DD): ${dateStr}`)
  }
  return utc
}

function isValidDateOnly(dateStr: string): boolean {
  try {
    dateOnlyToUtc(dateStr)
    return true
  } catch {
    return false
  }
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && isValidDateOnly(value)
}

export function addDays(dateStr: string, days: number): string {
  const utc = dateOnlyToUtc(dateStr)
  utc.setUTCDate(utc.getUTCDate() + days)
  return `${utc.getUTCFullYear()}-${pad2(utc.getUTCMonth() + 1)}-${pad2(utc.getUTCDate())}`
}

export function weekdayOf(dateStr: string): number {
  return dateOnlyToUtc(dateStr).getUTCDay()
}

export function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate()
}

/** Páscoa pelo algoritmo gregoriano anônimo (Butcher/Meeus). */
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = março, 4 = abril
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function holiday(date: Date, name: string, facultative = false): NationalHoliday {
  return {
    date: `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`,
    name,
    facultative,
  }
}

/**
 * Feriados nacionais: oficiais (incl. Sexta-feira da Paixão, feriado nacional)
 * mais os pontos facultativos de impacto fiscal/bancário (Carnaval e Corpus
 * Christi), tratados como não-úteis para o cálculo de vencimentos.
 */
export function getNationalHolidays(year: number): NationalHoliday[] {
  const fixed: NationalHoliday[] = [
    { date: `${year}-01-01`, name: 'Confraternização Universal', facultative: false },
    { date: `${year}-04-21`, name: 'Tiradentes', facultative: false },
    { date: `${year}-05-01`, name: 'Dia do Trabalho', facultative: false },
    { date: `${year}-09-07`, name: 'Independência do Brasil', facultative: false },
    { date: `${year}-10-12`, name: 'Nossa Senhora Aparecida', facultative: false },
    { date: `${year}-11-02`, name: 'Finados', facultative: false },
    { date: `${year}-11-15`, name: 'Proclamação da República', facultative: false },
    { date: `${year}-11-20`, name: 'Consciência Negra', facultative: false },
    { date: `${year}-12-25`, name: 'Natal', facultative: false },
  ]
  const easter = easterSunday(year)
  const relative = (offsetDays: number) => {
    const d = new Date(easter.getTime())
    d.setUTCDate(d.getUTCDate() + offsetDays)
    return d
  }
  const movable: NationalHoliday[] = [
    holiday(relative(-48), 'Carnaval (segunda-feira)', true),
    holiday(relative(-47), 'Carnaval (terça-feira)', true),
    holiday(relative(-2), 'Sexta-feira da Paixão'),
    holiday(relative(60), 'Corpus Christi', true),
  ]
  return [...fixed, ...movable].sort((a, b) => a.date.localeCompare(b.date))
}

/** Conjunto de datas (YYYY-MM-DD) não-úteis, incluindo extras. */
export function holidayDateSet(
  years: Iterable<number>,
  extraHolidays: Iterable<string>,
): Set<string> {
  const set = new Set<string>()
  for (const year of years) {
    for (const h of getNationalHolidays(year)) set.add(h.date)
  }
  for (const extra of extraHolidays) {
    if (isDateOnly(extra)) set.add(extra)
  }
  return set
}

export function isBusinessDay(dateStr: string, extraHolidays: Iterable<string> = []): boolean {
  const weekday = weekdayOf(dateStr)
  if (weekday === 0 || weekday === 6) return false
  const year = Number(dateStr.slice(0, 4))
  const set = holidayDateSet([year], extraHolidays)
  return !set.has(dateStr)
}

/**
 * Data do N-ésimo dia útil do mês (1 = primeiro dia útil). Retorna null quando
 * o mês não possui N dias úteis (ex.: 10º dia útil em mês curto).
 */
export function nthBusinessDayOfMonth(
  year: number,
  monthIndex0: number,
  n: number,
  extraHolidays: Iterable<string> = [],
): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 31) return null
  const set = holidayDateSet([year], extraHolidays)
  const total = lastDayOfMonth(year, monthIndex0)
  let counted = 0
  for (let day = 1; day <= total; day++) {
    const dateStr = `${year}-${pad2(monthIndex0 + 1)}-${pad2(day)}`
    const weekday = weekdayOf(dateStr)
    if (weekday === 0 || weekday === 6) continue
    if (set.has(dateStr)) continue
    counted += 1
    if (counted === n) return dateStr
  }
  return null
}

/** Formata YYYY-MM-DD como DD/MM/AAAA (pt-BR). */
export function formatDateBr(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr)
  if (!match) return dateStr
  return `${match[3]}/${match[2]}/${match[1]}`
}

/* ---------------------------------------------------------------------------
 * Feriados extras — apresentação (ícone e cor) configurável por feriado.
 * As chaves de ícone mapeiam para componentes lucide no renderer; aqui ficam
 * apenas os valores válidos para validação (zod) e defaults compartilhados.
 * ------------------------------------------------------------------------- */

export const EXTRA_HOLIDAY_ICONS = [
  'flag',
  'palmtree',
  'star',
  'flame',
  'sun',
  'coffee',
  'cake',
  'church',
  'skull',
  'sparkles',
  'party',
  'heart',
] as const
export type ExtraHolidayIcon = (typeof EXTRA_HOLIDAY_ICONS)[number]

/** Cores pré-definidas (hex #RRGGBB) disponíveis para feriados extras. */
export const EXTRA_HOLIDAY_COLORS = [
  '#b91c1c', // vermelho — clássico
  '#c2410c', // laranja queimado
  '#a8853f', // dourado (marca)
  '#15803d', // verde
  '#3f4c5e', // ardósia
  '#6d28d9', // violeta
] as const

export const EXTRA_HOLIDAY_ICON_DEFAULT: ExtraHolidayIcon = 'flag'
export const EXTRA_HOLIDAY_COLOR_DEFAULT = EXTRA_HOLIDAY_COLORS[0]

/** Defaults de apresentação para feriados nacionais (não personalizáveis). */
export const NATIONAL_HOLIDAY_PRESENTATION: Record<
  'official' | 'facultative',
  { icon: ExtraHolidayIcon; color: string }
> = {
  official: { icon: 'flag', color: '#b91c1c' },
  facultative: { icon: 'sparkles', color: '#a8853f' },
}
