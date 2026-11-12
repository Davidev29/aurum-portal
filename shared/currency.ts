/**
 * Honorários e valores monetários em centavos (inteiro).
 *
 * Por que centavos: evita os erros de arredondamento de ponto flutuante em
 * valores financeiros. O banco guarda `honorarios_cents` (INTEGER, nulo =
 * não informado); a UI formata com `Intl.NumberFormat('pt-BR', BRL)`.
 */

export const MAX_HONORARIOS_CENTS = 99_999_999_999 // R$ 999.999.999,99

const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})
const BRL_PLAIN_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Centavos → "R$ 1.234,56" (ou "—" quando não informado). */
export function formatCentsToBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—'
  return BRL_FORMATTER.format(cents / 100)
}

/** Centavos → "1.234,56" (sem o símbolo, útil para relatórios/CSV). */
export function formatCentsToPlain(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return ''
  return BRL_PLAIN_FORMATTER.format(cents / 100)
}

/**
 * Dígitos digitados no campo mascarado → centavos.
 * '' (vazio) vira null (não informado). Valores acima do teto são truncados.
 */
export function digitsToCents(digits: string): number | null {
  const clean = (digits ?? '').replace(/\D+/g, '')
  if (!clean) return null
  const value = Number.parseInt(clean, 10)
  if (!Number.isFinite(value)) return null
  return Math.min(value, MAX_HONORARIOS_CENTS)
}

/** Centavos → dígitos crus do campo mascarado ('123456' → R$ 1.234,56). */
export function centsToDigits(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return ''
  return String(Math.max(0, Math.trunc(cents)))
}

/** Valor exibido no input mascarado a partir dos dígitos crus. */
export function digitsToCurrencyText(digits: string): string {
  const cents = digitsToCents(digits)
  if (cents === null) return ''
  return BRL_FORMATTER.format(cents / 100)
}
