/**
 * Camada LLM-ready do Grafo de Conhecimento — AurumBit Portal.
 *
 * Exporta tipos, retriever, construtor de contexto/prompt e orquestrador
 * de consultas. Agnóstico a provedor de LLM: injetue seu próprio cliente
 * (OpenAI, Ollama, Azure, local…) via LLMClient.
 */

export type {
  LLMClient,
  LLMOptions,
  GraphQueryContext,
  GraphQueryResult,
  RetrieverOptions,
  PromptBuilderOptions,
} from './types'

export { retrieveSubgraph, findRelevantNodeIds } from './retriever'
export { buildContextText, buildContextJSON, buildPrompt, buildLLMContext } from './context-builder'
export { queryKnowledgeGraph, createOpenAILLMClient, type GraphQueryResponse } from './orchestrator'
