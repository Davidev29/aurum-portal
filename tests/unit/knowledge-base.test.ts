/**
 * Testes unitários da Base de Conhecimento — camada de interceptação do
 * Grafo de Conhecimento.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  KnowledgeGraph,
  makeId,
  defaultSeed,
  KnowledgeBase,
  initKnowledgeBase,
  getKnowledgeBase,
  withKnowledgeBase,
  createKnowledgeRequest,
  KnowledgeRequestTypes,
  extractEntities,
  resolveEntityIds,
  type KnowledgeRequest,
} from '@/lib/knowledge-graph'

const USUARIO = 'USUARIO' as const
const PORTAL = 'PORTAL' as const

function novoGrafo() {
  return new KnowledgeGraph()
}

/* ------------------------------------------------------------------ */
/* KnowledgeBase - criação                                            */
/* ------------------------------------------------------------------ */

describe('KnowledgeBase - criação', () => {
  it('cria com dados de semente quando nenhum grafo é fornecido', () => {
    const kb = KnowledgeBase.create()
    expect(kb.getStats().nodeCount).toBeGreaterThan(0)
    expect(kb.getStats().edgeCount).toBeGreaterThan(0)
  })

  it('cria com grafo fornecido', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:1'),
      type: USUARIO,
      label: 'Usuário Teste',
      properties: {},
    })
    const kb = KnowledgeBase.create(kg)
    expect(kb.getStats().nodeCount).toBe(1)
  })

  it('getStats retorna estatísticas do grafo', () => {
    const kb = KnowledgeBase.create()
    const stats = kb.getStats()
    expect(stats.nodeCount).toBeGreaterThan(0)
    expect(stats.edgeCount).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* KnowledgeBase - processamento                                      */
/* ------------------------------------------------------------------ */

describe('KnowledgeBase - process', () => {
  it('processa uma solicitação e retorna contexto enriquecido', () => {
    const kb = KnowledgeBase.create(defaultSeed)

    const request: KnowledgeRequest = {
      id: makeId('req:1'),
      type: KnowledgeRequestTypes.CONSULTA_CERTIFICADO,
      query: 'Maria Silva certificado e-CNPJ',
      payload: { usuarioId: makeId('seed:usuario:maria-silva') },
      originatorId: makeId('user:app'),
      timestamp: new Date().toISOString(),
    }

    const resposta = kb.process(request)

    expect(resposta.requestId).toBe(request.id)
    expect(resposta.processingTimeMs).toBeGreaterThanOrEqual(0)
    expect(resposta.cacheHit).toBe(false)
    expect(resposta.stats.nodeCount).toBeGreaterThan(0)
    expect(resposta.enrichedPayload._knowledgeBase).toBeDefined()
    expect(resposta.enrichedPayload._knowledgeBase.entityIds).toBeDefined()
  })

  it('cache hit em solicitação repetida', () => {
    const kb = KnowledgeBase.create(defaultSeed)

    const request: KnowledgeRequest = {
      id: makeId('req:cache'),
      type: KnowledgeRequestTypes.CONSULTA_PORTAL,
      query: 'e-CNPJ portal',
      payload: { portalId: makeId('seed:portal:ecnpj') },
      timestamp: new Date().toISOString(),
    }

    const primeira = kb.process(request)
    expect(primeira.cacheHit).toBe(false)

    const segunda = kb.process(request)
    // Mesmo conteúdo de payload/query → cache hit (mesmo que id seja diferente)
    expect(segunda.cacheHit).toBe(true)
  })

  it('clearCache limpa o cache', () => {
    const kb = KnowledgeBase.create(defaultSeed)

    const request: KnowledgeRequest = {
      id: makeId('req:clear'),
      type: KnowledgeRequestTypes.CONSULTA_USUARIO,
      query: 'Maria Silva',
      payload: {},
      timestamp: new Date().toISOString(),
    }

    kb.process(request)
    expect(kb.cacheSize).toBeGreaterThan(0)

    kb.clearCache()
    expect(kb.cacheSize).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Extrator de entidades                                              */
/* ------------------------------------------------------------------ */

describe('extrator de entidades', () => {
  it('extrai entidades por correspondência de label', () => {
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

    const entidades = extractEntities(kg, 'Maria Silva e-CNPJ', 10)

    expect(entidades.length).toBeGreaterThan(0)
    const labels = entidades.map((e) => e.label)
    expect(labels).toContain('Maria Silva')
    expect(labels).toContain('e-CNPJ')
  })

  it('retorna vazio para texto sem correspondência', () => {
    const kg = novoGrafo()
    kg.addNode({
      id: makeId('u:fulano'),
      type: USUARIO,
      label: 'Fulano',
      properties: {},
    })

    const entidades = extractEntities(kg, 'zzznadaquecorresponda', 10)
    expect(entidades.length).toBe(0)
  })

  it('resolveEntityIds encontra IDs existentes', () => {
    const kg = novoGrafo()
    const maria = kg.addNode({
      id: makeId('u:maria'),
      type: USUARIO,
      label: 'Maria Silva',
      properties: {},
    })

    const entidades = extractEntities(kg, 'Maria Silva', 10)
    const ids = resolveEntityIds(kg, entidades)

    expect(ids).toContain(maria.id)
  })
})

/* ------------------------------------------------------------------ */
/* Middleware                                                         */
/* ------------------------------------------------------------------ */

describe('middleware', () => {
  it('initKnowledgeBase e getKnowledgeBase retornam a mesma instância', () => {
    const kb = initKnowledgeBase(defaultSeed)
    expect(getKnowledgeBase()).toBe(kb)
  })

  it('withKnowledgeBase enriquece o payload e chama o próximo handler', async () => {
    initKnowledgeBase(defaultSeed)

    const next = vi.fn().mockResolvedValue({ sucesso: true })

    const handler = withKnowledgeBase(next)

    const request: KnowledgeRequest = {
      id: makeId('req:mw'),
      type: KnowledgeRequestTypes.ACAO_ACESSO,
      query: 'Maria acessar e-CNPJ',
      payload: { usuarioId: makeId('seed:usuario:maria-silva') },
      timestamp: new Date().toISOString(),
    }

    const resultado = await handler(request)

    expect(next).toHaveBeenCalledTimes(1)
    const requestEnriquecido = next.mock.calls[0][0]
    expect(requestEnriquecido.payload._knowledgeBase).toBeDefined()
    expect(requestEnriquecido.payload._knowledgeBase.entityIds).toBeDefined()
    expect(resultado).toEqual({ sucesso: true })
  })

  it('withKnowledgeBase com shortCircuit retorna resposta do grafo', async () => {
    initKnowledgeBase(defaultSeed)

    const next = vi.fn().mockResolvedValue({ sucesso: true })

    const handler = withKnowledgeBase(next, { shortCircuit: true })

    const request: KnowledgeRequest = {
      id: makeId('req:sc'),
      type: KnowledgeRequestTypes.CONSULTA_CERTIFICADO,
      query: 'Maria certificado',
      payload: {},
      timestamp: new Date().toISOString(),
    }

    const resultado = await handler(request)

    expect(resultado).toHaveProperty('shortCircuited', true)
    expect(resultado).toHaveProperty('knowledgeBase')
    expect(resultado.knowledgeBase.context).toBeDefined()
    expect(next).not.toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* createKnowledgeRequest                                             */
/* ------------------------------------------------------------------ */

describe('createKnowledgeRequest', () => {
  it('cria uma solicitação com id gerado automaticamente', () => {
    const req = createKnowledgeRequest({
      type: KnowledgeRequestTypes.CONSULTA_SESSAO,
      payload: { sessaoId: makeId('s:1') },
      query: 'criar sessão Maria',
    })

    expect(req.id).toBeDefined()
    expect(req.type).toBe('consulta_sessao')
    expect(req.payload.sessaoId).toBe(makeId('s:1'))
    expect(req.query).toBe('criar sessão Maria')
    expect(req.timestamp).toBeDefined()
  })
})
