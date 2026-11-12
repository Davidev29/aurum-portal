import { onlyDigits } from '../../../shared/validation'
import type {
  Client,
  ClientBrasilApiRefreshItem,
  ClientBrasilApiRefreshProgress,
  ClientBrasilApiRefreshReport,
  CnpjLookupResult,
} from '../../../shared/types'
import type { Certificate } from '../../../shared/types'
import type { AppDatabase } from '../db/database'
import { listClients, updateClient } from '../db/repositories/clients'
import { listCertificatesForClient } from '../db/repositories/certificates'

export type CompanyLookupFn = (
  cnpj: string,
  options: { enabled: boolean },
) => Promise<CnpjLookupResult | null>

export interface BrasilApiEnrichmentOptions {
  lookup: CompanyLookupFn
  /** Callback opcional para auditoria (recebe tipo, entidade, entidadeId, metadados). */
  onAudit?: (
    type: string,
    entity: string,
    entityId: string | null,
    metadata?: Record<string, unknown>,
  ) => void
  /** Progresso ao vivo: total/completed/remaining + contadores. Chamado 0..N vezes. */
  onProgress?: (progress: ClientBrasilApiRefreshProgress) => void
}

/**
 * Nomes gerados automaticamente quando o cadastro veio de um certificado sem
 * consulta à Brasil API (ou de um cadastro em lote sem nome). Quando o
 * operador atualiza pela Brasil API, esses nomes devem ser substituídos pela
 * razão social oficial gována apenas pelo CNPJ.
 */
export function isPlaceholderClientName(name: string | null | undefined, document: string): boolean {
  const digits = onlyDigits(document ?? '')
  const value = (name ?? '').trim()
  if (!value) return true
  if (value === `Cliente ${digits}`) return true
  if (value === 'Cliente importado do certificado') return true
  if (value === 'Titular') return true
  if (value === 'Titular sem nome') return true
  if (/^Cliente\s+\d{11,14}$/.test(value)) return true
  return false
}

/**
 * Dados de cadastro completo para um cliente PJ a partir da resposta da
 * Brasil API. Chame apenas com o CNPJ (apenas o documento sai da estação).
 * Retorna null quando a API não trouxe nenhum dado aproveitável.
 */
export function companyEnrichmentData(
  company: CnpjLookupResult | null,
): { name: string | null; email: string | null; phone: string | null } | null {
  if (!company) return null
  const name = company.name?.trim() || null
  const email = company.email?.trim() || null
  const phone = company.phone?.trim() || null
  if (!name && !email && !phone) return null
  return { name, email, phone }
}

/**
 * Atualiza **apenas o cadastro** (nome, e-mail, telefone) de um cliente a
 * partir dos dados da Brasil API. Documentos, tags, notas, status, consentimento
 * e vínculos (certificados/credenciais) nunca são tocados aqui.
 *
 * - Nome: substituído pela razão social quando a API a retorna (é o nome
 *   oficial do CNPJ). Quando a API não retorna nome, o atual é mantido.
 * - E-mail/telefone: preenchidos quando a API retorna valor; mantidos quando
 *   a API não retorna.
 *
 * Retorna o cliente atualizado e se houve mudança efetiva.
 */
export function applyCompanyDataToClient(
  db: AppDatabase,
  client: Client,
  company: CnpjLookupResult | null,
): { client: Client; changed: boolean } {
  const data = companyEnrichmentData(company)
  if (!data) return { client, changed: false }

  const nextName = data.name ?? client.name
  const nextEmail = data.email ?? client.email
  const nextPhone = data.phone ?? client.phone

  const changed =
    nextName !== client.name || nextEmail !== client.email || nextPhone !== client.phone
  if (!changed) return { client, changed: false }

  const updated = updateClient(db, client.id, {
    name: nextName,
    email: nextEmail,
    phone: nextPhone,
  })
  return { client: updated, changed: true }
}

/**
 * Escolhe o melhor nome do titular a partir dos certificados vinculados ao cliente.
 * Prioriza o certificado com validade mais distante no futuro (o mais recente /
 * ainda em vigor) que tenha holderName preenchido.
 */
export function pickBestClientNameFromCertificates(certs: Certificate[]): string | null {
  const withName = certs.filter((c) => c.holderName?.trim())
  if (withName.length === 0) return null
  withName.sort((a, b) => new Date(b.validTo).getTime() - new Date(a.validTo).getTime())
  return withName[0].holderName!.trim()
}

/**
 * Atualiza apenas o nome de um cliente pessoa física a partir do nome do titular
 * do certificado digital vinculado. E-mail e telefone não são preenchidos porque
 * o certificado não os expõe.
 */
export function applyPersonDataToClient(
  db: AppDatabase,
  client: Client,
  name: string | null,
): { client: Client; changed: boolean } {
  if (!name) return { client, changed: false }
  const nextName = name.trim()
  if (!nextName || nextName === client.name) return { client, changed: false }
  const updated = updateClient(db, client.id, { name: nextName })
  return { client: updated, changed: true }
}

/**
 * Enriquece (ou cria com dados completos) o cadastro a partir do CNPJ.
 * Usado pela importação de certificados: apenas o CNPJ é enviado à Brasil API.
 */
export async function fetchCompanyByCnpj(
  document: string,
  lookup: CompanyLookupFn,
): Promise<CnpjLookupResult | null> {
  const digits = onlyDigits(document ?? '')
  if (digits.length !== 14) return null
  try {
    return (await lookup(digits, { enabled: true })) ?? null
  } catch {
    return null
  }
}

function maskDocumentDigits(document: string): string {
  const digits = onlyDigits(document ?? '')
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`
  if (digits.length === 14) return `**.***.***/${digits.slice(0, 4)}-*`
  return '***'
}

/**
 * Atualiza **todos** os clientes PJ a partir da Brasil API (botão da lista de
 * clientes). Cada CNPJ é consultado individualmente e o resultado atualiza
 * apenas o cadastro (nome/e-mail/telefone). PF e cadastros sem resposta são
 * contados como ignorados; falhas de rede como erros — sem interromper o
 * restante da lista.
 */
export async function refreshAllClientsFromBrasilApi(
  db: AppDatabase,
  options: BrasilApiEnrichmentOptions,
): Promise<ClientBrasilApiRefreshReport> {
  const clients = listClients(db, { status: 'all' })
  const total = clients.length
  const items: ClientBrasilApiRefreshItem[] = []
  let updated = 0
  let skipped = 0
  let errors = 0

  const emitProgress = (
    completed: number,
    currentClientId: string | null,
    currentDocument: string | null,
    currentName: string | null,
    stage: ClientBrasilApiRefreshProgress['stage'],
  ): void => {
    options.onProgress?.({
      total,
      completed,
      remaining: Math.max(0, total - completed),
      updated,
      skipped,
      errors,
      currentClientId,
      currentDocument,
      currentName,
      stage,
    })
  }

  emitProgress(0, null, null, null, 'starting')

  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index] as Client
    const digits = onlyDigits(client.document ?? '')
    if (digits.length === 14) {
      // CNPJ: consulta a Brasil API (Receita Federal)
      let company: CnpjLookupResult | null = null
      try {
        company = await fetchCompanyByCnpj(digits, options.lookup)
      } catch {
        company = null
      }
      options.onAudit?.('external.cnpj_lookup', 'client', client.id, {
        provider: 'brasilapi.com.br',
        document: maskDocumentDigits(digits),
        source: 'bulk_refresh',
        status: company ? 'ok' : 'unavailable',
      })

      if (!company) {
        errors += 1
        items.push({
          clientId: client.id,
          document: client.document,
          status: 'error',
          message: 'CNPJ não encontrado ou Brasil API indisponível.',
        })
        emitProgress(index + 1, client.id, client.document, client.name, 'updating')
        continue
      }

      try {
        const { client: next, changed } = applyCompanyDataToClient(db, client, company)
        if (!changed) {
          skipped += 1
          items.push({
            clientId: client.id,
            document: client.document,
            status: 'skipped',
            message: 'Dados já conferem com a Brasil API.',
          })
        } else {
          updated += 1
          items.push({
            clientId: client.id,
            document: client.document,
            status: 'updated',
            message: next.name,
          })
        }
      } catch (error) {
        errors += 1
        items.push({
          clientId: client.id,
          document: client.document,
          status: 'error',
          message: error instanceof Error ? error.message : 'Falha ao atualizar o cadastro.',
        })
      }
      emitProgress(index + 1, client.id, client.document, client.name, 'updating')
      // Sequencial por design: evita rajada contra a API gratuita.
      await new Promise<void>((resolve) => setImmediate(resolve))
      continue
    }

    if (digits.length === 11) {
      // CPF: atualiza o nome a partir do titular do certificado digital vinculado.
      // E-mail/telefone não são preenchidos porque o certificado não os expõe.
      try {
        const certs = listCertificatesForClient(db, client.id)
        const name = pickBestClientNameFromCertificates(certs)
        const { client: next, changed } = applyPersonDataToClient(db, client, name)
        if (!changed) {
          skipped += 1
          items.push({
            clientId: client.id,
            document: client.document,
            status: 'skipped',
            message:
              certs.length === 0
                ? 'Sem certificado vinculado para preencher o nome.'
                : 'Nome já confere com o certificado vinculado.',
          })
        } else {
          updated += 1
          items.push({
            clientId: client.id,
            document: client.document,
            status: 'updated',
            message: next.name,
          })
        }
      } catch (error) {
        errors += 1
        items.push({
          clientId: client.id,
          document: client.document,
          status: 'error',
          message: error instanceof Error ? error.message : 'Falha ao atualizar o cadastro do CPF.',
        })
      }
      emitProgress(index + 1, client.id, client.document, client.name, 'updating')
      continue
    }

    // Documento com tamanho inválido (não é CPF nem CNPJ)
    skipped += 1
    items.push({
      clientId: client.id,
      document: client.document,
      status: 'skipped',
      message: 'Documento com tamanho inválido.',
    })
    emitProgress(index + 1, client.id, client.document, client.name, 'updating')
  }

  emitProgress(total, null, null, null, 'done')

  return { total: clients.length, updated, skipped, errors, items }
}
