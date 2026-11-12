/**
 * Helpers de consulta específicos do domínio AurumBit Portal sobre o
 * Grafo de Conhecimento.
 *
 * Encapsulam os padrões mais comuns de navegação:
 *  - certificados de um usuário
 *  - portais acessíveis por um usuário
 *  - sessões de um usuário
 *  - perfis e permissões efetivas
 *  - caminho (percurso) entre um usuário e um portal
 */

import { type KnowledgeGraph, type Id } from './index'

const REL = {
  USUARIO_POSSUI_CERTIFICADO: 'USUARIO_POSSUI_CERTIFICADO' as const,
  CERTIFICADO_VALIDO_PARA_PORTAL: 'CERTIFICADO_VALIDO_PARA_PORTAL' as const,
  USUARIO_ACESSA_PORTAL: 'USUARIO_ACESSA_PORTAL' as const,
  SESSAO_VINCULADA_PORTAL: 'SESSAO_VINCULADA_PORTAL' as const,
  CERTIFICADO_USADO_EM_SESSAO: 'CERTIFICADO_USADO_EM_SESSAO' as const,
  USUARIO_TEM_PERFIL: 'USUARIO_TEM_PERFIL' as const,
  PERFIL_POSSUI_PERMISSAO: 'PERFIL_POSSUI_PERMISSAO' as const,
} as const

/* ------------------------------------------------------------------ */
/* Usuário                                                            */
/* ------------------------------------------------------------------ */

/** Certificados digitais possuídos por um usuário. */
export function certificadosDoUsuario(kg: KnowledgeGraph, usuarioId: Id) {
  return kg.getNeighbors(usuarioId, {
    direction: 'outgoing',
    relationType: REL.USUARIO_POSSUI_CERTIFICADO,
  })
}

/** Perfis de acesso de um usuário. */
export function perfisDoUsuario(kg: KnowledgeGraph, usuarioId: Id) {
  return kg.getNeighbors(usuarioId, {
    direction: 'outgoing',
    relationType: REL.USUARIO_TEM_PERFIL,
  })
}

/** Sessões em que um determinado certificado do usuário é usado. */
export function sessoesDoUsuario(kg: KnowledgeGraph, usuarioId: Id) {
  const certificados = certificadosDoUsuario(kg, usuarioId)
  const sessoesIds = new Set<Id>()
  for (const cert of certificados) {
    for (const edge of kg.getOutgoingEdges(cert.id, REL.CERTIFICADO_USADO_EM_SESSAO)) {
      sessoesIds.add(edge.targetId)
    }
  }
  return Array.from(sessoesIds)
    .map((id) => kg.getNode(id))
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Portal                                                             */
/* ------------------------------------------------------------------ */

/** Portais para os quais um usuário tem certificado válido. */
export function certificadosValidosParaPortal(kg: KnowledgeGraph, portalId: Id) {
  return kg.getNeighbors(portalId, {
    direction: 'incoming',
    relationType: REL.CERTIFICADO_VALIDO_PARA_PORTAL,
  })
}

/** Usuários que possuem ao menos um certificado válido para o portal. */
export function usuariosComAcessoAoPortal(kg: KnowledgeGraph, portalId: Id) {
  const certificados = certificadosValidosParaPortal(kg, portalId)
  const usuariosIds = new Set<Id>()
  for (const cert of certificados) {
    for (const edge of kg.getIncomingEdges(cert.id, REL.USUARIO_POSSUI_CERTIFICADO)) {
      usuariosIds.add(edge.sourceId)
    }
  }
  return Array.from(usuariosIds)
    .map((id) => kg.getNode(id))
    .filter(Boolean)
}

/** Portais diretamente acessíveis por um usuário (aresta USUARIO_ACESSA_PORTAL). */
export function portaisDoUsuario(kg: KnowledgeGraph, usuarioId: Id) {
  return kg.getNeighbors(usuarioId, {
    direction: 'outgoing',
    relationType: REL.USUARIO_ACESSA_PORTAL,
  })
}

/* ------------------------------------------------------------------ */
/* Permissões efetivas                                                */
/* ------------------------------------------------------------------ */

/** Nomes das permissões efetivas de um usuário (via perfis). */
export function permissoesEfetivasDoUsuario(kg: KnowledgeGraph, usuarioId: Id) {
  const nomes = new Set<string>()
  for (const perfil of perfisDoUsuario(kg, usuarioId)) {
    for (const edge of kg.getOutgoingEdges(perfil.id, REL.PERFIL_POSSUI_PERMISSAO)) {
      const permissao = kg.getNode(edge.targetId)
      if (permissao) nomes.add(permissao.label)
    }
  }
  return Array.from(nomes).sort()
}

/* ------------------------------------------------------------------ */
/* Conectividade e caminho                                            */
/* ------------------------------------------------------------------ */

/** Verifica se existe qualquer caminho entre dois nós. */
export function estaConectado(kg: KnowledgeGraph, sourceId: Id, targetId: Id): boolean {
  return kg.findPath(sourceId, targetId, { direction: 'both' }) !== undefined
}

/**
 * Caminho mais curto entre um usuário e um portal, navegando em ambas as
 * direções. Útil para responder "como o usuário X chega até o portal Y?".
 */
export function caminhoDeUsuarioParaPortal(kg: KnowledgeGraph, usuarioId: Id, portalId: Id) {
  return kg.findPath(usuarioId, portalId, { direction: 'both' })
}
