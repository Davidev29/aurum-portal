/**
 * Orquestrador de consultas LLM sobre o Grafo de Conhecimento.
 *
 * Expõe uma função única de consulta que:
 *  1. Recebe uma pergunta em linguagem natural.
 *  2. Recupera o subgrafo relevante.
 *  3. Monta o contexto (texto + JSON) otimizado para LLM.
 *  4. (Opcional) Envia para um cliente de LLM injetável e retorna a resposta.
 *
 * O consumidor pode usar apenas o contexto (para enviar ao seu próprio LLM)
 * ou injetar um cliente de LLM para obter a resposta pronta.
 */

import { type KnowledgeGraph, type Id } from '../index'
import type {
  LLMClient,
  LLMOptions,
  GraphQueryResult,
  RetrieverOptions,
  PromptBuilderOptions,
} from './types'
import { buildLLMContext } from './context-builder'

/* ------------------------------------------------------------------ */
/* Resultado da consulta                                              */
/* ------------------------------------------------------------------ */

/**
 * Resultado completo de uma consulta LLM-ready.
 */
export interface GraphQueryResponse {
  question: string
  entitiesFound: Id[]
  context: GraphQueryResult['context']
  prompt: string
  jsonContext: string
  stats: GraphQueryResult['stats']
  /** Resposta gerada pelo LLM (apenas se um cliente foi injetado). */
  llmAnswer?: string
}

/* ------------------------------------------------------------------ */
/* Orquestrador                                                       */
/* ------------------------------------------------------------------ */

/**
 * Consulta o Grafo de Conhecimento e retorna contexto pronto para LLM.
 *
 * @param kg - Instância do grafo de conhecimento.
 * @param question - Pergunta em linguagem natural.
 * @param llmClient - (Opcional) Cliente de LLM. Se fornecido, o contexto
 *   é enviado ao modelo e a resposta é devolvida em `llmAnswer`.
 * @param llmOptions - Opções de amostragem para o LLM.
 * @param retriever - Opções do retriever (saltos, limite de nós...).
 * @param prompt - Opções de montagem do prompt.
 */
export async function queryKnowledgeGraph(
  kg: KnowledgeGraph,
  question: string,
  options?: {
    llmClient?: LLMClient
    llmOptions?: LLMOptions
    retriever?: RetrieverOptions
    prompt?: PromptBuilderOptions
  },
): Promise<GraphQueryResponse> {
  const { llmClient, llmOptions, retriever, prompt } = options ?? {}

  const result = buildLLMContext(kg, question, { retriever, prompt })

  let llmAnswer: string | undefined
  if (llmClient) {
    llmAnswer = await llmClient.complete(result.prompt, llmOptions)
  }

  return {
    question: result.question,
    entitiesFound: result.entitiesFound,
    context: result.context,
    prompt: result.prompt,
    jsonContext: result.jsonContext,
    stats: result.stats,
    llmAnswer,
  }
}

/* ------------------------------------------------------------------ */
/* Exemplo de cliente de LLM (OpenAI-compatible)                      */
/* ------------------------------------------------------------------ */

/**
 * Exemplo de implementação de LLMClient para uma API compatível com
 * OpenAI (chat/completions). Copie e adapte para o seu provedor.
 *
 * ```ts
 * const client: LLMClient = createOpenAILLMClient({
 *   apiKey: process.env.OPENAI_API_KEY!,
 *   baseURL: 'https://api.openai.com/v1',
 *   model: 'gpt-4o-mini',
 * })
 * const resposta = await queryKnowledgeGraph(kg, 'Quais portais Maria acessa?', {
 *   llmClient: client,
 * })
 * ```
 */
export function createOpenAILLMClient(params: {
  apiKey: string
  baseURL?: string
  model?: string
}): LLMClient {
  const baseURL = params.baseURL ?? 'https://api.openai.com/v1'
  const model = params.model ?? 'gpt-4o-mini'

  return {
    async complete(prompt, options) {
      const systemPrompt = options?.systemPrompt
      const messages: Array<{ role: string; content: string }> = []

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt })
      }
      messages.push({ role: 'user', content: prompt })

      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options?.temperature ?? 0.2,
          max_tokens: options?.maxTokens,
        }),
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`LLM request failed: ${response.status} ${text}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content ?? ''
    },
  }
}
