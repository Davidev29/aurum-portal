/**
 * Dados de semente do Grafo de Conhecimento do AurumBit Portal.
 *
 * Popula o grafo com entidades realistas do domínio:
 *  - Usuários (CPF, e-mail, tipo)
 *  - Certificados digitais ICP-Brasil (serial, emissor, validade, tipo)
 *  - Portais governamentais (URL, tipo, UF)
 *  - Sessões isoladas vinculadas a portais
 *  - Perfis de acesso e permissões
 *
 * Relações modeladas:
 *  USUARIO_POSSUI_CERTIFICADO, CERTIFICADO_VALIDO_PARA_PORTAL,
 *  USUARIO_ACESSA_PORTAL, SESSAO_VINCULADA_PORTAL,
 *  CERTIFICADO_USADO_EM_SESSAO, USUARIO_TEM_PERFIL,
 *  PERFIL_POSSUI_PERMISSAO
 */

import { KnowledgeGraph, type Id, makeId } from './index'

/** Identificadores fixos e reproduzíveis das entidades de semente. */
export const SEED_IDS = {
  usuarios: {
    maria: makeId('seed:usuario:maria-silva'),
    joao: makeId('seed:usuario:joao-santos'),
    ana: makeId('seed:usuario:ana-costa'),
  },
  certificados: {
    mariaEcnpj: makeId('seed:certificado:maria-ecnpj'),
    joaoEcpf: makeId('seed:certificado:joao-ecpf'),
    anaEcnpj: makeId('seed:certificado:ana-ecnpj'),
  },
  portais: {
    ecnpj: makeId('seed:portal:ecnpj'),
    receita: makeId('seed:portal:receita'),
    govbr: makeId('seed:portal:govbr'),
    serpro: makeId('seed:portal:serpro'),
  },
  sessoes: {
    mariaEcNpjSessao: makeId('seed:sessao:maria-ecnpj-2026'),
    joaoGovBrSessao: makeId('seed:sessao:joao-govbr-2026'),
  },
  perfis: {
    gestor: makeId('seed:perfil:gestor'),
    consultor: makeId('seed:perfil:consultor'),
    auditor: makeId('seed:perfil:auditor'),
  },
  permissoes: {
    ler: makeId('seed:permissao:ler'),
    escrever: makeId('seed:permissao:escrever'),
    assinar: makeId('seed:permissao:assinar'),
    exportar: makeId('seed:permissao:exportar'),
  },
} as const

/**
 * Popula o grafo com os dados de semente e retorna a própria instância.
 */
export function seedKnowledgeGraph(kg: KnowledgeGraph): KnowledgeGraph {
  const ids = SEED_IDS

  /* -------- Nós: Usuários -------- */
  kg.addNode({
    id: ids.usuarios.maria,
    type: 'USUARIO',
    label: 'Maria Silva',
    properties: {
      cpf: '111.222.333-44',
      email: 'maria.silva@empresa.com.br',
      tipo: 'funcionario',
      ativo: true,
    },
  })
  kg.addNode({
    id: ids.usuarios.joao,
    type: 'USUARIO',
    label: 'João Santos',
    properties: {
      cpf: '555.666.777-88',
      email: 'joao.santos@empresa.com.br',
      tipo: 'terceirizado',
      ativo: true,
    },
  })
  kg.addNode({
    id: ids.usuarios.ana,
    type: 'USUARIO',
    label: 'Ana Costa',
    properties: {
      cpf: '999.000.111-22',
      email: 'ana.costa@empresa.com.br',
      tipo: 'gestor',
      ativo: true,
    },
  })

  /* -------- Nós: Certificados ICP-Brasil -------- */
  kg.addNode({
    id: ids.certificados.mariaEcnpj,
    type: 'CERTIFICADO',
    label: 'e-CNPJ Maria Silva',
    properties: {
      serialNumber: '12F3A4B5C6D7E8F9',
      emissor: 'ICP-Brasil - Certisign',
      tipo: 'e-CNPJ',
      validade: '2027-06-15T00:00:00Z',
      status: 'valido',
    },
  })
  kg.addNode({
    id: ids.certificados.joaoEcpf,
    type: 'CERTIFICADO',
    label: 'e-CPF João Santos',
    properties: {
      serialNumber: 'A1B2C3D4E5F60718',
      emissor: 'ICP-Brasil - SafeNet',
      tipo: 'e-CPF',
      validade: '2026-11-30T00:00:00Z',
      status: 'valido',
    },
  })
  kg.addNode({
    id: ids.certificados.anaEcnpj,
    type: 'CERTIFICADO',
    label: 'e-CNPJ Ana Costa',
    properties: {
      serialNumber: '9Z8Y7X6W5V4U3T2S',
      emissor: 'ICP-Brasil - ePKI',
      tipo: 'e-CNPJ',
      validade: '2028-01-10T00:00:00Z',
      status: 'valido',
    },
  })

  /* -------- Nós: Portais Governamentais -------- */
  kg.addNode({
    id: ids.portais.ecnpj,
    type: 'PORTAL',
    label: 'e-CNPJ',
    properties: {
      url: 'https://ecnpj.receita.fazenda.gov.br',
      tipo: 'federal',
      uf: 'DF',
      responsavel: 'Receita Federal',
    },
  })
  kg.addNode({
    id: ids.portais.receita,
    type: 'PORTAL',
    label: 'Receita Federal - eCAC',
    properties: {
      url: 'https://ecac.receita.fazenda.gov.br',
      tipo: 'federal',
      uf: 'DF',
      responsavel: 'Receita Federal',
    },
  })
  kg.addNode({
    id: ids.portais.govbr,
    type: 'PORTAL',
    label: 'gov.br',
    properties: {
      url: 'https://www.gov.br',
      tipo: 'federal',
      uf: 'DF',
      responsavel: 'Secretaria de Governo Digital',
    },
  })
  kg.addNode({
    id: ids.portais.serpro,
    type: 'PORTAL',
    label: 'SERPRO',
    properties: {
      url: 'https://portal.serpro.gov.br',
      tipo: 'federal',
      uf: 'DF',
      responsavel: 'SERPRO',
    },
  })

  /* -------- Nós: Sessões -------- */
  kg.addNode({
    id: ids.sessoes.mariaEcNpjSessao,
    type: 'SESSAO',
    label: 'Sessão Maria → e-CNPJ',
    properties: {
      dataInicio: '2026-11-10T08:00:00-03:00',
      status: 'ativa',
      isolamento: 'sessao-particionada',
    },
  })
  kg.addNode({
    id: ids.sessoes.joaoGovBrSessao,
    type: 'SESSAO',
    label: 'Sessão João → gov.br',
    properties: {
      dataInicio: '2026-11-10T09:15:00-03:00',
      status: 'ativa',
      isolamento: 'sessao-particionada',
    },
  })

  /* -------- Nós: Perfis de Acesso -------- */
  kg.addNode({
    id: ids.perfis.gestor,
    type: 'PERFIL_ACESSO',
    label: 'Gestor',
    properties: { descricao: 'Acesso completo a relatórios e assinaturas' },
  })
  kg.addNode({
    id: ids.perfis.consultor,
    type: 'PERFIL_ACESSO',
    label: 'Consultor',
    properties: { descricao: 'Leitura e consulta de dados' },
  })
  kg.addNode({
    id: ids.perfis.auditor,
    type: 'PERFIL_ACESSO',
    label: 'Auditor',
    properties: { descricao: 'Leitura e exportação de logs de auditoria' },
  })

  /* -------- Nós: Permissões -------- */
  kg.addNode({
    id: ids.permissoes.ler,
    type: 'PERMISSAO',
    label: 'Ler',
    properties: { acao: 'read' },
  })
  kg.addNode({
    id: ids.permissoes.escrever,
    type: 'PERMISSAO',
    label: 'Escrever',
    properties: { acao: 'write' },
  })
  kg.addNode({
    id: ids.permissoes.assinar,
    type: 'PERMISSAO',
    label: 'Assinar digitalmente',
    properties: { acao: 'sign' },
  })
  kg.addNode({
    id: ids.permissoes.exportar,
    type: 'PERMISSAO',
    label: 'Exportar',
    properties: { acao: 'export' },
  })

  /* -------- Arestas: Usuário possui Certificado -------- */
  kg.addEdge({
    type: 'USUARIO_POSSUI_CERTIFICADO',
    sourceId: ids.usuarios.maria,
    targetId: ids.certificados.mariaEcnpj,
    sourceType: 'USUARIO',
    targetType: 'CERTIFICADO',
    label: 'possui',
    properties: { desde: '2025-03-10', principal: true },
  })
  kg.addEdge({
    type: 'USUARIO_POSSUI_CERTIFICADO',
    sourceId: ids.usuarios.joao,
    targetId: ids.certificados.joaoEcpf,
    sourceType: 'USUARIO',
    targetType: 'CERTIFICADO',
    label: 'possui',
    properties: { desde: '2025-07-20', principal: true },
  })
  kg.addEdge({
    type: 'USUARIO_POSSUI_CERTIFICADO',
    sourceId: ids.usuarios.ana,
    targetId: ids.certificados.anaEcnpj,
    sourceType: 'USUARIO',
    targetType: 'CERTIFICADO',
    label: 'possui',
    properties: { desde: '2024-11-01', principal: true },
  })

  /* -------- Arestas: Certificado válido para Portal -------- */
  kg.addEdge({
    type: 'CERTIFICADO_VALIDO_PARA_PORTAL',
    sourceId: ids.certificados.mariaEcnpj,
    targetId: ids.portais.ecnpj,
    sourceType: 'CERTIFICADO',
    targetType: 'PORTAL',
    label: 'valido para',
    properties: { desde: '2025-03-10' },
  })
  kg.addEdge({
    type: 'CERTIFICADO_VALIDO_PARA_PORTAL',
    sourceId: ids.certificados.mariaEcnpj,
    targetId: ids.portais.receita,
    sourceType: 'CERTIFICADO',
    targetType: 'PORTAL',
    label: 'valido para',
    properties: { desde: '2025-03-10' },
  })
  kg.addEdge({
    type: 'CERTIFICADO_VALIDO_PARA_PORTAL',
    sourceId: ids.certificados.joaoEcpf,
    targetId: ids.portais.govbr,
    sourceType: 'CERTIFICADO',
    targetType: 'PORTAL',
    label: 'valido para',
    properties: { desde: '2025-07-20' },
  })
  kg.addEdge({
    type: 'CERTIFICADO_VALIDO_PARA_PORTAL',
    sourceId: ids.certificados.anaEcnpj,
    targetId: ids.portais.ecnpj,
    sourceType: 'CERTIFICADO',
    targetType: 'PORTAL',
    label: 'valido para',
    properties: { desde: '2024-11-01' },
  })
  kg.addEdge({
    type: 'CERTIFICADO_VALIDO_PARA_PORTAL',
    sourceId: ids.certificados.anaEcnpj,
    targetId: ids.portais.serpro,
    sourceType: 'CERTIFICADO',
    targetType: 'PORTAL',
    label: 'valido para',
    properties: { desde: '2024-11-01' },
  })

  /* -------- Arestas: Usuário acessa Portal -------- */
  kg.addEdge({
    type: 'USUARIO_ACESSA_PORTAL',
    sourceId: ids.usuarios.maria,
    targetId: ids.portais.ecnpj,
    sourceType: 'USUARIO',
    targetType: 'PORTAL',
    label: 'acessa',
    properties: { frequencia: 'diaria' },
  })
  kg.addEdge({
    type: 'USUARIO_ACESSA_PORTAL',
    sourceId: ids.usuarios.joao,
    targetId: ids.portais.govbr,
    sourceType: 'USUARIO',
    targetType: 'PORTAL',
    label: 'acessa',
    properties: { frequencia: 'semanal' },
  })
  kg.addEdge({
    type: 'USUARIO_ACESSA_PORTAL',
    sourceId: ids.usuarios.ana,
    targetId: ids.portais.serpro,
    sourceType: 'USUARIO',
    targetType: 'PORTAL',
    label: 'acessa',
    properties: { frequencia: 'mensal' },
  })

  /* -------- Arestas: Sessão vinculada a Portal -------- */
  kg.addEdge({
    type: 'SESSAO_VINCULADA_PORTAL',
    sourceId: ids.sessoes.mariaEcNpjSessao,
    targetId: ids.portais.ecnpj,
    sourceType: 'SESSAO',
    targetType: 'PORTAL',
    label: 'vinculada a',
    properties: { particionada: true },
  })
  kg.addEdge({
    type: 'SESSAO_VINCULADA_PORTAL',
    sourceId: ids.sessoes.joaoGovBrSessao,
    targetId: ids.portais.govbr,
    sourceType: 'SESSAO',
    targetType: 'PORTAL',
    label: 'vinculada a',
    properties: { particionada: true },
  })

  /* -------- Arestas: Certificado usado em Sessão -------- */
  kg.addEdge({
    type: 'CERTIFICADO_USADO_EM_SESSAO',
    sourceId: ids.certificados.mariaEcnpj,
    targetId: ids.sessoes.mariaEcNpjSessao,
    sourceType: 'CERTIFICADO',
    targetType: 'SESSAO',
    label: 'usado em',
    properties: { autenticacao: 'certificado-digital' },
  })
  kg.addEdge({
    type: 'CERTIFICADO_USADO_EM_SESSAO',
    sourceId: ids.certificados.joaoEcpf,
    targetId: ids.sessoes.joaoGovBrSessao,
    sourceType: 'CERTIFICADO',
    targetType: 'SESSAO',
    label: 'usado em',
    properties: { autenticacao: 'certificado-digital' },
  })

  /* -------- Arestas: Usuário tem Perfil -------- */
  kg.addEdge({
    type: 'USUARIO_TEM_PERFIL',
    sourceId: ids.usuarios.maria,
    targetId: ids.perfis.gestor,
    sourceType: 'USUARIO',
    targetType: 'PERFIL_ACESSO',
    label: 'tem perfil',
    properties: { desde: '2025-01-15' },
  })
  kg.addEdge({
    type: 'USUARIO_TEM_PERFIL',
    sourceId: ids.usuarios.joao,
    targetId: ids.perfis.consultor,
    sourceType: 'USUARIO',
    targetType: 'PERFIL_ACESSO',
    label: 'tem perfil',
    properties: { desde: '2025-08-01' },
  })
  kg.addEdge({
    type: 'USUARIO_TEM_PERFIL',
    sourceId: ids.usuarios.ana,
    targetId: ids.perfis.auditor,
    sourceType: 'USUARIO',
    targetType: 'PERFIL_ACESSO',
    label: 'tem perfil',
    properties: { desde: '2024-10-01' },
  })

  /* -------- Arestas: Perfil possui Permissão -------- */
  const perfilPermissoes: Array<{
    perfil: Id
    permissao: Id
  }> = [
    { perfil: ids.perfis.gestor, permissao: ids.permissoes.ler },
    { perfil: ids.perfis.gestor, permissao: ids.permissoes.escrever },
    { perfil: ids.perfis.gestor, permissao: ids.permissoes.assinar },
    { perfil: ids.perfis.gestor, permissao: ids.permissoes.exportar },
    { perfil: ids.perfis.consultor, permissao: ids.permissoes.ler },
    { perfil: ids.perfis.auditor, permissao: ids.permissoes.ler },
    { perfil: ids.perfis.auditor, permissao: ids.permissoes.exportar },
  ]

  for (const { perfil, permissao } of perfilPermissoes) {
    kg.addEdge({
      type: 'PERFIL_POSSUI_PERMISSAO',
      sourceId: perfil,
      targetId: permissao,
      sourceType: 'PERFIL_ACESSO',
      targetType: 'PERMISSAO',
      label: 'possui',
      properties: {},
    })
  }

  return kg
}

/** Grafo de semente pronto para uso (instância única compartilhada). */
export const defaultSeed = (() => {
  const kg = new KnowledgeGraph()
  return seedKnowledgeGraph(kg)
})()
