/**
 * Testes unitários do Grafo de Conhecimento do AurumBit Portal.
 *
 * Cobrem: nós, arestas, vizinhança, busca de caminho (BFS), atualização,
 * remoção, serialização e a integridade dos dados de semente.
 */

import { describe, it, expect } from 'vitest'
import {
  KnowledgeGraph,
  makeId,
  seedKnowledgeGraph,
  defaultSeed,
  certificadosDoUsuario,
  portaisDoUsuario,
  usuariosComAcessoAoPortal,
  caminhoDeUsuarioParaPortal,
  estaConectado,
  permissoesEfetivasDoUsuario,
} from '@/lib/knowledge-graph'

const USUARIO = 'USUARIO' as const
const CERTIFICADO = 'CERTIFICADO' as const
const PORTAL = 'PORTAL' as const
const SESSAO = 'SESSAO' as const

const POSSUI = 'USUARIO_POSSUI_CERTIFICADO' as const
const VALIDO_PARA = 'CERTIFICADO_VALIDO_PARA_PORTAL' as const

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function novoGrafo() {
  return new KnowledgeGraph()
}

function usuario(id = makeId('u:1')) {
  return {
    id,
    type: USUARIO,
    label: 'Usuário Teste',
    properties: { cpf: '111.222.333-44' },
  }
}

function certificado(id = makeId('c:1')) {
  return {
    id,
    type: CERTIFICADO,
    label: 'Certificado Teste',
    properties: { serialNumber: 'ABC123' },
  }
}

function portal(id = makeId('p:1')) {
  return {
    id,
    type: PORTAL,
    label: 'Portal Teste',
    properties: { url: 'https://exemplo.gov.br' },
  }
}

/* ------------------------------------------------------------------ */
/* Nós                                                                */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - nós', () => {
  it('adiciona e recupera um nó', () => {
    const kg = novoGrafo()
    const u = usuario()
    const criado = kg.addNode(u)

    expect(criado.id).toBe(u.id)
    expect(criado.createdAt).toBeDefined()
    expect(criado.updatedAt).toBeDefined()

    const recuperado = kg.getNode(u.id)
    expect(recuperado).toEqual(criado)
  })

  it('getNode retorna undefined para id inexistente', () => {
    const kg = novoGrafo()
    expect(kg.getNode(makeId('nao-existe'))).toBeUndefined()
  })

  it('getNodes e getNodeCount', () => {
    const kg = novoGrafo()
    expect(kg.getNodeCount()).toBe(0)
    expect(kg.getNodes()).toEqual([])

    kg.addNode(usuario(makeId('u:1')))
    kg.addNode(usuario(makeId('u:2')))
    expect(kg.getNodeCount()).toBe(2)
    expect(kg.getNodes().length).toBe(2)
  })

  it('getNodesByType filtra por tipo', () => {
    const kg = novoGrafo()
    kg.addNode(usuario(makeId('u:1')))
    kg.addNode(certificado(makeId('c:1')))
    kg.addNode(portal(makeId('p:1')))

    expect(kg.getNodesByType(USUARIO).length).toBe(1)
    expect(kg.getNodesByType(CERTIFICADO).length).toBe(1)
    expect(kg.getNodesByType(PORTAL).length).toBe(1)
    expect(kg.getNodesByType(SESSAO).length).toBe(0)
  })

  it('lança ao adicionar nó com id duplicado', () => {
    const kg = novoGrafo()
    const id = makeId('u:dup')
    kg.addNode(usuario(id))
    expect(() => kg.addNode(usuario(id))).toThrow(/já existe/)
  })

  it('updateNode altera rótulo e propriedades', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())

    const atualizado = kg.updateNode(u.id, {
      label: 'Novo Nome',
      properties: { cpf: '999.888.777-66' },
    })

    expect(atualizado.label).toBe('Novo Nome')
    expect(atualizado.properties.cpf).toBe('999.888.777-66')
    expect(atualizado.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('updateNode lança para nó inexistente', () => {
    const kg = novoGrafo()
    expect(() => kg.updateNode(makeId('inexistente'), { label: 'x' })).toThrow(/não encontrado/)
  })
})

/* ------------------------------------------------------------------ */
/* Arestas                                                            */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - arestas', () => {
  it('adiciona e recupera uma aresta', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())
    const c = kg.addNode(certificado())

    const aresta = kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      label: 'possui',
      properties: { desde: '2025-01-01' },
    })

    expect(aresta.sourceId).toBe(u.id)
    expect(aresta.targetId).toBe(c.id)
    expect(aresta.label).toBe('possui')
    expect(kg.getEdge(aresta.id)).toEqual(aresta)
    expect(kg.getEdgeCount()).toBe(1)
  })

  it('getEdges retorna todas as arestas', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())
    const c1 = kg.addNode(certificado(makeId('c:1')))
    const c2 = kg.addNode(certificado(makeId('c:2')))

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c1.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })
    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c2.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })

    expect(kg.getEdges().length).toBe(2)
    expect(kg.getEdgeCount()).toBe(2)
  })

  it('lança ao adicionar aresta com nó de origem inexistente', () => {
    const kg = novoGrafo()
    const c = kg.addNode(certificado())
    expect(() =>
      kg.addEdge({
        type: POSSUI,
        sourceId: makeId('nao-existe'),
        targetId: c.id,
        sourceType: USUARIO,
        targetType: CERTIFICADO,
        properties: {},
      }),
    ).toThrow(/não encontrado/)
  })

  it('removeEdge remove a aresta e atualiza adjacência', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())
    const c = kg.addNode(certificado())

    const aresta = kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })

    expect(kg.getOutgoingEdges(u.id).length).toBe(1)
    expect(kg.getIncomingEdges(c.id).length).toBe(1)

    const removeu = kg.removeEdge(aresta.id)
    expect(removeu).toBe(true)
    expect(kg.getEdge(aresta.id)).toBeUndefined()
    expect(kg.getOutgoingEdges(u.id).length).toBe(0)
    expect(kg.getIncomingEdges(c.id).length).toBe(0)
    expect(kg.getEdgeCount()).toBe(0)
  })

  it('removeEdge retorna false para id inexistente', () => {
    const kg = novoGrafo()
    expect(kg.removeEdge(makeId('nao-existe'))).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Vizinhança                                                         */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - vizinhança', () => {
  it('getNeighbors retorna vizinhos de saída filtrados por relação', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())
    const c1 = kg.addNode(certificado(makeId('c:1')))
    const c2 = kg.addNode(certificado(makeId('c:2')))
    const p = kg.addNode(portal())

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c1.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })
    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c2.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })
    kg.addEdge({
      type: VALIDO_PARA,
      sourceId: c1.id,
      targetId: p.id,
      sourceType: CERTIFICADO,
      targetType: PORTAL,
      properties: {},
    })

    const possuir = kg.getNeighbors(u.id, {
      direction: 'outgoing',
      relationType: POSSUI,
    })
    expect(possuir.map((n) => n.id).sort()).toEqual([c1.id, c2.id].sort())

    // Sem filtro de relação: inclui o portal via certificado? Não — u só tem
    // arestas para c1 e c2; o portal é vizinho de c1, não de u.
    const todos = kg.getNeighbors(u.id, { direction: 'outgoing' })
    expect(todos.map((n) => n.id).sort()).toEqual([c1.id, c2.id].sort())
  })

  it('getNeighbors direção incoming', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())
    const c = kg.addNode(certificado())

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })

    const entradas = kg.getIncomingEdges(c.id, POSSUI)
    expect(entradas.length).toBe(1)
    expect(entradas[0].sourceId).toBe(u.id)

    const saidas = kg.getOutgoingEdges(u.id, POSSUI)
    expect(saidas.length).toBe(1)
    expect(saidas[0].targetId).toBe(c.id)
  })

  it('getNeighbors não inclui o próprio nó (auto-referência removida)', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: u.id,
      sourceType: USUARIO,
      targetType: USUARIO,
      properties: {},
    })

    expect(kg.getNeighbors(u.id, { direction: 'both' }).length).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Busca de caminho (BFS)                                             */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - findPath', () => {
  it('encontra o caminho mais curto entre dois nós', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario(makeId('u:1')))
    const c = kg.addNode(certificado(makeId('c:1')))
    const p = kg.addNode(portal(makeId('p:1')))

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

    const caminho = kg.findPath(u.id, p.id, { direction: 'both' })
    expect(caminho).toBeDefined()
    expect(caminho!.hops).toBe(2)
    expect(caminho!.nodes.map((n) => n.id)).toEqual([u.id, c.id, p.id])
    expect(caminho!.edges.length).toBe(3) // inclui undefined no índice 0
  })

  it('retorna undefined quando não há caminho', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario(makeId('u:1')))
    const p = kg.addNode(portal(makeId('p:1')))

    expect(kg.findPath(u.id, p.id)).toBeUndefined()
  })

  it('caminho de um nó para ele mesmo tem 0 saltos', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())

    const caminho = kg.findPath(u.id, u.id)
    expect(caminho).toBeDefined()
    expect(caminho!.hops).toBe(0)
    expect(caminho!.nodes.length).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Remoção de nó                                                      */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - removeNode', () => {
  it('remove o nó e todas as arestas incidentes', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario())
    const c1 = kg.addNode(certificado(makeId('c:1')))
    const c2 = kg.addNode(certificado(makeId('c:2')))

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c1.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })
    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c2.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: {},
    })

    expect(kg.getEdgeCount()).toBe(2)

    const removeu = kg.removeNode(u.id)
    expect(removeu).toBe(true)
    expect(kg.getNode(u.id)).toBeUndefined()
    expect(kg.getEdgeCount()).toBe(0) // arestas incidentes removidas
    expect(kg.getNodeCount()).toBe(2) // c1 e c2 permanecem
  })

  it('removeNode retorna false para id inexistente', () => {
    const kg = novoGrafo()
    expect(kg.removeNode(makeId('inexistente'))).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Serialização                                                       */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - serialização', () => {
  it('toJSON / fromJSON é um round-trip fiel', () => {
    const kg = novoGrafo()
    const u = kg.addNode(usuario(makeId('u:1')))
    const c = kg.addNode(certificado(makeId('c:1')))
    const p = kg.addNode(portal(makeId('p:1')))

    kg.addEdge({
      type: POSSUI,
      sourceId: u.id,
      targetId: c.id,
      sourceType: USUARIO,
      targetType: CERTIFICADO,
      properties: { desde: '2025-01-01' },
    })
    kg.addEdge({
      type: VALIDO_PARA,
      sourceId: c.id,
      targetId: p.id,
      sourceType: CERTIFICADO,
      targetType: PORTAL,
      properties: {},
    })

    const json = kg.toJSON()
    expect(json.nodes.length).toBe(3)
    expect(json.edges.length).toBe(2)

    const kg2 = novoGrafo()
    kg2.fromJSON(json)

    expect(kg2.getNodeCount()).toBe(3)
    expect(kg2.getEdgeCount()).toBe(2)
    expect(kg2.getNode(u.id)?.label).toBe(u.label)
    const aresta = kg2.getEdges()[0]
    expect(aresta?.properties.desde).toBe('2025-01-01')
    expect(kg2.findPath(u.id, p.id, { direction: 'both' })?.hops).toBe(2)
  })

  it('fromJSON substitui o conteúdo atual', () => {
    const kg = novoGrafo()
    kg.addNode(usuario(makeId('u:1')))
    expect(kg.getNodeCount()).toBe(1)

    kg.fromJSON({ nodes: [], edges: [] })
    expect(kg.getNodeCount()).toBe(0)
    expect(kg.getEdgeCount()).toBe(0)
  })

  it('clear esvazia o grafo', () => {
    const kg = novoGrafo()
    kg.addNode(usuario())
    kg.addNode(certificado())
    kg.clear()
    expect(kg.getNodeCount()).toBe(0)
    expect(kg.getEdgeCount()).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Estatísticas                                                       */
/* ------------------------------------------------------------------ */

describe('KnowledgeGraph - getStats', () => {
  it('retorna contagens por tipo', () => {
    const kg = novoGrafo()
    kg.addNode(usuario(makeId('u:1')))
    kg.addNode(usuario(makeId('u:2')))
    kg.addNode(certificado(makeId('c:1')))
    kg.addNode(portal(makeId('p:1')))

    const stats = kg.getStats()
    expect(stats.nodeCount).toBe(4)
    expect(stats.nodesByType.USUARIO).toBe(2)
    expect(stats.nodesByType.CERTIFICADO).toBe(1)
    expect(stats.nodesByType.PORTAL).toBe(1)
    expect(stats.edgeCount).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Semente do domínio AurumBit Portal                                    */
/* ------------------------------------------------------------------ */

describe('seedKnowledgeGraph / defaultSeed', () => {
  it('popula o grafo com entidades e relações do domínio', () => {
    const kg = seedKnowledgeGraph(novoGrafo())

    expect(kg.getNodeCount()).toBeGreaterThan(0)
    expect(kg.getEdgeCount()).toBeGreaterThan(0)

    const stats = kg.getStats()
    expect(stats.nodesByType.USUARIO).toBe(3)
    expect(stats.nodesByType.CERTIFICADO).toBe(3)
    expect(stats.nodesByType.PORTAL).toBe(4)
    expect(stats.nodesByType.SESSAO).toBe(2)
    expect(stats.nodesByType.PERFIL_ACESSO).toBe(3)
    expect(stats.nodesByType.PERMISSAO).toBe(4)
  })

  it('defaultSeed é uma instância pronta para uso', () => {
    expect(defaultSeed.getNodeCount()).toBeGreaterThan(0)
    expect(defaultSeed.getEdgeCount()).toBeGreaterThan(0)
  })

  it('certificadosDoUsuario lista os certificados do usuário', () => {
    const kg = defaultSeed
    const maria = makeId('seed:usuario:maria-silva')
    const certs = certificadosDoUsuario(kg, maria)
    expect(certs.length).toBe(1)
    expect(certs[0]?.type).toBe('CERTIFICADO')
  })

  it('portaisDoUsuario lista portais acessíveis pelo usuário', () => {
    const kg = defaultSeed
    const maria = makeId('seed:usuario:maria-silva')
    const portais = portaisDoUsuario(kg, maria)
    expect(portais.some((p) => p.label === 'e-CNPJ')).toBe(true)
  })

  it('usuariosComAcessoAoPortal encontra usuários com certificado válido', () => {
    const kg = defaultSeed
    const ecnpj = makeId('seed:portal:ecnpj')
    const usuarios = usuariosComAcessoAoPortal(kg, ecnpj)
    expect(usuarios.some((u) => u.label === 'Maria Silva')).toBe(true)
    expect(usuarios.some((u) => u.label === 'Ana Costa')).toBe(true)
  })

  it('caminhoDeUsuarioParaPortal encontra percurso usuário → portal', () => {
    const kg = defaultSeed
    const maria = makeId('seed:usuario:maria-silva')
    const ecnpj = makeId('seed:portal:ecnpj')
    const caminho = caminhoDeUsuarioParaPortal(kg, maria, ecnpj)

    expect(caminho).toBeDefined()
    expect(caminho!.nodes[0]?.id).toBe(maria)
    expect(caminho!.nodes[caminho!.nodes.length - 1]?.id).toBe(ecnpj)
  })

  it('estaConectado retorna true/false corretamente', () => {
    const kg = defaultSeed
    const maria = makeId('seed:usuario:maria-silva')
    const joao = makeId('seed:usuario:joao-santos')
    const ecnpj = makeId('seed:portal:ecnpj')

    expect(estaConectado(kg, maria, ecnpj)).toBe(true)
    // Maria e João não compartilham nós/arestas entre si no grafo de semente
    expect(estaConectado(kg, maria, joao)).toBe(false)
  })

  it('permissoesEfetivasDoUsuario agrega permissões dos perfis', () => {
    const kg = defaultSeed
    const maria = makeId('seed:usuario:maria-silva') // perfil: gestor
    const perms = permissoesEfetivasDoUsuario(kg, maria)
    expect(perms).toContain('Ler')
    expect(perms).toContain('Escrever')
    expect(perms).toContain('Assinar digitalmente')
    expect(perms).toContain('Exportar')

    const joao = makeId('seed:usuario:joao-santos') // perfil: consultor
    const permsJoao = permissoesEfetivasDoUsuario(kg, joao)
    expect(permsJoao).toEqual(['Ler'])
  })
})
