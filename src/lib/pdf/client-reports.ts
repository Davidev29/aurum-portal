'use client'

import type { AppSettings, Certificate, Client, ClientNote, Credential } from '@shared/types'
import { formatCentsToBRL } from '@shared/currency'
import { formatDocument } from '@shared/validation'
import { clientTypeLabel, formatDate, formatDateTime } from '@/lib/utils'
import { generateReportPdf, type GenerateReportResult, type ReportSection } from './report-document'

/**
 * Relatórios do módulo de clientes — sempre no Modelo Timbrado do sistema
 * (office + letterhead das Configurações).
 *
 * Dois relatórios:
 * - Lista de clientes: somente nomes ou nomes + honorários.
 * - Relatório do cliente: seções escolhidas pelo operador (dados, honorários,
 *   observações, credenciais e certificados). Senhas NUNCA são impressas.
 */

export type ReportSettings = Pick<AppSettings, 'office' | 'letterhead'>

export interface ClientsListReportOptions {
  clients: Client[]
  includeHonorarios: boolean
  /** Ex.: "Status: Ativos" ou "Status: Todos • Busca: "padaria"". */
  filterDescription: string
  settings: ReportSettings
}

export function generateClientsListReport({
  clients,
  includeHonorarios,
  filterDescription,
  settings,
}: ClientsListReportOptions): Promise<GenerateReportResult> {
  const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const generatedAt = new Date()

  const sections: ReportSection[] = [
    {
      heading: 'Clientes cadastrados',
      table: includeHonorarios
        ? {
            columns: ['#', 'Cliente', 'Honorários'],
            widths: [0.45, 3.4, 1.3],
            rows: sorted.map((client, index) => [
              String(index + 1).padStart(2, '0'),
              client.name,
              client.honorariosCents === null
                ? 'Não informado'
                : formatCentsToBRL(client.honorariosCents),
            ]),
          }
        : {
            columns: ['#', 'Cliente'],
            widths: [0.45, 4.8],
            rows: sorted.map((client, index) => [String(index + 1).padStart(2, '0'), client.name]),
          },
    },
  ]

  if (includeHonorarios) {
    const informed = sorted.filter((client) => client.honorariosCents !== null)
    const total = informed.reduce((sum, client) => sum + (client.honorariosCents ?? 0), 0)
    sections.push({
      heading: 'Resumo de honorários',
      paragraphs: [
        `Honorários informados em ${informed.length} de ${sorted.length} cliente(s).`,
        `Soma dos honorários informados: ${formatCentsToBRL(total)}.`,
      ],
    })
  }

  return generateReportPdf({
    title: 'Relatorio de Clientes',
    subtitle: includeHonorarios
      ? 'Lista de clientes com honorarios'
      : 'Lista de clientes (somente nomes)',
    meta: [
      `Gerado em ${formatDateTime(generatedAt.toISOString())}`,
      `Filtro: ${filterDescription}`,
      `${sorted.length} cliente(s) listado(s).`,
    ],
    office: settings.office,
    letterhead: settings.letterhead,
    generatedAt,
    sections,
  })
}

export interface ClientReportSections {
  basics: boolean
  honorarios: boolean
  notes: boolean
  credentials: boolean
  certificates: boolean
}

export interface ClientReportOptions {
  client: Client
  sections: ClientReportSections
  notes: ClientNote[]
  credentials: Credential[]
  certificates: Certificate[]
  settings: ReportSettings
}

const CERTIFICATE_STATUS_LABELS: Record<string, string> = {
  valid: 'Válido',
  expiring: 'A vencer',
  expired: 'Vencido',
  in_vault: 'Somente no cofre',
  missing_windows: 'Ausente no Windows',
  chain_incomplete: 'Cadeia incompleta',
}

export function generateClientReport({
  client,
  sections,
  notes,
  credentials,
  certificates,
  settings,
}: ClientReportOptions): Promise<GenerateReportResult> {
  const generatedAt = new Date()
  const built: ReportSection[] = []

  if (sections.basics) {
    built.push({
      heading: 'Dados do cliente',
      table: {
        columns: ['Campo', 'Valor'],
        widths: [1.25, 4.1],
        rows: [
          ['Tipo', clientTypeLabel(client.type)],
          ['Documento', formatDocument(client.document)],
          ['E-mail', client.email ?? '—'],
          ['Telefone', client.phone ?? '—'],
          ['Tags', client.tags.length > 0 ? client.tags.join(', ') : '—'],
          [
            'Consentimento (LGPD)',
            client.consentAt ? formatDateTime(client.consentAt) : 'Não registrado',
          ],
          ['Status', client.status === 'active' ? 'Ativo' : 'Arquivado'],
          ['Criado em', formatDateTime(client.createdAt)],
          ['Atualizado em', formatDateTime(client.updatedAt)],
        ],
      },
    })
  }

  if (sections.honorarios) {
    built.push({
      heading: 'Honorários',
      paragraphs: [
        client.honorariosCents === null
          ? 'Honorários não informados para este cliente.'
          : `Honorários: ${formatCentsToBRL(client.honorariosCents)}.`,
      ],
    })
  }

  if (sections.notes) {
    built.push(
      notes.length > 0
        ? {
            heading: `Observações (${notes.length})`,
            table: {
              columns: ['Data', 'Observação'],
              widths: [1.15, 4.2],
              rows: notes.map((note) => [formatDateTime(note.createdAt), note.text]),
            },
          }
        : {
            heading: 'Observações',
            paragraphs: ['Nenhuma observação registrada para este cliente.'],
          },
    )
  }

  if (sections.credentials) {
    built.push({
      heading: `Credenciais (${credentials.length})`,
      paragraphs: [
        'As senhas nunca são incluídas neste relatório.',
        ...(credentials.length === 0 ? ['Nenhuma credencial no cofre para este cliente.'] : []),
      ],
      table:
        credentials.length > 0
          ? {
              columns: ['Rótulo', 'Serviço', 'Usuário', 'Último uso'],
              widths: [1.5, 1.4, 1.45, 1.15],
              rows: credentials.map((credential) => [
                credential.label,
                credential.serviceName,
                credential.username,
                credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : 'Nunca',
              ]),
            }
          : undefined,
    })
  }

  if (sections.certificates) {
    built.push({
      heading: `Certificados vinculados (${certificates.length})`,
      table:
        certificates.length > 0
          ? {
              columns: ['Certificado', 'Titular', 'Validade', 'Situação'],
              widths: [1.5, 1.9, 1.05, 1.05],
              rows: certificates.map((certificate) => [
                certificate.label,
                certificate.holderName,
                formatDate(certificate.validTo),
                CERTIFICATE_STATUS_LABELS[certificate.status] ?? certificate.status,
              ]),
            }
          : undefined,
      paragraphs:
        certificates.length > 0 ? undefined : ['Nenhum certificado vinculado a este cliente.'],
    })
  }

  return generateReportPdf({
    title: 'Relatorio do Cliente',
    subtitle: client.name,
    meta: [
      `Gerado em ${formatDateTime(generatedAt.toISOString())}`,
      `Documento: ${formatDocument(client.document)} • ${clientTypeLabel(client.type)}`,
      `Status: ${client.status === 'active' ? 'Ativo' : 'Arquivado'}`,
    ],
    office: settings.office,
    letterhead: settings.letterhead,
    generatedAt,
    sections: built,
  })
}
