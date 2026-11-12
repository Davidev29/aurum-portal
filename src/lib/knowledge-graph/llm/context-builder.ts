/**
 * Construtor de contexto LLM-ready.
 *
 * Transforma um subgrafo do Grafo de Conhecimento em:
 *  1. Texto estruturado otimizado para prompts de linguagem natural.
 *  2. Representação JSON (útil para modo JSON do modelo).
 *  3. Prompt completo (instruções + contexto + pergunta).
 */

import { type KnowledgeGraph, type Node, type Edge } from '../index'
import type { GraphQueryContext, GraphQueryResult, PromptBuilderOptions } from './types'
import { retrieveSubgraph, findRelevantNodeIds } from './retriever'
import type { RetrieverOptions } from './types'

const DEFAULT_LANGUAGE = 'pt-BR'

/* ------------------------------------------------------------------ */
/* Helpers de formatação                                              */
/* ------------------------------------------------------------------ */

function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'sim' : 'não'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(value)
}

function formatNode(node: Node, score: number): string {
  const props = Object.entries(node.properties)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `  ${k}: ${formatPropertyValue(v)}`)
    .join('\n')

  const scoreLabel = score > 0 ? ` (relevância: ${(score * 100).toFixed(0)}%)` : ''
  const propBlock = props ? `\n${props}\n` : ''

  return `- [${node.type}] ${node.label}${scoreLabel}\n  id: ${node.id}${propBlock}`
}

function formatEdge(edge: Edge): string {
  const props = Object.entries(edge.properties)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `  ${k}: ${formatPropertyValue(v)}`)
    .join('\n')

  const propBlock = props ? `\n${props}\n` : ''
  const label = edge.label ? ` (${edge.label})` : ''

  return `- (${edge.sourceId}) --[${edge.type}${label}]--> (${edge.targetId})${propBlock}`
}

/* ------------------------------------------------------------------ */
/* Contexto textual                                                   */
/* ------------------------------------------------------------------ */

/**
 * Monta um bloco de texto legível para o LLM contendo nós e arestas do
 * subgrafo, ordenados por relevância.
 */
export function buildContextText(context: GraphQueryContext): string {
  const { nodes, edges, relevanceScore, hops } = context

  if (nodes.length === 0 && edges.length === 0) {
    return 'Nenhuma entidade relevante encontrada no grafo de conhecimento.'
  }

  // Ordena nós por score de relevância descrescente.
  const sortedNodes = [...nodes].sort(
    (a, b) => (relevanceScore[b.id] ?? 0) - (relevanceScore[a.id] ?? 0),
  )

  const nodeLines = sortedNodes.map((n) => formatNode(n, relevanceScore[n.id] ?? 0))
  const edgeLines = edges.map((e) => formatEdge(e))

  const lines: string[] = []
  lines.push('=== GRAFO DE CONHECIMENTO (contexto relevante) ===')
  lines.push(`Entidades encontradas: ${nodes.length}`)
  lines.push(`Relações encontradas: ${edges.length}`)
  lines.push(`Profundidade de navegação: ${hops} salto(s)`)
  lines.push('')
  lines.push('--- NÓS ---')
  lines.push(...nodeLines)
  lines.push('')
  lines.push('--- ARESTAS (Relações) ---')
  lines.push(...edgeLines)
  lines.push('')
  lines.push('=== FIM DO CONTEXTO ===')

  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Contexto JSON                                                      */
/* ------------------------------------------------------------------ */

/**
 * Serializa o subgrafo como JSON estruturado, incluindo score de
 * relevância anexado a cada nó.
 */
export function buildContextJSON(context: GraphQueryContext): string {
  const payload = {
    nodes: context.nodes.map((n) => ({
      ...n,
      _relevanceScore: context.relevanceScore[n.id] ?? 0,
    })),
    edges: context.edges,
    hops: context.hops,
    nodeCount: context.nodes.length,
    edgeCount: context.edges.length,
  }
  return JSON.stringify(payload, null, 2)
}

/* ------------------------------------------------------------------ */
/* Prompt completo                                                    */
/* ------------------------------------------------------------------ */

/**
 * Monta o prompt completo a ser enviado ao LLM, contendo instruções de
 * sistema, o contexto do grafo e a pergunta do usuário.
 */
export function buildPrompt(
  question: string,
  context: GraphQueryContext,
  stats: { nodeCount: number; edgeCount: number },
  options: PromptBuilderOptions = {},
): string {
  const language = options.language ?? DEFAULT_LANGUAGE
  const jsonMode = options.jsonMode ?? false
  const systemPrompt = options.systemPrompt ?? defaultSystemPrompt(language, jsonMode)

  const contextText = buildContextText(context)
  const contextJSON = buildContextJSON(context)

  const lines: string[] = []
  lines.push(systemPrompt)
  lines.push('')
  lines.push('--- CONTEXTO DO GRAFO DE CONHECIMENTO ---')
  lines.push(contextText)
  lines.push('')
  lines.push('--- CONTEXTO ESTRUTURADO (JSON) ---')
  lines.push(contextJSON)
  lines.push('')
  lines.push('--- ESTATÍSTICAS ---')
  lines.push(`- Total de nós no grafo: ${stats.nodeCount}`)
  lines.push(`- Total de arestas no grafo: ${stats.edgeCount}`)
  lines.push(`- Nós neste contexto: ${context.nodes.length}`)
  lines.push(`- Arestas neste contexto: ${context.edges.length}`)
  lines.push('')
  lines.push('--- PERGUNTA DO USUÁRIO ---')
  lines.push(question)
  lines.push('')
  lines.push('--- INSTRUÇÕES DE RESPOSTA ---')
  lines.push(responseInstructions(language, jsonMode))

  return lines.join('\n')
}

function defaultSystemPrompt(language: string, _jsonMode: boolean): string {
  const pt = `
Você é um assistente especializado em responder perguntas com base no
Grafo de Conhecimento do AurumBit Portal (cofre de acessos e sessões isoladas
para portais públicos brasileiros).

Regras:
1. Use APENAS as informações fornecidas no contexto do grafo (nós e
   arestas). Não invente entidades, relacionamentos ou dados.
2. Se a resposta não estiver no contexto, diga claramente que a
   informação não está disponível.
3. Cite os IDs e labels das entidades usadas como base da resposta.
4. Se for modo JSON, retorne APENAS um objeto JSON válido, sem texto
   adicional.
5. Responda em português do Brasil.
`

  const en = `
You are an assistant specialized in answering questions based on the
AurumBit Portal Knowledge Graph (secure access and isolated sessions for
Brazilian public portals).

Rules:
1. Use ONLY the information provided in the graph context (nodes and
   edges). Do not invent entities, relationships, or data.
2. If the answer is not in the context, clearly state that the
   information is not available.
3. Cite entity IDs and labels used as the basis for the answer.
4. If JSON mode, return ONLY a valid JSON object, no extra text.
5. Answer in Brazilian Portuguese.
`

  return language.startsWith('en') ? en : pt
}

function responseInstructions(language: string, _jsonMode: boolean): string {
  if (_jsonMode) {
    return language.startsWith('en')
      ? 'Responda em formato JSON com as chaves: resposta, entidades_citadas, justificativa.'
      : 'Responda em formato JSON com as chaves: answer, cited_entities, rationale.'
  }
  return language.startsWith('en')
    ? 'Responda de forma direta, citando as entidades do grafo que fundamentam a resposta.'
    : 'Answer directly, citing the graph entities that support the answer.'
}

/* ------------------------------------------------------------------ */
/* Orquestração leve (monta GraphQueryResult)                         */
/* ------------------------------------------------------------------ */

/**
 * Monta o resultado completo de consulta para LLM a partir de uma pergunta
 * e um grafo. Não chama o LLM — apenas prepara tudo para o consumidor
 * enviar ao modelo de sua escolha.
 */
export function buildLLMContext(
  kg: KnowledgeGraph,
  question: string,
  options: {
    retriever?: RetrieverOptions
    prompt?: PromptBuilderOptions
  } = {},
): GraphQueryResult {
  const { retriever, prompt } = options

  const context = retrieveSubgraph(kg, question, retriever)
  const seeds = findRelevantNodeIds(kg, question, 10)

  const stats = kg.getStats()

  return {
    question,
    entitiesFound: seeds,
    context,
    prompt: buildPrompt(question, context, stats, prompt),
    jsonContext: buildContextJSON(context),
    stats,
  }
}
