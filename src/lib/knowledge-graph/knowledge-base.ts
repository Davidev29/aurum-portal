/**
 * Base de Conhecimento — camada de interceptação do Grafo de Conhecimento.
 *
 * Toda solicitação da aplicação passa por aqui antes de ser processada,
 * permitindo que o grafo resolva entidades, enriqueça o contexto e
 * acelere consultas repetidas via cache.
 *
 * Fluxo de processamento:
 *  1. Recebe KnowledgeRequest
 *  2. Verifica cache (por hash da solicitação)
 *  3. Extrai entidades do texto da solicitação
 *  4. Busca essas entidades e seus vizinhos no grafo
 *  5. Enriquece o payload com dados do grafo (certificados, portais, sessões, permissões…)
 *  6. Gera ações sugeridas com base nas relações encontradas
 *  7. Retorna KnowledgeResponse (ou encaminha para o próximo processador)
 */

import { KnowledgeGraph, type Id, type Node, type Edge, type GraphStats } from './index'
import { seedKnowledgeGraph } from './seed'
import type {
  KnowledgeRequest,
  KnowledgeResponse,
  KnowledgeContext,
  KnowledgeBaseOptions,
  ExtractedEntity,
} from './knowledge-base.types'
import { KnowledgeCache } from './knowledge-base.cache'
import { extractEntities, resolveEntityIds } from './knowledge-base.extractor'
import { retrieveSubgraph } from './llm/retriever'

const DEFAULT_OPTIONS: Required<KnowledgeBaseOptions> = {
  cacheTtlMs: 5 * 60 * 1000,
  maxCacheEntries: 200,
  maxHops: 2,
  maxContextNodes: 30,
  debug: false,
}

/**
 * Cria uma instância da Base de Conhecimento sobre um grafo existente.
 *
 * Exemplo:
 * ```ts
 * const kb = KnowledgeBase.create(seedKnowledgeGraph(new KnowledgeGraph()))
 * const resposta = await kb.process({
 *   type: 'consulta_certificado',
 *   query: 'Qual certificado Maria usa no e-CNPJ?',
 *   payload: { usuarioId: '...' },
 * })
 * ```
 */
export class KnowledgeBase {
  private kg: KnowledgeGraph
  private cache: KnowledgeCache
  private options: Required<KnowledgeBaseOptions>

  private constructor(kg: KnowledgeGraph, options: Required<KnowledgeBaseOptions>) {
    this.kg = kg
    this.options = options
    this.cache = new KnowledgeCache({
      ttlMs: options.cacheTtlMs,
      maxEntries: options.maxCacheEntries,
    })
  }

  /**
   * Cria uma Base de Conhecimento sobre um grafo, opcionalmente populada
   * com os dados de semente do domínio AurumBit Portal.
   */
  static create(kg?: KnowledgeGraph, options?: KnowledgeBaseOptions): KnowledgeBase {
    const graph = kg ?? seedKnowledgeGraph(new KnowledgeGraph())

    return new KnowledgeBase(graph, { ...DEFAULT_OPTIONS, ...options })
  }

  /* ------------------------------------------------------------------ */
  /* Processamento principal                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Processa uma solicitação através do Grafo de Conhecimento.
   *
   * @param request - Solicitação de entrada.
   * @returns Resposta enriquecida com contexto do grafo.
   */
  process<Payload extends Record<string, unknown> = Record<string, unknown>>(
    request: KnowledgeRequest<Payload>,
  ): KnowledgeResponse<Payload> {
    const startTime = Date.now()

    // 1. Verifica cache.
    const cached = this.cache.get(request)
    if (cached) {
      if (this.options.debug) {
        console.log(`[KnowledgeBase] cache hit para requisição ${request.id}`)
      }
      return {
        ...cached,
        requestId: request.id,
        cacheHit: true,
        processingTimeMs: Date.now() - startTime,
      } as KnowledgeResponse<Payload>
    }

    // 2. Extrai entidades do texto da solicitação.
    const query = request.query ?? ''
    const entities = extractEntities(this.kg, query, 10)

    // 3. Resolve IDs dos nós correspondentes.
    const entityIds = resolveEntityIds(this.kg, entities)

    // 4. Recupera subgrafo relevante (entidades + vizinhos).
    const subgraph = retrieveSubgraph(this.kg, query, {
      maxHops: this.options.maxHops,
      maxNodes: this.options.maxContextNodes,
    })

    // 5. Monta contexto enriquecido.
    const context = this.buildContext(subgraph, entityIds)

    // 6. Enriquece o payload com dados do grafo.
    const enrichedPayload = this.enrichPayload(request.payload, context, entities, entityIds)

    // 7. Gera ações sugeridas.
    const suggestedActions = this.suggestActions(context, entities, request.type)

    // 8. Estatísticas do grafo.
    const stats = this.kg.getStats()

    const response: KnowledgeResponse<Payload> = {
      requestId: request.id,
      resolved: entityIds.length > 0 || subgraph.nodes.length > 0,
      context,
      enrichedPayload,
      suggestedActions,
      stats,
      processingTimeMs: Date.now() - startTime,
      cacheHit: false,
    }

    // 9. Armazena no cache.
    this.cache.set(request, response)

    if (this.options.debug) {
      console.log(
        `[KnowledgeBase] processado em ${response.processingTimeMs}ms — ` +
          `${context.entities.length} entidades, ${context.relations.length} relações`,
      )
    }

    return response
  }

  /* ------------------------------------------------------------------ */
  /* Helpers internos                                                   */
  /* ------------------------------------------------------------------ */

  private buildContext(
    subgraph: ReturnType<typeof retrieveSubgraph>,
    entityIds: Id[],
  ): KnowledgeContext {
    const entityNodes: Node[] = []
    const neighborNodes: Node[] = []
    const entityIdSet = new Set(entityIds)

    for (const node of subgraph.nodes) {
      if (entityIdSet.has(node.id)) {
        entityNodes.push(node)
      } else {
        neighborNodes.push(node)
      }
    }

    // Relacionamentos entre as entidades encontradas.
    const relations: Edge[] = subgraph.edges.filter(
      (edge) => entityIdSet.has(edge.sourceId) && entityIdSet.has(edge.targetId),
    )

    // Resumo textual das relações mais importantes.
    const summary = this.buildSummary(entityNodes, relations, neighborNodes)

    return {
      entities: entityNodes,
      relations,
      neighbors: neighborNodes.slice(0, this.options.maxContextNodes),
      summary,
    }
  }

  private buildSummary(entities: Node[], relations: Edge[], neighbors: Node[]): string {
    const parts: string[] = []

    if (entities.length > 0) {
      parts.push(
        `Entidades identificadas: ${entities.map((e) => `[${e.type}] ${e.label}`).join(', ')}`,
      )
    }

    if (relations.length > 0) {
      const relDescriptions = relations.map((r) => `${r.sourceId} --[${r.type}]--> ${r.targetId}`)
      parts.push(`Relações: ${relDescriptions.join('; ')}`)
    }

    if (neighbors.length > 0) {
      parts.push(
        `Vizinhos relevantes: ${neighbors.map((n) => `[${n.type}] ${n.label}`).join(', ')}`,
      )
    }

    return parts.length > 0 ? parts.join(' | ') : 'Nenhuma entidade relevante encontrada.'
  }

  private enrichPayload<Payload extends Record<string, unknown>>(
    payload: Payload,
    context: KnowledgeContext,
    entities: ExtractedEntity[],
    entityIds: Id[],
  ): Payload {
    const enriched: Record<string, unknown> = { ...payload }

    const knowledgeBaseEnrichment: Record<string, unknown> = {
      entityIds,
      entities: context.entities.map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
      })),
      relations: context.relations.map((r) => ({
        id: r.id,
        type: r.type,
        sourceId: r.sourceId,
        targetId: r.targetId,
        label: r.label,
      })),
      neighbors: context.neighbors.map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
      })),
      summary: context.summary,
    }

    // Enriquecimento específico por tipo de solicitação.
    if (context.entities.some((e) => e.type === 'USUARIO')) {
      knowledgeBaseEnrichment.certificadosDoUsuario = context.entities
        .filter((e) => e.type === 'CERTIFICADO')
        .map((e) => ({ id: e.id, label: e.label }))
    }

    if (context.entities.some((e) => e.type === 'PORTAL')) {
      knowledgeBaseEnrichment.usuariosComAcesso = context.entities
        .filter((e) => e.type === 'USUARIO')
        .map((e) => ({ id: e.id, label: e.label }))
    }

    enriched._knowledgeBase = knowledgeBaseEnrichment

    return enriched as Payload
  }

  private suggestActions(
    context: KnowledgeContext,
    entities: ExtractedEntity[],
    requestType: string,
  ): string[] {
    const actions: string[] = []

    const temCertificado = context.entities.some((e) => e.type === 'CERTIFICADO')
    const temPortal = context.entities.some((e) => e.type === 'PORTAL')
    const temUsuario = context.entities.some((e) => e.type === 'USUARIO')
    const temSessao = context.entities.some((e) => e.type === 'SESSAO')

    if (requestType === 'consulta_certificado' && temUsuario && !temCertificado) {
      actions.push('Listar certificados do usuário antes de prosseguir')
    }
    if (temCertificado && temPortal) {
      actions.push('Verificar se o certificado é válido para o portal selecionado')
    }
    if (temUsuario && temPortal) {
      actions.push('Criar sessão isolada para o usuário no portal')
    }
    if (temSessao && !temCertificado) {
      actions.push('Associar um certificado à sessão antes de acessar o portal')
    }
    if (context.relations.length > 0) {
      actions.push('Revisar permissões efetivas do usuário nas relações encontradas')
    }

    if (actions.length === 0) {
      actions.push('Continuar com o processamento normal da solicitação')
    }

    return actions
  }

  /* ------------------------------------------------------------------ */
  /* Consultas diretas                                                  */
  /* ------------------------------------------------------------------ */

  /** Retorna o grafo subjacente. */
  getGraph(): KnowledgeGraph {
    return this.kg
  }

  /** Estatísticas atuais do grafo. */
  getStats(): GraphStats {
    return this.kg.getStats()
  }

  /** Limpa o cache de consultas. */
  clearCache(): void {
    this.cache.clear()
  }

  /** Tamanho atual do cache. */
  get cacheSize(): number {
    return this.cache.size
  }
}
