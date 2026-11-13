import { describe, expect, it } from 'vitest'
import {
  compareTextPtBr,
  generateObligationsMonthReport,
  groupObligationItemsByClient,
  obligationMonthStatus,
} from '@/lib/pdf/obligation-reports'
import { DEFAULT_LETTERHEAD, isValidTrackingCode } from '@shared/letterhead'
import { DEFAULT_OFFICE_PROFILE } from '@shared/settings'
import type { ObligationMonthItem } from '@shared/types'

let counter = 0
function makeItem(partial: Partial<ObligationMonthItem> = {}): ObligationMonthItem {
  counter += 1
  return {
    linkId: `link-${counter}`,
    clientId: 'client-a',
    clientName: 'Empresa Alfa',
    clientDocument: '52998224725',
    obligationId: `obligation-${counter}`,
    sigla: 'DCTF',
    obligationName: 'Declaração de Débitos e Créditos Tributários Federais',
    departmentName: 'Fiscal',
    recurrence: 'mensal',
    dueDate: '2026-11-15',
    dataInicio: '2020-01-01',
    delivered: false,
    deliveredAt: null,
    ...partial,
  }
}

const SETTINGS = {
  office: {
    ...DEFAULT_OFFICE_PROFILE,
    legalName: 'Escritório de Teste Contabilidade Ltda',
    cnpj: '00574753000110',
  },
  letterhead: { ...DEFAULT_LETTERHEAD },
}

describe('ordenação alfabética do relatório de obrigações', () => {
  it('ordena clientes por nome (pt-BR) e obrigações por sigla', () => {
    const items = [
      makeItem({ clientId: 'b', clientName: 'Zulu', sigla: 'SPED' }),
      makeItem({ clientId: 'a', clientName: 'Álamo', sigla: 'ZZZ' }),
      makeItem({ clientId: 'a', clientName: 'Álamo', sigla: 'AFIP' }),
      makeItem({ clientId: 'c', clientName: 'América', sigla: 'GIA' }),
      makeItem({ clientId: 'b', clientName: 'Zulu', sigla: 'AFIP' }),
    ]
    const groups = groupObligationItemsByClient(items)
    expect(groups.map((group) => group.clientName)).toEqual(['Álamo', 'América', 'Zulu'])
    expect(groups[0]?.items.map((item) => item.sigla)).toEqual(['AFIP', 'ZZZ'])
    expect(groups[2]?.items.map((item) => item.sigla)).toEqual(['AFIP', 'SPED'])
  })

  it('compareTextPtBr é insensível a acento e caixa', () => {
    expect(compareTextPtBr('álamo', 'Alamo')).toBe(0)
    expect(compareTextPtBr('abc', 'abd')).toBeLessThan(0)
  })
})

describe('obligationMonthStatus', () => {
  it('classifica baixada, atrasada e pendente', () => {
    expect(obligationMonthStatus(makeItem({ delivered: true }), '2026-11-13')).toBe('Baixada')
    expect(obligationMonthStatus(makeItem({ dueDate: '2026-11-01' }), '2026-11-13')).toBe(
      'Atrasada',
    )
    expect(obligationMonthStatus(makeItem({ dueDate: '2026-11-30' }), '2026-11-13')).toBe(
      'Pendente',
    )
    expect(obligationMonthStatus(makeItem({ dueDate: null }), '2026-11-13')).toBe('Pendente')
  })
})

describe('generateObligationsMonthReport', () => {
  it('gera um PDF válido com código de rastreio íntegro', async () => {
    const items = [
      makeItem({ delivered: true, clientId: 'b', clientName: 'Beta', sigla: 'DCTF' }),
      makeItem({ clientId: 'a', clientName: 'Alfa', sigla: 'ESOCIAL' }),
      makeItem({ clientId: 'a', clientName: 'Alfa', sigla: 'DCTF' }),
      makeItem({
        clientId: 'c',
        clientName: 'Calor',
        sigla: 'SPED',
        dueDate: null,
        recurrence: 'eventual',
      }),
    ]
    const result = await generateObligationsMonthReport({
      items,
      monthTitle: 'Novembro de 2026',
      filterDescription: 'Todos os clientes com obrigações no mês',
      today: '2026-11-13',
      settings: SETTINGS,
    })
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
    expect(result.bytes.length).toBeGreaterThan(500)
    expect(Buffer.from(result.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
    expect(isValidTrackingCode(result.trackingCode)).toBe(true)
  })

  it('gera PDF válido também com lista vazia (não quebra o rodapé)', async () => {
    const result = await generateObligationsMonthReport({
      items: [],
      monthTitle: 'Novembro de 2026',
      filterDescription: 'Busca: "sem resultado"',
      today: '2026-11-13',
      settings: SETTINGS,
    })
    expect(result.pageCount).toBeGreaterThanOrEqual(1)
    expect(Buffer.from(result.bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-')
  })
})
