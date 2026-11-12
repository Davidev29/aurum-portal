/**
 * Utilitários determinísticos para a suíte de stress (tests/stress/).
 *
 * Nenhum documento real é usado: CPFs/CNPJs são gerados com dígitos
 * verificadores válidos a partir de um índice sequencial + PRNG mulberry32.
 */

/** PRNG determinístico (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function digits11(body: number[], weights: number[]): number {
  const sum = body.reduce((acc, digit, index) => acc + digit * (weights[index] ?? 0), 0)
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

/** CNPJ válido e único para `seq` (base alfanumérica numérica de 12 dígitos). */
export function makeValidCnpj(seq: number): string {
  const base = String(seq).padStart(12, '0').slice(-12).split('').map(Number)
  const d1 = digits11(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digits11([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return [...base, d1, d2].join('')
}

/** CPF válido e único para `seq` (base de 9 dígitos). */
export function makeValidCpf(seq: number): string {
  const base = String(seq).padStart(9, '0').slice(-9).split('').map(Number)
  const d1 = digits11(base, [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digits11([...base, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return [...base, d1, d2].join('')
}

/** Senha sintética não-real para carga. */
export function syntheticPassword(seq: number): string {
  return `Stress!2026-${String(seq).padStart(5, '0')}`
}

/** Imprime métrica estruturada no console para coleta pelo orquestrador. */
export function logMetric(metric: string, data: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log('[stress]', JSON.stringify({ metric, ...data }))
}
