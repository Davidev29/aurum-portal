/**
 * Retriever de subgrafo para consultas LLM.
 *
 * Recebe uma pergunta em linguagem natural, identifica os nós mencionados
 * (por correspondência de palavras-chave em labels e propriedades) e expande
 * para os vizinhos até N saltos, retornando o subgrafo relevante como
 * contexto para o modelo.
 */

import { type KnowledgeGraph, type Id, type Node, type Edge } from '../index'
import type { RetrieverOptions, GraphQueryContext } from './types'

const DEFAULT_MAX_HOPS = 2
const DEFAULT_MAX_NODES = 50

/**
 * Tokeniza um texto em palavras minúsculas, removendo pontuação e stopwords
 * básicas do português.
 */
function tokenize(text: string): string[] {
  const stopwords = new Set([
    'a',
    'o',
    'as',
    'os',
    'um',
    'uma',
    'uns',
    'umas',
    'e',
    'ou',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'por',
    'para',
    'com',
    'sem',
    'sobre',
    'entre',
    'que',
    'qual',
    'quais',
    'quem',
    'onde',
    'quando',
    'como',
    'porque',
    'por que',
    'é',
    'são',
    'foi',
    'foram',
    'ser',
    'estar',
    'tem',
    'tenho',
    'tem',
    'têm',
    'meu',
    'minha',
    'seu',
    'sua',
    'nosso',
    'qualquer',
    'cada',
    'todo',
    'todos',
    'esse',
    'essa',
    'este',
    'esta',
  ])

  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !stopwords.has(t) && t.length > 1)
}

/** Score de correspondência de um nó contra um conjunto de tokens. */
function nodeMatchScore(node: Node, tokens: string[]): number {
  if (tokens.length === 0) return 0

  const haystack: string[] = [
    node.label,
    ...Object.values(node.properties)
      .filter((v): v is string => typeof v === 'string')
      .map((s) => s),
  ]

  const text = haystack.join(' ').toLowerCase()
  let matches = 0
  for (const token of tokens) {
    if (text.includes(token)) matches += 1
  }

  return matches / tokens.length
}

/**
 * Extrai os IDs dos nós mais relevantes para a pergunta, ordenados por
 * score de correspondência.
 */
function findRelevantNodes(
  kg: KnowledgeGraph,
  question: string,
  limit: number,
): Array<{ id: Id; score: number }> {
  const tokens = tokenize(question)
  const nodes = kg.getNodes()

  const scored = nodes
    .map((node) => ({
      id: node.id,
      score: nodeMatchScore(node, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, limit)
}

/**
 * Expande os nós iniciais para vizinhos até maxHops saltos, montando o
 * subgrafo induzido (nós + arestas entre eles).
 */
function expandSubgraph(
  kg: KnowledgeGraph,
  seeds: Array<{ id: Id; score: number }>,
  options: Required<RetrieverOptions>,
): GraphQueryContext {
  const { maxHops, maxNodes, inducedSubgraph } = options

  const relevanceScore: Record<Id, number> = {}
  for (const { id, score } of seeds) {
    relevanceScore[id] = score
  }

  const selectedIds = new Set<Id>()
  const frontier: Array<{ id: Id; depth: number }> = seeds.map(({ id }) => ({ id, depth: 0 }))

  // BFS por profundidade.
  const visited = new Set<Id>()
  while (frontier.length > 0 && selectedIds.size < maxNodes) {
    const { id, depth } = frontier.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    selectedIds.add(id)

    if (depth >= maxHops) continue

    const neighbors = kg.getNeighbors(id, { direction: 'both' })
    for (const neighbor of neighbors) {
      if (selectedIds.size >= maxNodes) break
      if (!visited.has(neighbor.id)) {
        // Herda score decaído com a distância.
        const inheritedScore = (relevanceScore[id] ?? 0) * 0.5
        const current = relevanceScore[neighbor.id] ?? 0
        relevanceScore[neighbor.id] = Math.max(current, inheritedScore)
        frontier.push({ id: neighbor.id, depth: depth + 1 })
      }
    }
  }

  // Coleta nós selecionados.
  const nodes: Node[] = []
  for (const id of selectedIds) {
    const node = kg.getNode(id)
    if (node) nodes.push(node)
  }

  // Coleta arestas entre nós selecionados (subgrafo induzido) ou todas as
  // arestas incidentes aos nós selecionados.
  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const edges: Edge[] = []
  for (const node of nodes) {
    for (const edge of kg.getOutgoingEdges(node.id)) {
      if (!inducedSubgraph || nodeIdSet.has(edge.targetId)) {
        edges.push(edge)
      }
    }
    for (const edge of kg.getIncomingEdges(node.id)) {
      if (!inducedSubgraph || nodeIdSet.has(edge.sourceId)) {
        // Evita duplicar arestas já coletadas via saída.
        if (!edges.some((e) => e.id === edge.id)) {
          edges.push(edge)
        }
      }
    }
  }

  return {
    nodes,
    edges,
    hops: maxHops,
    relevanceScore,
  }
}

/**
 * Extrai os nós mais relevantes para a pergunta e expande para o subgrafo
 * circundante, pronto para ser consumido por um LLM.
 */
export function retrieveSubgraph(
  kg: KnowledgeGraph,
  question: string,
  options: RetrieverOptions = {},
): GraphQueryContext {
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const inducedSubgraph = options.inducedSubgraph ?? false

  const seeds = findRelevantNodes(kg, question, maxNodes)
  if (seeds.length === 0) {
    return { nodes: [], edges: [], hops: 0, relevanceScore: {} }
  }

  return expandSubgraph(kg, seeds, { maxHops, maxNodes, inducedSubgraph })
}

/**
 * Convenience: retorna apenas os IDs dos nós mais relevantes para a pergunta.
 */
export function findRelevantNodeIds(kg: KnowledgeGraph, question: string, limit = 10): Id[] {
  return findRelevantNodes(kg, question, limit).map((entry) => entry.id)
}
