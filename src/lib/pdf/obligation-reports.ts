'use client'

import type { ObligationMonthItem } from '@shared/types'
import { formatDocument } from '@shared/validation'
import { formatDateBr } from '@shared/holidays'
import { formatDateTime } from '@/lib/utils'
import { generateReportPdf, type GenerateReportResult, type ReportSection } from './report-document'
import type { ReportSettings } from './client-reports'

/**
 * Relatório de obrigações do mês (Modelo Timbrado do sistema).
 *
 * Checklist impresso pensado para conferência manual:
 * - clientes em ordem alfabética (pt-BR), numerados;
 * - CNPJ do cliente sob o nome;
 * - obrigações do cliente em ordem alfabética (sigla, depois nome);
 * - caixa de seleção desenhada por item — marcada quando a baixa já foi
 *   registrada no sistema, vazia caso contrário (para ticar na mão).
 */

export interface ObligationsReportGroup {
  clientId: string
  clientName: string
  clientDocument: string
  items: ObligationMonthItem[]
}

export function compareTextPtBr(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base', numeric: true })
}

/** Agrupa os itens do mês por cliente e ordena tudo alfabeticamente (pt-BR). */
export function groupObligationItemsByClient(
  items: ObligationMonthItem[],
): ObligationsReportGroup[] {
  const byClient = new Map<string, ObligationsReportGroup>()
  for (const item of items) {
    const group = byClient.get(item.clientId) ?? {
      clientId: item.clientId,
      clientName: item.clientName,
      clientDocument: item.clientDocument,
      items: [],
    }
    group.items.push(item)
    byClient.set(item.clientId, group)
  }
  const groups = [...byClient.values()]
  for (const group of groups) {
    group.items.sort(
      (a, b) =>
        compareTextPtBr(a.sigla, b.sigla) || compareTextPtBr(a.obligationName, b.obligationName),
    )
  }
  return groups.sort(
    (a, b) =>
      compareTextPtBr(a.clientName, b.clientName) ||
      compareTextPtBr(a.clientDocument, b.clientDocument),
  )
}

/** Situacao da ocorrencia no mes, para a coluna final da tabela. */
export function obligationMonthStatus(
  item: ObligationMonthItem,
  today: string,
): 'Baixada' | 'Atrasada' | 'Pendente' {
  if (item.delivered) return 'Baixada'
  if (item.dueDate && item.dueDate < today) return 'Atrasada'
  return 'Pendente'
}

export interface ObligationsMonthReportOptions {
  /** Itens do mês já filtrados na tela (busca aplicada). */
  items: ObligationMonthItem[]
  /** Ex.: "Novembro de 2026". */
  monthTitle: string
  /** Filtro aplicado na tela, ex.: `Busca: "padaria"`. */
  filterDescription: string
  /** Hoje em AAAA-MM-DD (rotula atrasadas). */
  today: string
  settings: ReportSettings
}

export function generateObligationsMonthReport({
  items,
  monthTitle,
  filterDescription,
  today,
  settings,
}: ObligationsMonthReportOptions): Promise<GenerateReportResult> {
  const generatedAt = new Date()
  const groups = groupObligationItemsByClient(items)
  const totalObligations = groups.reduce((sum, group) => sum + group.items.length, 0)
  const totalDelivered = groups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.delivered).length,
    0,
  )
  const totalOverdue = groups.reduce(
    (sum, group) =>
      sum +
      group.items.filter((item) => !item.delivered && item.dueDate && item.dueDate < today).length,
    0,
  )
  const percentDelivered =
    totalObligations === 0 ? 0 : Math.round((totalDelivered / totalObligations) * 100)

  const sections: ReportSection[] = groups.map((group, index) => {
    const delivered = group.items.filter((item) => item.delivered).length
    return {
      heading: `${index + 1}. ${group.clientName}`,
      paragraphs: [
        `CNPJ ${formatDocument(group.clientDocument)} - ${delivered}/${group.items.length} baixada(s) na competência.`,
      ],
      table: {
        columns: ['Baixa', 'Obrigação', 'Vencimento', 'Situação'],
        widths: [0.55, 3.35, 1, 0.95],
        checkboxColumn: 0,
        rows: group.items.map((item) => [
          item.delivered ? 'x' : '',
          `${item.sigla} - ${item.obligationName}`,
          item.dueDate ? formatDateBr(item.dueDate) : 'Eventual',
          obligationMonthStatus(item, today),
        ]),
      },
    }
  })

  sections.push({
    heading: 'Resumo',
    paragraphs: [
      `${groups.length} cliente(s) - ${totalObligations} obrigação(ões) na competência de ${monthTitle}.`,
      `${totalDelivered} baixada(s) (${percentDelivered}%) - ${totalObligations - totalDelivered} pendente(s)${
        totalOverdue > 0 ? `, das quais ${totalOverdue} atrasada(s)` : ''
      }.`,
    ],
  })

  sections.push({
    heading: 'Legenda',
    paragraphs: [
      'Caixa marcada = baixa já registrada no sistema para a competência; caixa vazia = pendente, marque no papel durante a conferência.',
      'Clientes em ordem alfabética; obrigações de cada cliente também em ordem alfabética (por sigla, depois pelo nome).',
      'A baixa vale apenas para a competência do vencimento impresso nesta página.',
    ],
  })

  return generateReportPdf({
    title: 'Relatorio de Obrigacoes',
    subtitle: `Competência ${monthTitle}`,
    meta: [
      `Gerado em ${formatDateTime(generatedAt.toISOString())}`,
      `Filtro: ${filterDescription}`,
      `${groups.length} cliente(s) - ${totalObligations} obrigação(ões) listadas.`,
    ],
    office: settings.office,
    letterhead: settings.letterhead,
    generatedAt,
    sections,
  })
}
