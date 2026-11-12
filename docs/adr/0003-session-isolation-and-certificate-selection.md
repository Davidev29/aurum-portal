# ADR 0003 — Isolamento por cliente e certificado

- **Status:** Aceita
- **Data:** 2026-11-04
- **Decisores:** Equipe AurumBit Portal

## Contexto

Um escritório pode operar dezenas de clientes no mesmo computador. Portais públicos frequentemente compartilham SSO (por exemplo, gov.br) e mantêm cookies de sessão no navegador. Se dois clientes usarem a mesma partição, um pode herdar a sessão autenticada do outro, com risco de vazamento entre partes e de atuação em nome do titular errado.

Além disso, o Chromium, por padrão, pode escolher automaticamente o primeiro certificado oferecido pelo servidor. Em uma estação com vários A1 instalados, isso é inaceitável: a sessão precisa provar que o certificado apresentado é exatamente o vinculado ao cliente selecionado.

## Decisão

1. **Partição por cliente e certificado.** A partição é `persist:client:<clientId>` para senha e `persist:client:<clientId>:cert:<certificateId>` para certificado. O prefixo `persist:` mantém cookies e storage entre aberturas.
2. **Reutilização explícita.** Uma sessão só é reutilizada quando cliente, serviço, método de autenticação e certificado/credencial coincidem. O usuário pode forçar uma nova sessão.
3. **Seleção explícita de certificado.** O handler de `select-client-certificate` sempre chama `event.preventDefault()` e só devolve um certificado cujo thumbprint SHA-256 (ou SHA-1 de fallback) coincida com o da sessão. Se o servidor não oferecer o certificado correto, a autenticação é cancelada e auditada.
4. **Allowlist de domínios.** A seleção só ocorre para hosts permitidos pelo serviço. Redirecionamentos para fora da allowlist são bloqueados.
5. **Sem proxy TLS/MITM.** O aplicativo não intercepta o tráfego dos portais nem instala uma CA própria. A confiança TLS é a do Windows/Chromium.
6. **A3 rejeitado.** Pedidos de senha/PIN de token são recusados; o MVP é somente A1.

## Consequências

**Positivas**

- Impede vazamento de sessão entre clientes no uso normal.
- Impede que o Chromium apresente um certificado errado quando há vários instalados.
- O vínculo cliente–certificado é verificável e auditável.
- Reduz o risco de o usuário operar em nome do titular errado.

**Negativas**

- Mais partições em disco, com cookies e storage acumulados ao longo do tempo.
- Fechar a janela não limpa a partição; o usuário precisa gerenciar o armazenamento ou remover a pasta de dados.
- SSO entre serviços do mesmo cliente funciona apenas dentro da mesma partição e do mesmo certificado.
- Portais que exigem certificado em domínio fora da allowlist falham por segurança; a configuração do serviço precisa ser corrigida.
- A proteção não impede que um usuário do Windows com acesso ao mesmo perfil abra o aplicativo e veja os dados.

## Alternativas consideradas

1. **Partição única.** Simples, mas inaceitável por permitir cruzamento de sessões entre clientes.
2. **Uma janela anônima por sessão.** Reduz persistência, mas piora a experiência em portais com MFA e não resolve a seleção automática de certificado.
3. **Proxy TLS local com MITM.** Permitiria inspecionar e trocar certificados, mas criaria um risco grave de interceptação e exigiria instalar uma CA raiz; rejeitado.
4. **Navegador externo com perfis separados.** Não permite controlar a seleção de certificado nem auditar o handshake com precisão.
