/**
 * Apresentação dos feriados no renderer: ícones (lucide) e cores.
 * Os valores válidos (chaves de ícone e swatches) vivem em @shared/holidays;
 * aqui apenas o mapeamento para componentes de UI.
 */
import {
  Cake,
  Church,
  Coffee,
  Flag,
  Flame,
  Heart,
  Palmtree,
  PartyPopper,
  Skull,
  Sparkles,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import {
  EXTRA_HOLIDAY_COLOR_DEFAULT,
  EXTRA_HOLIDAY_COLORS,
  EXTRA_HOLIDAY_ICON_DEFAULT,
  EXTRA_HOLIDAY_ICONS,
  type ExtraHolidayIcon,
} from '@shared/holidays'

export { EXTRA_HOLIDAY_COLORS, EXTRA_HOLIDAY_COLOR_DEFAULT }

const ICON_MAP: Record<ExtraHolidayIcon, { label: string; Icon: LucideIcon }> = {
  flag: { label: 'Bandeira', Icon: Flag },
  palmtree: { label: 'Folga', Icon: Palmtree },
  star: { label: 'Marco', Icon: Star },
  flame: { label: 'Cívico/religioso', Icon: Flame },
  sun: { label: 'Verão', Icon: Sun },
  coffee: { label: 'Facultativo', Icon: Coffee },
  cake: { label: 'Aniversário', Icon: Cake },
  church: { label: 'Religioso', Icon: Church },
  skull: { label: 'Finados', Icon: Skull },
  sparkles: { label: 'Especial', Icon: Sparkles },
  party: { label: 'Festa', Icon: PartyPopper },
  heart: { label: 'Afetivo', Icon: Heart },
}

export const HOLIDAY_ICON_OPTIONS = EXTRA_HOLIDAY_ICONS.map((key) => ({
  key,
  ...ICON_MAP[key],
}))

export function holidayIconOf(icon: string | null | undefined): LucideIcon {
  return ICON_MAP[(icon as ExtraHolidayIcon) || EXTRA_HOLIDAY_ICON_DEFAULT]?.Icon ?? Flag
}

export function holidayColorOf(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : EXTRA_HOLIDAY_COLOR_DEFAULT
}

export interface DayHoliday {
  name: string
  icon: string
  color: string
  /** true para feriados cadastrados pelo operador; false para nacionais. */
  custom: boolean
}
