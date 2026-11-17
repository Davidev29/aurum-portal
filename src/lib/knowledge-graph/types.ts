/**
 * Tipos do Grafo de Conhecimento do AurumBit Portal.
 *
 * Modela o domínio de acessos e sessões isoladas para portais públicos
 * brasileiros: usuários, certificados digitais ICP-Brasil, portais
 * governamentais, sessões, perfis de acesso e permissões.
 */

import { z } from 'zod'

/* ------------------------------------------------------------------ */
/* Identificadores                                                    */
/* ------------------------------------------------------------------ */

/** Identificador único de um nó ou aresta. */
export type Id = string & { __brand: 'Id' }

export const IdSchema = z
  .string()
  .uuid()
  .refine((v) => v.length > 0, {
    message: 'ID não pode estar vazio',
  })

export function makeId(value: string): Id {
  return value as Id
}

/* ------------------------------------------------------------------ */
/* Tipos de nó                                                        */
/* ------------------------------------------------------------------ */

export type NodeType =
  'USUARIO' | 'CERTIFICADO' | 'PORTAL' | 'SESSAO' | 'PERFIL_ACESSO' | 'PERMISSAO' | (string & {})

export const NodeTypeSchema = z.enum([
  'USUARIO',
  'CERTIFICADO',
  'PORTAL',
  'SESSAO',
  'PERFIL_ACESSO',
  'PERMISSAO',
])

export type NodeTypes = z.infer<typeof NodeTypeSchema>

/* ------------------------------------------------------------------ */
/* Tipos de relação (aresta)                                          */
/* ------------------------------------------------------------------ */

export type RelationType =
  | 'USUARIO_POSSUI_CERTIFICADO' // USUARIO -> CERTIFICADO
  | 'CERTIFICADO_VALIDO_PARA_PORTAL' // CERTIFICADO -> PORTAL
  | 'USUARIO_ACESSA_PORTAL' // USUARIO -> PORTAL
  | 'SESSAO_VINCULADA_PORTAL' // SESSAO -> PORTAL
  | 'CERTIFICADO_USADO_EM_SESSAO' // CERTIFICADO -> SESSAO
  | 'USUARIO_TEM_PERFIL' // USUARIO -> PERFIL_ACESSO
  | 'PERFIL_POSSUI_PERMISSAO' // PERFIL_ACESSO -> PERMISSAO
  | (string & {})

export const RelationTypeSchema = z.enum([
  'USUARIO_POSSUI_CERTIFICADO',
  'CERTIFICADO_VALIDO_PARA_PORTAL',
  'USUARIO_ACESSA_PORTAL',
  'SESSAO_VINCULADA_PORTAL',
  'CERTIFICADO_USADO_EM_SESSAO',
  'USUARIO_TEM_PERFIL',
  'PERFIL_POSSUI_PERMISSAO',
])

export type RelationTypes = z.infer<typeof RelationTypeSchema>

/* ------------------------------------------------------------------ */
/* Propriedades                                                       */
/* ------------------------------------------------------------------ */

/** Par chave-valor arbitrário anexado a um nó ou aresta. */
export type Properties = Record<string, unknown>

export const PropertiesSchema = z.record(z.string(), z.unknown()).optional().default({})

/* ------------------------------------------------------------------ */
/* Nó                                                                 */
/* ------------------------------------------------------------------ */

export interface Node<Type extends NodeType = NodeType> {
  id: Id
  type: Type
  label: string
  properties: Properties
  createdAt: string
  updatedAt: string
}

export const NodeSchema = z.object({
  id: IdSchema,
  type: NodeTypeSchema,
  label: z.string().min(1),
  properties: PropertiesSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type NodeInput<Type extends NodeType = NodeType> = Omit<
  Node<Type>,
  'id' | 'createdAt' | 'updatedAt'
> & { id?: Id }

/* ------------------------------------------------------------------ */
/* Aresta                                                             */
/* ------------------------------------------------------------------ */

export interface Edge<
  Type extends RelationType = RelationType,
  SourceType extends NodeType = NodeType,
  TargetType extends NodeType = NodeType,
> {
  id: Id
  type: Type
  sourceId: Id
  targetId: Id
  sourceType: SourceType
  targetType: TargetType
  label?: string
  properties: Properties
  createdAt: string
}

export const EdgeSchema = z.object({
  id: IdSchema,
  type: RelationTypeSchema,
  sourceId: IdSchema,
  targetId: IdSchema,
  sourceType: NodeTypeSchema,
  targetType: NodeTypeSchema,
  label: z.string().optional(),
  properties: PropertiesSchema,
  createdAt: z.string().datetime(),
})

export type EdgeInput<
  Type extends RelationType = RelationType,
  SourceType extends NodeType = NodeType,
  TargetType extends NodeType = NodeType,
> = Omit<Edge<Type, SourceType, TargetType>, 'id' | 'createdAt'> & {
  id?: Id
}

/* ------------------------------------------------------------------ */
/* Grafo serializado                                                  */
/* ------------------------------------------------------------------ */

export interface SerializedGraph<
  Type extends NodeType = NodeType,
  Relation extends RelationType = RelationType,
> {
  nodes: Node<Type>[]
  edges: Edge<Relation, Type, Type>[]
  exportedAt: string
}

/* ------------------------------------------------------------------ */
/* Resultado de consulta de caminho                                   */
/* ------------------------------------------------------------------ */

export interface PathStep<
  Type extends NodeType = NodeType,
  Relation extends RelationType = RelationType,
> {
  node: Node<Type>
  edge?: Edge<Relation, Type, Type>
}

export interface Path<
  Type extends NodeType = NodeType,
  Relation extends RelationType = RelationType,
> {
  nodes: Node<Type>[]
  edges: Array<Edge<Relation, Type, Type> | undefined>
  hops: number
}

/* ------------------------------------------------------------------ */
/* Estatísticas                                                       */
/* ------------------------------------------------------------------ */

export interface GraphStats {
  nodeCount: number
  edgeCount: number
  nodesByType: Record<NodeType, number>
  edgesByType: Record<RelationType, number>
}
