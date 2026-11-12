/**
 * Testes unitários da camada LLM-ready do Grafo de Conhecimento.
 *
 * Cobrem: retriever, context builder (texto/JSON/prompt), buildLLMContext
 * e o orquestrador com cliente de LLM mockado.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  KnowledgeGraph,
  makeId,
  seedKnowledgeGraph,
  defaultSeed,
  retrieveSubgraph,
  findRelevantNodeIds,
  buildContextText,
  buildContextJSON,
  buildPrompt,
  buildLLMContext,
  queryKnowledgeGraph,
  type LLMClient,
} from '@/lib/knowledge-graph'

const USUARIO = 'USUARIO' as const
const CERTIFICADO = 'CERTIFICADO' as const
const PORTAL = 'PORTAL' as const

const POSSUI = 'USUARIO_POSSUI_CERTIFICADO' as const
const VALIDO_PARA = 'CERTIFICADO_VALIDO_PARA_PORTAL' as const

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function novoGrafo() {
  return new KnowledgeGraph()
}

/* ------------------------------------------------------------------ */
/* Retriever                                                          */
/* ------------------------------------------------------------------ */

describe('retriever', () => {
  it('encontra nós relevantes por palavras-chave da pergunta', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: { cpf: '111.222.333-44' },
    })
    kg.addNode({
      id: makeId('p:ecnpj'),
      type: PORTAL,
      label: 'e-CNPJ',
      properties: { url: 'https://ecnpj.receita.fazenda.gov.br' },
    })

    const ids = findRelevantNodeIds(kg, 'Maria e-CNPJ', 10)
    expect(ids).toContain(makeId('u:maria'))
    expect(ids).toContain(makeId('p:ecnpj'))
  })

  it('retrieveSubgraph expande para vizinhos (1 salto)', () => {
    const kg = novoGrafo()
    const u = kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: {},
    })
    const c = kg.addNode({
      id: makeId('c:ecnpj'),
      type: CERTIFICADO,
      label: 'e-CNPJ Maria',
      properties: {},
    })
    const p = kg.addNode({
      id: makeId('p:ecnpj'),
      type: PORTAL,
      label: 'e-CNPJ',
      properties: {},
    })

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })
    kg.addEdge({
      type: VALIDO_PARA,
      sourceId: c.id,
      targetId: p.id,
      sourceType: CERTIFICADO,
      targetType: PORTAL,
      properties: {},
    })

    const ctx = retrieveSubgraph(kg, 'Maria', { maxHops: 2, maxNodes: 50 })

    expect(ctx.nodes.length).toBeGreaterThanOrEqual(2)
    expect(ctx.edges.length).toBeGreaterThanOrEqual(1)
    // Maria → certificado → portal (2 saltos)
    const temPortal = ctx.nodes.some((n) => n.id === p.id)
    expect(temPortal).toBe(true)
  })

  it('retorna vazio quando não há correspondência', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:fulano'),
      type: USUARIO,
      label: 'Fulano',
      properties: {},
    })

    const ctx = retrieveSubgraph(kg, 'zzznadaquecorresponda', { maxHops: 2 })
    expect(ctx.nodes.length).toBe(0)
    expect(ctx.edges.length).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Context builder                                                    */
/* ------------------------------------------------------------------ */

describe('context builder', () => {
  it('buildContextText inclui nós e arestas', () => {
    const kg = novoGrafo()
    const u = kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: { cpf: '111.222.333-44' },
    })
    const c = kg.addNode({
      id: makeId('c:ecnpj'),
      type: CERTIFICADO,
      label: 'e-CNPJ Maria',
      properties: {},
    })
    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })

    const ctx = retrieveSubgraph(kg, 'Maria', { maxHops: 1 })
    const text = buildContextText(ctx)

    expect(text).toContain('Maria Silva')
    expect(text).toContain('e-CNPJ Maria')
    expect(text).toContain('USUARIO_POSSUI_CERTIFICADO')
    expect(text).toContain('=== GRAFO DE CONHECIMENTO')
  })

  it('buildContextJSON gera JSON válido com relevância', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: {},
    })
    const ctx = retrieveSubgraph(kg, 'Maria', { maxHops: 1 })

    const json = buildContextJSON(ctx)
    const parsed = JSON.parse(json)
    expect(parsed.nodes.length).toBeGreaterThanOrEqual(1)
    expect(parsed.nodes[0]).toHaveProperty('_relevanceScore')
    expect(parsed.hops).toBeDefined()
  })

  it('buildPrompt contém a pergunta e o contexto', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: {},
    })
    const ctx = retrieveSubgraph(kg, 'Maria', { maxHops: 1 })

    const prompt = buildPrompt('Quais certificados Maria possui?', ctx, {
      nodeCount: kg.getNodeCount(),
      edgeCount: kg.getEdgeCount(),
    })

    expect(prompt).toContain('Quais certificados Maria possui?')
    expect(prompt).toContain('Maria Silva')
    expect(prompt).toContain('Regras:')
  })

  it('buildPrompt modo JSON inclui instruções de JSON', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: {},
    })
    const ctx = retrieveSubgraph(kg, 'Maria', { maxHops: 1 })

    const prompt = buildPrompt(
      'Pergunta?',
      ctx,
      {
        nodeCount: 1,
        edgeCount: 0,
      },
      { jsonMode: true },
    )

    expect(prompt).toContain('JSON')
  })
})

/* ------------------------------------------------------------------ */
/* buildLLMContext                                                    */
/* ------------------------------------------------------------------ */

describe('buildLLMContext', () => {
  it('monta resultado completo para LLM', () => {
    const kg = seedKnowledgeGraph(novoGrafo())
    const result = buildLLMContext(kg, 'Quais portais Maria acessa?')

    expect(result.question).toBe('Quais portais Maria acessa?')
    expect(result.entitiesFound.length).toBeGreaterThanOrEqual(0)
    expect(result.context.nodes.length).toBeGreaterThanOrEqual(0)
    expect(result.prompt.length).toBeGreaterThan(0)
    expect(result.jsonContext.length).toBeGreaterThan(0)
    expect(result.stats.nodeCount).toBeGreaterThan(0)
    expect(result.stats.edgeCount).toBeGreaterThan(0)

    // O JSON deve ser parseável
    JSON.parse(result.jsonContext)
  })

  it('usa defaultSeed quando não há correspondência direta', () => {
    const result = buildLLMContext(defaultSeed, 'certificado e-CNPJ')
    expect(result.context.nodes.length).toBeGreaterThan(0)
    expect(result.entitiesFound.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* Orquestrador com cliente de LLM mockado                            */
/* ------------------------------------------------------------------ */

describe('queryKnowledgeGraph', () => {
  it('retorna contexto sem llamar o LLM quando não há cliente', async () => {
    const kg = seedKnowledgeGraph(novoGrafo())
    const resposta = await queryKnowledgeGraph(kg, 'Quais portais Maria acessa?')

    expect(resposta.question).toBe('Quais portais Maria acessa?')
    expect(resposta.llmAnswer).toBeUndefined()
    expect(resposta.prompt.length).toBeGreaterThan(0)
    expect(resposta.jsonContext.length).toBeGreaterThan(0)
  })

  it('envia o prompt para o LLM e retorna a resposta', async () => {
    const kg = seedKnowledgeGraph(novoGrafo())

    const mockClient: LLMClient = {
      complete: vi.fn().mockResolvedValue('Resposta simulada do LLM'),
    }

    const resposta = await queryKnowledgeGraph(kg, 'Quais portais Maria acessa?', {
      llmClient: mockClient,
    })

    expect(mockClient.complete).toHaveBeenCalledTimes(1)
    const promptEnviado = mockClient.complete.mock.calls[0][0]
    expect(promptEnviado).toContain('Quais portais Maria acessa?')
    expect(resposta.llmAnswer).toBe('Resposta simulada do LLM')
  })

  it('passa opções de amostragem para o LLM', async () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:teste'),
      type: USUARIO,
      label: 'Teste',
      properties: {},
    })

    const mockClient: LLMClient = {
      complete: vi.fn().mockResolvedValue('ok'),
    }

    await queryKnowledgeGraph(kg, 'Teste', {
      llmClient: mockClient,
      llmOptions: { temperature: 0.7, maxTokens: 500 },
    })

    const opts = mockClient.complete.mock.calls[0][1]
    expect(opts?.temperature).toBe(0.7)
    expect(opts?.maxTokens).toBe(500)
  })
})
