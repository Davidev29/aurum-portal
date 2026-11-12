/**
 * Cache de consultas da Base de Conhecimento.
 *
 * Armazena respostas de solicitações já processadas, indexadas por hash da
 * solicitação, com TTL e limite de entradas (LRU simples).
 */

import type { Id } from './types'
import type { KnowledgeResponse, KnowledgeRequest } from './knowledge-base.types'

interface CacheEntry {
  response: KnowledgeResponse
  expiresAt: number
  accessedAt: number
  accessCount: number
}

/**
 * Campos mínimos usados para gerar a chave de cache de uma solicitação.
 */
interface CacheKey {
  type: string
  query?: string
  originatorId?: Id
  payload: Record<string, unknown>
}

/**
 * Hash simples de string para usar como chave de cache.
 * Não é criptográfico, serve apenas para deduplicar solicitações iguais.
 */
function hashRequest(key: CacheKey): string {
  const payload = JSON.stringify(key)
  let hash = 0
  for (let i = 0; i < payload.length; i++) {
    const char = payload.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * Cache em memória com TTL e eviction LRU simples.
 */
export class KnowledgeCache {
  private entries = new Map<string, CacheEntry>()
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000 // 5 minutos
    this.maxEntries = options.maxEntries ?? 200
  }

  /** Retorna a resposta em cache se existir e não estiver expirada. */
  get(request: KnowledgeRequest): KnowledgeResponse | null {
    const key: CacheKey = {
      type: request.type,
      query: request.query,
      originatorId: request.originatorId,
      payload: request.payload,
    }
    const entry = this.entries.get(hashRequest(key))

    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(hashRequest(key))
      return null
    }

    // Atualiza estatísticas de acesso (LRU).
    entry.accessedAt = Date.now()
    entry.accessCount += 1

    return {
      ...entry.response,
      cacheHit: true,
    }
  }

  /** Armazena uma resposta no cache. */
  set(request: KnowledgeRequest, response: KnowledgeResponse): void {
    const key: CacheKey = {
      type: request.type,
      query: request.query,
      originatorId: request.originatorId,
      payload: request.payload,
    }
    const hash = hashRequest(key)

    // Eviction se exceder o limite (remove o menos acessado e mais antigo).
    if (this.entries.size >= this.maxEntries && !this.entries.has(hash)) {
      let lruKey: string | null = null
      let lruScore = Infinity
      for (const [k, v] of this.entries) {
        const score = v.accessCount * 1000 - v.accessedAt
        if (score < lruScore) {
          lruScore = score
          lruKey = k
        }
      }
      if (lruKey) this.entries.delete(lruKey)
    }

    this.entries.set(hash, {
      response: { ...response, cacheHit: false },
      expiresAt: Date.now() + this.ttlMs,
      accessedAt: Date.now(),
      accessCount: 1,
    })
  }

  /** Remove uma entrada específica. */
  delete(request: KnowledgeRequest): boolean {
    const key: CacheKey = {
      type: request.type,
      query: request.query,
      originatorId: request.originatorId,
      payload: request.payload,
    }
    return this.entries.delete(hashRequest(key))
  }

  /** Limpa todo o cache. */
  clear(): void {
    this.entries.clear()
  }

  /** Quantidade de entradas ativas (não expiradas). */
  get size(): number {
    const now = Date.now()
    let valid = 0
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key)
      } else {
        valid += 1
      }
    }
    return valid
  }
}
