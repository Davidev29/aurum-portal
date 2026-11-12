export type DocumentType = 'CPF' | 'CNPJ'

export function onlyDigits(value: string): string {
  return (value ?? '').replace(/\D+/g, '')
}

export function normalizeDocument(value: string): string {
  return onlyDigits(value)
}

export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  let sum = 0
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i)
  let check = (sum * 10) % 11
  if (check === 10) check = 0
  if (check !== Number(cpf[9])) return false

  sum = 0
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i)
  check = (sum * 10) % 11
  if (check === 10) check = 0
  return check === Number(cpf[10])
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value)
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const calc = (slice: number, weights: number[]): number => {
    let sum = 0
    for (let i = 0; i < slice; i += 1) sum += Number(cnpj[i]) * (weights[i] ?? 0)
    const mod = sum % 11
    return mod < 2 ? 0 : 11 - mod
  }

  const first = calc(12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  if (first !== Number(cnpj[12])) return false
  const second = calc(13, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return second === Number(cnpj[13])
}

export function isValidDocument(value: string): boolean {
  const digits = onlyDigits(value)
  if (digits.length === 11) return isValidCPF(digits)
  if (digits.length === 14) return isValidCNPJ(digits)
  return false
}

export function getDocumentType(value: string): DocumentType | null {
  const digits = onlyDigits(value)
  if (digits.length === 11 && isValidCPF(digits)) return 'CPF'
  if (digits.length === 14 && isValidCNPJ(digits)) return 'CNPJ'
  return null
}

export function formatDocument(value: string): string {
  const digits = onlyDigits(value)
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  }
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return value
}

/**
 * Mascara progressiva durante a digitacao: formata CPF (ate 11 digitos) ou
 * CNPJ (12 a 14). Incompletos continuam visiveis parcialmente mascarados.
 */
export function formatDocumentPartial(value: string): string {
  const digits = onlyDigits(value).slice(0, 14)
  if (digits.length <= 11) {
    return digits
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4')
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d)/, '$1.$2.$3/$4-$5')
}

export function maskDocument(value: string): string {
  const digits = onlyDigits(value)
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`
  return '***'
}

export function findDocumentInText(value: string): { document: string; type: DocumentType } | null {
  const matches = (value ?? '').match(/\d[\d.\-/\s]{9,20}\d/g) ?? []
  for (const match of matches) {
    const digits = onlyDigits(match)
    if (digits.length === 11 && isValidCPF(digits)) return { document: digits, type: 'CPF' }
    if (digits.length === 14 && isValidCNPJ(digits)) return { document: digits, type: 'CNPJ' }
  }
  return null
}
