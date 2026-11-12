import { describe, expect, it } from 'vitest'
import {
  createClient,
  getClient,
  listClients,
  updateClient,
} from '../../electron/main/db/repositories/clients'
import { createDatabase } from '../../electron/main/db/database'
import { clientInputSchema, clientUpdateSchema } from '../../shared/contracts'
import {
  centsToDigits,
  digitsToCents,
  digitsToCurrencyText,
  formatCentsToBRL,
  formatCentsToPlain,
} from '../../shared/currency'

const VALID_CPF = '52998224725'

describe('cliente — honorários em centavos', () => {
  it('cria cliente com honorários e lê de volta (memória, migração aplicada)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Maria Honorários',
        document: VALID_CPF,
        honorariosCents: 150_050, // R$ 1.500,50
      })
      expect(client.honorariosCents).toBe(150_050)

      const fetched = getClient(db, client.id)
      expect(fetched?.honorariosCents).toBe(150_050)

      const listed = listClients(db, { status: 'all' }).find((item) => item.id === client.id)
      expect(listed?.honorariosCents).toBe(150_050)
    } finally {
      close()
    }
  })

  it('cliente sem honorários fica com null', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Sem Honorários',
        document: VALID_CPF,
      })
      expect(client.honorariosCents).toBeNull()
    } finally {
      close()
    }
  })

  it('atualiza, mantém (undefined) e limpa (null) os honorários', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Cliente Editável',
        document: VALID_CPF,
        honorariosCents: 50_000,
      })

      // undefined mantém o valor atual
      const kept = updateClient(db, client.id, { name: 'Cliente Editável II' })
      expect(kept.honorariosCents).toBe(50_000)

      // novo valor substitui
      const updated = updateClient(db, client.id, { honorariosCents: 275_000 })
      expect(updated.honorariosCents).toBe(275_000)

      // null limpa
      const cleared = updateClient(db, client.id, { honorariosCents: null })
      expect(cleared.honorariosCents).toBeNull()
    } finally {
      close()
    }
  })

  it('schema aceita inteiro >= 0 e rejeita negativo, decimal e acima do teto', () => {
    expect(clientInputSchema.safeParse({ document: VALID_CPF, honorariosCents: 0 }).success).toBe(
      true,
    )
    expect(
      clientInputSchema.safeParse({ document: VALID_CPF, honorariosCents: 150_050 }).success,
    ).toBe(true)
    expect(clientInputSchema.safeParse({ document: VALID_CPF, honorariosCents: -1 }).success).toBe(
      false,
    )
    expect(
      clientInputSchema.safeParse({ document: VALID_CPF, honorariosCents: 10.5 }).success,
    ).toBe(false)
    expect(
      clientInputSchema.safeParse({ document: VALID_CPF, honorariosCents: 99_999_999_999 + 1 })
        .success,
    ).toBe(false)

    const update = clientUpdateSchema.parse({ honorariosCents: null })
    expect(update.honorariosCents).toBeNull()
  })
})

describe('moeda — helpers de honorários', () => {
  it('formata centavos em BRL e trata null', () => {
    expect(formatCentsToBRL(null)).toBe('—')
    expect(formatCentsToBRL(undefined)).toBe('—')
    expect(formatCentsToBRL(0)).toMatch(/0,00/)
    expect(formatCentsToBRL(150_050)).toMatch(/R\$/)
    expect(formatCentsToBRL(150_050)).toMatch(/1\.500,50/)
    expect(formatCentsToPlain(150_050)).toBe('1.500,50')
    expect(formatCentsToPlain(null)).toBe('')
  })

  it('converte dígitos do input mascarado em centavos e de volta', () => {
    expect(digitsToCents('')).toBeNull()
    expect(digitsToCents('150050')).toBe(150_050)
    expect(digitsToCents('R$ 1.500,50')).toBe(150_050)
    expect(digitsToCents('9'.repeat(20))).toBe(99_999_999_999) // truncado no teto

    expect(centsToDigits(null)).toBe('')
    expect(centsToDigits(150_050)).toBe('150050')
    expect(digitsToCurrencyText('')).toBe('')
    expect(digitsToCurrencyText('150050')).toMatch(/1\.500,50/)
  })
})
