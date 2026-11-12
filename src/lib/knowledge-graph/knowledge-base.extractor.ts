/**
 * Extrator de entidades da Base de Conhecimento.
 *
 * Analisa o texto da solicitação e identifica entidades do domínio
 * (usuários, certificados, portais, sessões, perfis, permissões)
 * por correspondência de palavras-chave com labels e propriedades do grafo.
 */

import type { KnowledgeGraph, Id, NodeType } from './index'
import type { ExtractedEntity } from './knowledge-base.types'

const STOPWORDS = new Set([
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
  'eu',
  'você',
  'ele',
  'ela',
  'nós',
  'eles',
  'elas',
  'me',
  'te',
  'se',
  'nos',
  'lhe',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t) && t.length > 1)
}

function containsToken(text: string, token: string): boolean {
  return text.toLowerCase().includes(token)
}

/**
 * Extrai entidades do domínio a partir do texto da solicitação,
 * comparando tokens com labels e propriedades dos nós do grafo.
 */
export function extractEntities(
  kg: KnowledgeGraph,
  query: string,
  maxEntities = 10,
): ExtractedEntity[] {
  if (!query) return []

  const tokens = tokenize(query)
  if (tokens.length === 0) return []

  const nodes = kg.getNodes()
  const scored: ExtractedEntity[] = []

  for (const node of nodes) {
    const haystackParts: string[] = [node.label]
    for (const value of Object.values(node.properties)) {
      if (typeof value === 'string') haystackParts.push(value)
    }
    const haystack = haystackParts.join(' ').toLowerCase()

    let matches = 0
    const matchedTokens: string[] = []
    for (const token of tokens) {
      if (containsToken(haystack, token)) {
        matches += 1
        matchedTokens.push(token)
      }
    }

    if (matches === 0) continue

    const confidence = Math.min(matches / tokens.length, 1)
    const sourceText = matchedTokens.join(' ')

    scored.push({
      type: node.type as NodeType,
      label: node.label,
      confidence,
      sourceText,
    })
  }

  // Ordena por confiança descrescente e limita.
  scored.sort((a, b) => b.confidence - a.confidence)
  return scored.slice(0, maxEntities)
}

/**
 * Converte entidades extraídas em IDs de nós existentes no grafo,
 * quando há correspondência exata de label (case-insensitive).
 */
export function resolveEntityIds(kg: KnowledgeGraph, entities: ExtractedEntity[]): Id[] {
  const resolvedIds = new Set<Id>()
  const nodesByLabel = new Map<string, Id>()

  for (const node of kg.getNodes()) {
    nodesByLabel.set(node.label.toLowerCase(), node.id)
  }

  for (const entity of entities) {
    const id = nodesByLabel.get(entity.label.toLowerCase())
    if (id) resolvedIds.add(id)
  }

  return Array.from(resolvedIds)
}
