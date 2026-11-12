/**
 * Grafo de Conhecimento — AurumBit Portal.
 *
 * Exporta o núcleo genérico do grafo, os tipos, os dados de semente do
 * domínio (usuários, certificados ICP-Brasil, portais gov.br, sessões,
 * perfis e permissões) e os helpers de consulta específica do domínio.
 */

export type {
  Id,
  NodeType,
  NodeTypes,
  RelationType,
  RelationTypes,
  Node,
  NodeInput,
  Edge,
  EdgeInput,
  Properties,
  SerializedGraph,
  Path,
  PathStep,
  GraphStats,
} from './types'
export { makeId } from './types'
export { KnowledgeGraph } from './knowledge-graph'
export { seedKnowledgeGraph, defaultSeed } from './seed'
export {
  certificadosDoUsuario,
  portaisDoUsuario,
  sessoesDoUsuario,
  perfisDoUsuario,
  certificadosValidosParaPortal,
  usuariosComAcessoAoPortal,
  caminhoDeUsuarioParaPortal,
  estaConectado,
  permissoesEfetivasDoUsuario,
} from './domain'

/* ------------------------------------------------------------------ */
/* Camada LLM-ready                                                   */
/* ------------------------------------------------------------------ */

export type {
  LLMClient,
  LLMOptions,
  GraphQueryContext,
  GraphQueryResult,
  RetrieverOptions,
  PromptBuilderOptions,
} from './llm/types'
export type { GraphQueryResponse } from './llm/orchestrator'

export { retrieveSubgraph, findRelevantNodeIds } from './llm/retriever'
export {
  buildContextText,
  buildContextJSON,
  buildPrompt,
  buildLLMContext,
} from './llm/context-builder'
export { queryKnowledgeGraph, createOpenAILLMClient } from './llm/orchestrator'

/* ------------------------------------------------------------------ */
/* Base de Conhecimento (interceptação de solicitações)               */
/* ------------------------------------------------------------------ */

export type {
  KnowledgeRequest,
  KnowledgeResponse,
  KnowledgeContext,
  KnowledgeBaseOptions,
  ExtractedEntity,
} from './knowledge-base.types'

export {
  initKnowledgeBase,
  getKnowledgeBase,
  withKnowledgeBase,
  createKnowledgeRequest,
  KnowledgeRequestTypes,
} from './knowledge-base.middleware'

export { KnowledgeBase } from './knowledge-base'
export { KnowledgeCache } from './knowledge-base.cache'
export { extractEntities, resolveEntityIds } from './knowledge-base.extractor'
