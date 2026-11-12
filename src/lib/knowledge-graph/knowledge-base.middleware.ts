/**
 * Middleware da Base de Conhecimento.
 *
 * Fornece funções para interceptar solicitações da aplicação (UI, IPC,
 * API, LLM) e fazê-las passar pelo Grafo de Conhecimento antes de seguir
 * adiante. Pode ser usado como wrapper em qualquer camada do AurumBit Portal.
 */

import { type KnowledgeGraph, type Id } from './index'
import type {
  KnowledgeRequest,
  KnowledgeResponse,
  KnowledgeBaseOptions,
} from './knowledge-base.types'
import { KnowledgeBase } from './knowledge-base'

/* ------------------------------------------------------------------ */
/* Instância global (opcional)                                        */
/* ------------------------------------------------------------------ */

/**
 * Instância compartilhada da Base de Conhecimento.
 * Inicialize uma vez na inicialização do app (renderer ou main).
 */
let knowledgeBase: KnowledgeBase | null = null

/**
 * Inicializa a Base de Conhecimento com um grafo (ou com os dados de semente
 * se nenhum grafo for fornecido).
 */
export function initKnowledgeBase(
  kg?: KnowledgeGraph,
  options?: KnowledgeBaseOptions,
): KnowledgeBase {
  knowledgeBase = KnowledgeBase.create(kg, options)
  return knowledgeBase
}

/**
 * Retorna a instância inicializada, ou lança se ainda não foi inicializada.
 */
export function getKnowledgeBase(): KnowledgeBase {
  if (!knowledgeBase) {
    throw new Error('Base de Conhecimento não inicializada. Chame initKnowledgeBase() primeiro.')
  }
  return knowledgeBase
}

/* ------------------------------------------------------------------ */
/* Middleware genérico                                                */
/* ------------------------------------------------------------------ */

/**
 * Tipo de uma função de processamento de solicitação (próxima camada).
 */
export type KnowledgeNextHandler<Payload extends Record<string, unknown>> = (
  request: KnowledgeRequest<Payload>,
) => Promise<unknown> | unknown

/**
 * Middleware que intercepta uma solicitação, passa pelo Grafo de
 * Conhecimento e depois encaminha para o próximo handler com o payload
 * enriquecido.
 *
 * Exemplo de uso em um resolver de API:
 * ```ts
 * const handler = withKnowledgeBase(async (request) => {
 *   // request.payload já vem enriquecido com _knowledgeBase
 *   return await aurumBitPortal().certificates.list(request.payload.filter)
 * })
 * ```
 */
export function withKnowledgeBase<Payload extends Record<string, unknown>>(
  next: KnowledgeNextHandler<Payload>,
  options?: {
    /** Se verdadeiro, interrompe o fluxo e retorna a resposta do grafo diretamente. */
    shortCircuit?: boolean
    /** Se verdadeiro, ignora erros do grafo e segue para o próximo handler. */
    failOpen?: boolean
  },
): KnowledgeNextHandler<Payload> {
  const { shortCircuit = false, failOpen = true } = options ?? {}

  return async (request: KnowledgeRequest<Payload>): Promise<unknown> => {
    const kb = getKnowledgeBase()

    let knowledgeResponse: KnowledgeResponse<Payload>
    try {
      knowledgeResponse = kb.process(request)
    } catch (error) {
      if (failOpen) {
        console.warn('[KnowledgeBase] erro no processamento, seguindo em aberto:', error)
        return next(request)
      }
      throw error
    }

    // Enriquece o payload da solicitação original com os dados do grafo.
    const enrichedRequest: KnowledgeRequest<Payload> = {
      ...request,
      payload: knowledgeResponse.enrichedPayload,
    }

    if (shortCircuit) {
      return {
        knowledgeBase: knowledgeResponse,
        shortCircuited: true,
      }
    }

    return next(enrichedRequest)
  }
}

/* ------------------------------------------------------------------ */
/* Helpers de construção de solicitações                              */
/* ------------------------------------------------------------------ */

/**
 * Cria uma KnowledgeRequest padronizada para passar pelo middleware.
 */
export function createKnowledgeRequest<Payload extends Record<string, unknown>>(params: {
  type: KnowledgeRequest['type']
  payload: Payload
  query?: string
  originatorId?: Id
  metadata?: Record<string, unknown>
}): KnowledgeRequest<Payload> {
  return {
    id: (globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
      : () => `req-${Date.now()}`)() as Id,
    type: params.type,
    payload: params.payload,
    query: params.query,
    originatorId: params.originatorId,
    timestamp: new Date().toISOString(),
    metadata: params.metadata,
  }
}

/* ------------------------------------------------------------------ */
/* Tipos de solicitação pré-definidos                                 */
/* ------------------------------------------------------------------ */

/** Tipos de solicitação comuns no AurumBit Portal. */
export const KnowledgeRequestTypes = {
  CONSULTA_CERTIFICADO: 'consulta_certificado' as const,
  CONSULTA_PORTAL: 'consulta_portal' as const,
  CONSULTA_USUARIO: 'consulta_usuario' as const,
  CONSULTA_SESSAO: 'consulta_sessao' as const,
  CONSULTA_PERMISSAO: 'consulta_permissao' as const,
  ACAO_ACESSO: 'acao_acesso' as const,
  ACAO_ASSINATURA: 'acao_assinatura' as const,
  ACAO_EXPORTACAO: 'acao_exportacao' as const,
  GESTAO_SESSAO: 'gestao_sessao' as const,
} as const
