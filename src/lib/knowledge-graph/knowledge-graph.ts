/**
 * Núcleo do Grafo de Conhecimento do AurumBit Portal.
 *
 * Um grafo direcionado de propriedades (property graph) onde:
 *  - nós representam entidades do domínio (usuário, certificado, portal, sessão…)
 *  - arestas representam relações semânticas entre essas entidades
 *
 * Implementado em TypeScript puro, sem dependências de banco de grafo, para
 * rodar tanto no renderer (Next.js) quanto no processo main (Electron).
 */

import {
  type Id,
  type Node,
  type Edge,
  type NodeInput,
  type EdgeInput,
  type NodeType,
  type RelationType,
} from './types'

const nowISO = () => new Date().toISOString()

/**
 * Adjacency list keyed by source node id. Each entry maps a relation type to
 * the list of outgoing edges of that type.
 */
type OutgoingEdges = Map<RelationType, Edge[]>

/**
 * Adjacency list keyed by target node id. Each entry maps a relation type to
 * the list of incoming edges of that type.
 */
type IncomingEdges = Map<RelationType, Edge[]>

/**
 * KnowledgeGraph — grafo de propriedades direcionado tipado.
 *
 * Exemplos de uso (domínio AurumBit Portal):
 *
 * ```ts
 * const kg = new KnowledgeGraph()
 *
 * const usuario = kg.addNode({ type: 'USUARIO', label: 'Maria Silva', properties: { cpf: '…' } })
 * const certificado = kg.addNode({ type: 'CERTIFICADO', label: 'Certificado ICP-Brasil', properties: { serialNumber: '…' } })
 *
 * kg.addEdge({
 *   type: 'USUARIO_POSSUI_CERTIFICADO',
 *   sourceId: usuario.id,
 *   targetId: certificado.id,
 *   sourceType: 'USUARIO',
 *   targetType: 'CERTIFICADO',
 * })
 *
 * const certificadosDoUsuario = kg.getNeighbors(usuario.id, {
 *   direction: 'outgoing',
 *   relationType: 'USUARIO_POSSUI_CERTIFICADO',
 * })
 * ```
 */
export class KnowledgeGraph<
  NodeT extends NodeType = NodeType,
  RelationT extends RelationType = RelationType,
> {
  private nodes = new Map<Id, Node<NodeT>>()
  private outgoing = new Map<Id, OutgoingEdges>()
  private incoming = new Map<Id, IncomingEdges>()
  private edgeIndex = new Map<Id, Edge<RelationT, NodeT, NodeT>>()

  /* ------------------------------------------------------------------ */
  /* Nós                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Adiciona um nó ao grafo. Retorna o nó criado (com id, createdAt e
   * updatedAt preenchidos). Lança se o id já existir.
   */
  addNode(input: NodeInput<NodeT>): Node<NodeT> {
    const id = input.id ?? (crypto.randomUUID() as Id)
    if (this.nodes.has(id)) {
      throw new Error(`Nó com id "${id}" já existe no grafo`)
    }

    const node: Node<NodeT> = {
      id,
      type: input.type,
      label: input.label,
      properties: { ...input.properties },
      createdAt: nowISO(),
      updatedAt: nowISO(),
    }

    this.nodes.set(id, node)
    this.outgoing.set(id, new Map())
    this.incoming.set(id, new Map())

    return node
  }

  /** Retorna um nó pelo id, ou undefined se não existir. */
  getNode(id: Id): Node<NodeT> | undefined {
    return this.nodes.get(id)
  }

  /** Retorna todos os nós. */
  getNodes(): Node<NodeT>[] {
    return Array.from(this.nodes.values())
  }

  /** Retorna os nós de um determinado tipo. */
  getNodesByType(type: NodeT): Node<NodeT>[] {
    return this.getNodes().filter((node) => node.type === type)
  }

  /** Retorna a quantidade de nós. */
  getNodeCount(): number {
    return this.nodes.size
  }

  /**
   * Atualiza as propriedades e/ou o rótulo de um nó existente. Retorna o nó
   * atualizado. Lança se o nó não existir.
   */
  updateNode(id: Id, patch: Partial<Pick<Node<NodeT>, 'label' | 'properties'>>): Node<NodeT> {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Nó com id "${id}" não encontrado`)
    }

    const updated: Node<NodeT> = {
      ...node,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.properties !== undefined
        ? { properties: { ...node.properties, ...patch.properties } }
        : {}),
      updatedAt: nowISO(),
    }

    this.nodes.set(id, updated)
    return updated
  }

  /**
   * Remove um nó e todas as arestas incidentes (entrada e saída).
   * Retorna true se removeu algo, false se o nó não existia.
   */
  removeNode(id: Id): boolean {
    if (!this.nodes.has(id)) {
      return false
    }

    // Remove arestas de saída deste nó (e a entrada correspondente no destino).
    const out = this.outgoing.get(id)
    if (out) {
      for (const edges of out.values()) {
        for (const edge of edges) {
          const targetInc = this.incoming.get(edge.targetId)?.get(edge.type)
          if (targetInc) {
            const idx = targetInc.findIndex((e) => e.id === edge.id)
            if (idx !== -1) targetInc.splice(idx, 1)
          }
          this.edgeIndex.delete(edge.id)
        }
      }
      out.clear()
    }

    // Remove arestas de entrada deste nó (e a saída correspondente na origem).
    const inc = this.incoming.get(id)
    if (inc) {
      for (const edges of inc.values()) {
        for (const edge of edges) {
          const sourceOut = this.outgoing.get(edge.sourceId)?.get(edge.type)
          if (sourceOut) {
            const idx = sourceOut.findIndex((e) => e.id === edge.id)
            if (idx !== -1) sourceOut.splice(idx, 1)
          }
          this.edgeIndex.delete(edge.id)
        }
      }
      inc.clear()
    }

    this.nodes.delete(id)
    this.outgoing.delete(id)
    this.incoming.delete(id)

    return true
  }

  /* ------------------------------------------------------------------ */
  /* Arestas                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Adiciona uma aresta dirigida entre dois nós. Os nós origem e destino
   * devem existir. Retorna a aresta criada. Lança se algum nó não existir
   * ou se a aresta já existir (mesmo id).
   */
  addEdge<SourceType extends NodeT = NodeT, TargetType extends NodeT = NodeT>(
    input: EdgeInput<RelationT, SourceType, TargetType>,
  ): Edge<RelationT, SourceType, TargetType> {
    const id = input.id ?? (crypto.randomUUID() as Id)
    if (this.edgeIndex.has(id)) {
      throw new Error(`Aresta com id "${id}" já existe no grafo`)
    }

    const source = this.nodes.get(input.sourceId)
    const target = this.nodes.get(input.targetId)
    if (!source) {
      throw new Error(`Nó de origem "${input.sourceId}" não encontrado`)
    }
    if (!target) {
      throw new Error(`Nó de destino "${input.targetId}" não encontrado`)
    }

    const edge: Edge<RelationT, SourceType, TargetType> = {
      id,
      type: input.type,
      sourceId: input.sourceId,
      targetId: input.targetId,
      sourceType: input.sourceType as SourceType,
      targetType: input.targetType as TargetType,
      ...(input.label !== undefined ? { label: input.label } : {}),
      properties: { ...input.properties },
      createdAt: nowISO(),
    }

    this.edgeIndex.set(id, edge as Edge<RelationT, NodeT, NodeT>)

    const outMap = this.outgoing.get(input.sourceId)
    if (!outMap) {
      throw new Error(`Lista de adjacência de saída ausente para "${input.sourceId}"`)
    }
    const outByType = outMap.get(input.type) ?? []
    outByType.push(edge as Edge)
    outMap.set(input.type, outByType)

    const incMap = this.incoming.get(input.targetId)
    if (!incMap) {
      throw new Error(`Lista de adjacência de entrada ausente para "${input.targetId}"`)
    }
    const incByType = incMap.get(input.type) ?? []
    incByType.push(edge as Edge)
    incMap.set(input.type, incByType)

    return edge
  }

  /** Retorna uma aresta pelo id, ou undefined se não existir. */
  getEdge(id: Id): Edge<RelationT, NodeT, NodeT> | undefined {
    return this.edgeIndex.get(id)
  }

  /** Retorna todas as arestas. */
  getEdges(): Edge<RelationT, NodeT, NodeT>[] {
    return Array.from(this.edgeIndex.values())
  }

  /** Retorna a quantidade de arestas. */
  getEdgeCount(): number {
    return this.edgeIndex.size
  }

  /**
   * Remove uma aresta pelo id. Retorna true se removeu, false se não existia.
   */
  removeEdge(id: Id): boolean {
    const edge = this.edgeIndex.get(id)
    if (!edge) {
      return false
    }

    const outMap = this.outgoing.get(edge.sourceId)
    const outByType = outMap?.get(edge.type)
    if (outMap && outByType) {
      const idx = outByType.findIndex((e) => e.id === id)
      if (idx !== -1) outByType.splice(idx, 1)
      outMap.set(edge.type, outByType)
    }

    const incMap = this.incoming.get(edge.targetId)
    const incByType = incMap?.get(edge.type)
    if (incMap && incByType) {
      const idx = incByType.findIndex((e) => e.id === id)
      if (idx !== -1) incByType.splice(idx, 1)
      incMap.set(edge.type, incByType)
    }

    this.edgeIndex.delete(id)
    return true
  }

  /* ------------------------------------------------------------------ */
  /* Consultas de vizinhança                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Retorna os nós vizinhos de um nó, com opção de filtrar por direção e/ou
   * tipo de relação.
   *
   * @param direction - 'outgoing' (arestas saindo do nó), 'incoming' (arestas
   *   entrando no nó) ou 'both' (padrão).
   * @param relationType - se informado, retorna apenas vizinhos ligados por
   *   esse tipo de relação.
   */
  getNeighbors(
    id: Id,
    options?: {
      direction?: 'outgoing' | 'incoming' | 'both'
      relationType?: RelationT
    },
  ): Node<NodeT>[] {
    const node = this.nodes.get(id)
    if (!node) return []

    const direction = options?.direction ?? 'both'
    const relationType = options?.relationType

    const neighborIds = new Set<Id>()

    const collect = (edges: Edge[]) => {
      for (const edge of edges) {
        if (relationType && edge.type !== relationType) continue
        neighborIds.add(direction === 'incoming' ? edge.sourceId : edge.targetId)
      }
    }

    if (direction === 'outgoing' || direction === 'both') {
      const outMap = this.outgoing.get(id)
      if (outMap) {
        for (const [type, edges] of outMap) {
          if (relationType && type !== relationType) continue
          collect(edges)
        }
      }
    }
    if (direction === 'incoming' || direction === 'both') {
      const incMap = this.incoming.get(id)
      if (incMap) {
        for (const [type, edges] of incMap) {
          if (relationType && type !== relationType) continue
          collect(edges)
        }
      }
    }

    // Remove o próprio nó caso haja auto-referência.
    neighborIds.delete(id)

    return Array.from(neighborIds)
      .map((nid) => this.nodes.get(nid))
      .filter(Boolean) as Node<NodeT>[]
  }

  /**
   * Retorna as arestas de saída de um nó, opcionalmente filtradas por tipo.
   */
  getOutgoingEdges(id: Id, relationType?: RelationT): Edge<RelationT, NodeT, NodeT>[] {
    const outMap = this.outgoing.get(id)
    if (!outMap) return []
    const edges: Edge<RelationT, NodeT, NodeT>[] = []
    for (const [type, list] of outMap) {
      if (relationType && type !== relationType) continue
      edges.push(...(list as Edge<RelationT, NodeT, NodeT>[]))
    }
    return edges
  }

  /**
   * Retorna as arestas de entrada de um nó, opcionalmente filtradas por tipo.
   */
  getIncomingEdges(id: Id, relationType?: RelationT): Edge<RelationT, NodeT, NodeT>[] {
    const incMap = this.incoming.get(id)
    if (!incMap) return []
    const edges: Edge<RelationT, NodeT, NodeT>[] = []
    for (const [type, list] of incMap) {
      if (relationType && type !== relationType) continue
      edges.push(...(list as Edge<RelationT, NodeT, NodeT>[]))
    }
    return edges
  }

  /* ------------------------------------------------------------------ */
  /* Busca de caminho (BFS)                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Encontra o caminho mais curto (em número de saltos) entre dois nós
   * usando BFS. Direção padrão: 'outgoing'. Retorna undefined se não houver
   * caminho.
   */
  findPath(
    sourceId: Id,
    targetId: Id,
    options?: { direction?: 'outgoing' | 'incoming' | 'both' },
  ):
    | {
        nodes: Node<NodeT>[]
        edges: Array<Edge<RelationT, NodeT, NodeT> | undefined>
        hops: number
      }
    | undefined {
    const direction = options?.direction ?? 'both'
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return undefined
    if (sourceId === targetId) {
      return {
        nodes: [this.nodes.get(sourceId)!],
        edges: [undefined],
        hops: 0,
      }
    }

    const visited = new Set<Id>([sourceId])
    // queue: [currentId, pathNodes, pathEdges]
    const queue: Array<[Id, Node<NodeT>[], Array<Edge<RelationT, NodeT, NodeT> | undefined>]> = [
      [sourceId, [this.nodes.get(sourceId)!], [undefined]],
    ]

    while (queue.length > 0) {
      const [current, pathNodes, pathEdges] = queue.shift()!

      const neighborEdges =
        direction === 'incoming' || direction === 'both' ? this.getIncomingEdges(current) : []
      const outEdges =
        direction === 'outgoing' || direction === 'both' ? this.getOutgoingEdges(current) : []

      const candidates = [...neighborEdges, ...outEdges]
      for (const edge of candidates) {
        const neighborId = direction === 'incoming' ? edge.sourceId : edge.targetId
        if (visited.has(neighborId)) continue
        visited.add(neighborId)

        const neighbor = this.nodes.get(neighborId)
        if (!neighbor) continue

        const newNodes = [...pathNodes, neighbor]
        const newEdges = [...pathEdges, edge]

        if (neighborId === targetId) {
          return {
            nodes: newNodes,
            edges: newEdges as Array<Edge<RelationT, NodeT, NodeT> | undefined>,
            hops: newEdges.filter(Boolean).length,
          }
        }

        queue.push([
          neighborId,
          newNodes,
          newEdges as Array<Edge<RelationT, NodeT, NodeT> | undefined>,
        ])
      }
    }

    return undefined
  }

  /* ------------------------------------------------------------------ */
  /* Estatísticas                                                       */
  /* ------------------------------------------------------------------ */

  /** Estatísticas resumidas do grafo. */
  getStats(): {
    nodeCount: number
    edgeCount: number
    nodesByType: Record<NodeT, number>
    edgesByType: Record<RelationT, number>
  } {
    const nodesByType: Record<NodeT, number> = {} as Record<NodeT, number>
    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1
    }

    const edgesByType: Record<RelationT, number> = {} as Record<RelationT, number>
    for (const edge of this.edgeIndex.values()) {
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edgeIndex.size,
      nodesByType,
      edgesByType,
    }
  }

  /* ------------------------------------------------------------------ */
  /* Serialização                                                       */
  /* ------------------------------------------------------------------ */

  /** Exporta o grafo para um objeto serializável (JSON-safe). */
  toJSON(): {
    nodes: Node<NodeT>[]
    edges: Edge<RelationT, NodeT, NodeT>[]
    exportedAt: string
  } {
    return {
      nodes: this.getNodes(),
      edges: this.getEdges(),
      exportedAt: nowISO(),
    }
  }

  /**
   * Carrega um grafo a partir de um objeto serializado. Substitui o conteúdo
   * atual. Retorna a própria instância (encadeável).
   */
  fromJSON(data: { nodes: Node<NodeT>[]; edges: Edge<RelationT, NodeT, NodeT>[] }): this {
    this.nodes.clear()
    this.outgoing.clear()
    this.incoming.clear()
    this.edgeIndex.clear()

    for (const node of data.nodes) {
      this.nodes.set(node.id, node)
      this.outgoing.set(node.id, new Map())
      this.incoming.set(node.id, new Map())
    }

    for (const edge of data.edges) {
      this.edgeIndex.set(edge.id, edge)

      const outMap = this.outgoing.get(edge.sourceId)
      if (outMap) {
        const list = outMap.get(edge.type) ?? []
        list.push(edge)
        outMap.set(edge.type, list)
      }

      const incMap = this.incoming.get(edge.targetId)
      if (incMap) {
        const list = incMap.get(edge.type) ?? []
        list.push(edge)
        incMap.set(edge.type, list)
      }
    }

    return this
  }

  /** Limpa todo o grafo. */
  clear(): void {
    this.nodes.clear()
    this.outgoing.clear()
    this.incoming.clear()
    this.edgeIndex.clear()
  }
}
