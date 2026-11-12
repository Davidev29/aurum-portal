import { randomInt } from 'node:crypto'
import type { GeneratedPassword, PasswordGeneratorOptions } from '../../../shared/types'

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const NUMBERS = '23456789'
const SYMBOLS = '!@#$%&*+-=?'

export function generatePassword(options: Partial<PasswordGeneratorOptions> = {}): GeneratedPassword {
  const config: PasswordGeneratorOptions = {
    length: options.length ?? 24,
    uppercase: options.uppercase ?? true,
    lowercase: options.lowercase ?? true,
    numbers: options.numbers ?? true,
    symbols: options.symbols ?? true,
  }
  const length = Math.max(8, Math.min(128, Math.floor(config.length)))
  const groups: string[] = []
  if (config.uppercase) groups.push(UPPER)
  if (config.lowercase) groups.push(LOWER)
  if (config.numbers) groups.push(NUMBERS)
  if (config.symbols) groups.push(SYMBOLS)
  if (groups.length === 0) throw new Error('Selecione ao menos um tipo de caractere')

  const all = groups.join('')
  const chars: string[] = groups.map((group) => group[randomInt(0, group.length)] ?? '')
  while (chars.length < length) {
    chars.push(all[randomInt(0, all.length)] ?? '')
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1)
    const tmp = chars[i] as string
    chars[i] = chars[j] as string
    chars[j] = tmp
  }
  const password = chars.join('')
  return { password, strength: estimatePasswordStrength(password) }
}

export function estimatePasswordStrength(password: string): number {
  if (!password) return 0
  let classes = 0
  if (/[a-z]/.test(password)) classes += 1
  if (/[A-Z]/.test(password)) classes += 1
  if (/\d/.test(password)) classes += 1
  if (/[^A-Za-z0-9]/.test(password)) classes += 1
  const unique = new Set(password).size
  const lengthScore = Math.min(4, Math.floor(password.length / 8))
  const classScore = Math.max(0, classes - 1)
  const uniqueScore = unique >= 12 ? 1 : 0
  return Math.min(4, lengthScore + classScore + uniqueScore)
}

export function strengthLabel(strength: number): string {
  return ['Muito fraca', 'Fraca', 'Razoavel', 'Boa', 'Forte'][strength] ?? 'Desconhecida'
}
