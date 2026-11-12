# ADR 0001 — Arquitetura local-only

- **Status:** Aceita
- **Data:** 2026-11-04
- **Decisores:** Equipe AurumBit Portal

## Contexto

O AurumBit Portal armazena credenciais de portais públicos, certificados digitais A1 e metadados de clientes. Esses dados são sensíveis e o público-alvo é um escritório de contabilidade ou departamento que opera vários clientes em uma única estação Windows.

Há três alternativas de topologia: (a) aplicativo desktop com dados apenas na estação, (b) aplicativo desktop sincronizando com um backend próprio e (c) aplicação web centralizada. As duas últimas exigem operação de servidor, autenticação de usuários, criptografia em trânsito e em repouso no servidor, backup central, controle de acesso multi-inquilino e conformidade com LGPD em uma superfície muito maior.

## Decisão

Adotar uma arquitetura **local-only**:

- O processo principal do Electron concentra banco SQLite, cofre, certificados, sessões e auditoria.
- O renderer é um export estático do Next.js, servido pelo protocolo interno `app://`.
- Não há API remota, conta de usuário, telemetria ou sincronização.
- A única comunicação externa é com os portais acessados pelo usuário e, opcionalmente, com o servidor de atualizações configurado.
- O backup é responsabilidade do operador e é feito por exportação de PFX protegida por frase-senha ou por cópia controlada da pasta de dados.

## Consequências

**Positivas**

- Menor superfície de ataque: não há backend, banco compartilhado nem sessão de nuvem.
- Dados permanecem sob controle físico e lógico da organização.
- Funciona offline para cadastro e consulta; só os portais exigem rede.
- Implantação simples: um instalador NSIS e uma pasta de dados por usuário do Windows.
- Facilita auditoria local e explicabilidade do fluxo.

**Negativas**

- Não há colaboração entre estações nem sincronização automática.
- Perda do perfil do Windows ou do disco pode inviabilizar a abertura do cofre; o backup é crítico.
- Cada estação precisa ser atualizada e auditada separadamente.
- O operador assume integralmente deveres de segurança, retenção e resposta a incidentes.
- Não há autenticação centralizada nem SSO corporativo.

## Alternativas consideradas

1. **Backend próprio com sincronização.** Rejeitado no MVP por aumentar custo operacional, exigir autenticação multi-inquilino e criar um alvo central de alto valor.
2. **Aplicação web.** Rejeitada porque o fluxo depende de certificado A1 no repositório do Windows e de isolamento de sessão no cliente; um servidor não teria acesso ao certificado local sem proxy TLS, o que introduziria risco de MITM.
3. **Desktop com banco em nuvem.** Rejeitada por misturar credenciais locais com disponibilidade de rede e por dificultar a garantia de que o cofre permanece sob o DPAPI do usuário.
