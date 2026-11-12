import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ClientType } from '@shared/types'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function clientTypeLabel(type: ClientType): string {
  return type === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  // Certificados guardam validade como instante ISO/UTC; exibir em UTC evita que
  // o fuso local (ex.: UTC-3) desloque a data de vencimento para o dia anterior.
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function formatDocumentMasked(value: string | null | undefined): string {
  if (!value) return '—'
  const digits = value.replace(/\D+/g, '')
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`
  return value
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export function timeAgo(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min atras`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h atras`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} d atras`
  return formatDate(value)
}

export function passwordStrength(password: string): number {
  if (!password) return 0
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (password.length >= 18) score += 1
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1
  if (/\d/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return Math.min(5, score)
}

export function isExpiring(validTo: string, days = 30): boolean {
  const time = new Date(validTo).getTime()
  if (Number.isNaN(time)) return false
  return time > Date.now() && time - Date.now() <= days * 86_400_000
}
