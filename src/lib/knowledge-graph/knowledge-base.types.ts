/**
 * Tipos da Base de Conhecimento — camada de interceptação do Grafo de Conhecimento.
 *
 * Toda solicitação da aplicação passa primeiro por esta camada, que:
 *  1. Extrai entidades mencionadas na solicitação (usuários, certificados, portais…)
 *  2. Busca essas entidades no Grafo de Conhecimento
 *  3. Enriquece a solicitação com relações conhecidas (certificados válidos, sessões, permissões…)
 *  4. Cacheia o resultado para consultas repetidas
 *  5. Retorna uma resposta enriquecida ou encaminha para o próximo processador
 */

import type { Id, Node, Edge, GraphStats, NodeType } from './types'

/* ------------------------------------------------------------------ */
/* Solicitação                                                        */
/* ------------------------------------------------------------------ */

/** Tipo de solicitação que pode ser processada pela base de conhecimento. */
export type KnowledgeRequestType =
  | 'consulta_certificado'
  | 'consulta_portal'
  | 'consulta_usuario'
  | 'consulta_sessao'
  | 'consulta_permissao'
  | 'acao_acesso'
  | 'acao_assinatura'
  | 'acao_exportacao'
  | 'gestao_sessao'
  | (string & {})

/**
 * Solicitação que passa pela Base de Conhecimento.
 * Pode originar-se de UI, IPC (Electron), API ou agente LLM.
 */
export interface KnowledgeRequest<
  Payload extends Record<string, unknown> = Record<string, unknown>,
> {
  id: Id
  type: KnowledgeRequestType
  payload: Payload
  /** Texto livre da solicitação (útil para extração de entidades). */
  query?: string
  /** Usuário ou agente que originou a solicitação. */
  originatorId?: Id
  timestamp: string
  metadata?: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/* Resposta                                                           */
/* ------------------------------------------------------------------ */

/** Nós do grafo relevantes para a solicitação. */
export interface KnowledgeContext {
  /** Entidades encontradas diretamente na solicitação. */
  entities: Node[]
  /** Relações entre as entidades encontradas. */
  relations: Edge[]
  /** Nós vizinhos (1 salto) das entidades encontradas. */
  neighbors: Node[]
  /** Resumo das relações mais importantes. */
  summary: string
}

/** Resultado do processamento pela base de conhecimento. */
export interface KnowledgeResponse<
  Payload extends Record<string, unknown> = Record<string, unknown>,
> {
  requestId: Id
  /** Se a base de conhecimento conseguiu resolver a solicitação diretamente. */
  resolved: boolean
  /** Contexto enriquecido extraído do grafo. */
  context: KnowledgeContext
  /** Dados enriquecidos para incluir na resposta final. */
  enrichedPayload: Payload
  /** Próximos passos sugeridos (ex.: qual portal usar, qual certificado selecionar). */
  suggestedActions: string[]
  /** Estatísticas do grafo no momento da consulta. */
  stats: GraphStats
  /** Tempo gasto no processamento (ms). */
  processingTimeMs: number
  cacheHit: boolean
}

/* ------------------------------------------------------------------ */
/* Opções da base de conhecimento                                     */
/* ------------------------------------------------------------------ */

export interface KnowledgeBaseOptions {
  /** TTL do cache em milissegundos (padrão: 5 minutos). */
  cacheTtlMs?: number
  /** Máximo de entradas no cache (padrão: 200). */
  maxCacheEntries?: number
  /** Máximo de saltos para expansão de vizinhos (padrão: 2). */
  maxHops?: number
  /** Máximo de nós a retornar no contexto (padrão: 30). */
  maxContextNodes?: number
  /** Se verdadeiro, loga cada processamento. */
  debug?: boolean
}

/* ------------------------------------------------------------------ */
/* Resultado de extração de entidades                                 */
/* ------------------------------------------------------------------ */

/** Entidade extraída do texto da solicitação. */
export interface ExtractedEntity {
  type: NodeType
  label: string
  confidence: number // 0 a 1
  sourceText: string // trecho do texto original que gerou esta entidade
}
