/**
 * Tipos da camada LLM-ready do Grafo de Conhecimento.
 *
 * Converte a estrutura do grafo em contexto estruturado que um modelo de
 * linguagem pode consumir para responder perguntas com menos alucinações e
 * menor custo de contexto (apenas o subgrafo relevante).
 */

import type { Id, Node, Edge, GraphStats } from '../types'

/* ------------------------------------------------------------------ */
/* Cliente de LLM (agnóstico a provedor)                              */
/* ------------------------------------------------------------------ */

/** Assinatura de um cliente de LLM. Injetável pelo consumidor. */
export interface LLMClient {
  /**
   * Envia um prompt para o modelo e retorna o texto gerado.
   * @param prompt - Prompt completo (sistema + usuário + contexto).
   * @param options - Parâmetros de amostragem opcionais.
   */
  complete(prompt: string, options?: LLMOptions): Promise<string>
}

export interface LLMOptions {
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

/* ------------------------------------------------------------------ */
/* Contexto de consulta                                               */
/* ------------------------------------------------------------------ */

/** Subgrafo extraído para uma pergunta, com pontuação de relevância. */
export interface GraphQueryContext {
  nodes: Node[]
  edges: Edge[]
  /** Quantos saltos foram percorridos a partir das entidades encontradas. */
  hops: number
  /** Score de relevância por nó (0 a 1), útil para ordenar no prompt. */
  relevanceScore: Record<Id, number>
}

export interface GraphQueryResult {
  question: string
  /** IDs dos nós identificados na pergunta. */
  entitiesFound: Id[]
  context: GraphQueryContext
  /** Prompt textual montado (sistema + instruções + contexto + pergunta). */
  prompt: string
  /** Representação JSON do subgrafo (útil para modo JSON do modelo). */
  jsonContext: string
  stats: GraphStats
}

/* ------------------------------------------------------------------ */
/* Configuração do retriever                                          */
/* ------------------------------------------------------------------ */

export interface RetrieverOptions {
  /** Máximo de saltos a partir das entidades encontradas (padrão: 2). */
  maxHops?: number
  /** Máximo de nós a retornar no contexto (padrão: 50). */
  maxNodes?: number
  /** Se verdadeiro, inclui apenas arestas entre nós selecionados. */
  inducedSubgraph?: boolean
}

/* ------------------------------------------------------------------ */
/* Prompt builder                                                     */
/* ------------------------------------------------------------------ */

export interface PromptBuilderOptions {
  /** Instruções de sistema customizadas. */
  systemPrompt?: string
  /** Idioma da resposta (padrão: pt-BR). */
  language?: string
  /** Se o modelo deve responder em modo JSON. */
  jsonMode?: boolean
}
