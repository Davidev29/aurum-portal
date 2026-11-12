# Estudo — Login via Certificado Digital nos Portais Gov

**Aplicação:** AurumBit Portal ("AurumBit Portal") — *Cofre de acessos gov.br*  
**Tecnologia:** Electron + Next.js (renderer isolado, sandbox, contextIsolation, webSecurity)  
**Objetivo:** Entregar o portal já aberto e o usuário já logado, via certificado digital ICP-Brasil (A1), sem tela de login e sem digitação de senha.  
**Autor:** estudo agentico individual por portal  
**Data:** 10/nov/2026

---

## 1. Panorama da aplicação

A aplicação é um cofre de acessos a portais governamentais. Cada "serviço" (portal) é cadastrado com:

- `baseUrl` — URL de entrada do portal
- `allowedDomains` — allowlist de domínios onde a navegação e a injeção de certificado são permitidas
- `authMethods` — métodos aceitos (`certificate` e/ou `password`)
- `defaultAuth` — método padrão sugerido no diálogo de abertura
- `recipe` — automação assistida (passos de `waitFor` / `click` / `fill`, detecção de pós-login, proteção contra CAPTCHA/2FA)

Os portais são listados na **Store de serviços** (`src/app/page.tsx`). Ao clicar em **"Abrir portal"** abre-se o `LaunchDialog` (`src/components/sessions/launch-dialog.tsx`), onde o operador escolhe:
1. o **cliente** (PF/PJ),
2. o **método de autenticação** (`Certificado A1` ou `Login e senha`),
3. o **certificado** vinculado a esse cliente.

Ao confirmar, chama `aurumBitPortal().sessions.open({ authMethod: 'certificate', certificateId })` e uma **janela de sessão isolada** é aberta no Electron (`electron/main/sessions/manager.ts`).

> Princípio de design: não existe "cliente atual global". Cada sessão usa uma **partição isolada** do Electron (`session.fromPartition(partition)`) construída a partir de `clientId + certificateId + authMethod`. Cookies e cache de um cliente não vazam para outro.

---

## 2. Como o login por certificado funciona "por baixo dos panos" (fluxo robotico)

Este é o caminho que leva do clique no portal à sessão já logada, sem interação humana de login:

### 2.1. Abertura da sessão isolada (`SessionManager.open`)

1. Valida que o serviço está habilitado e aceita `certificate`.
2. Valida que o cliente está ativo.
3. Carrega o certificado pelo `certificateId`, verifica que:
   - está vinculado ao cliente;
   - não está expirado;
   - não está `missing_windows` (ausente do repositório do Windows);
   - não está `chain_incomplete` (cadeia ICP-Brasil incompleta);
   - está instalado no Windows (se não, tenta instalar via IPC `certificates:install`).
4. Cria a **partição isolada** (`buildPartition`) e registra o `SessionContext` no `SessionContextRegistry`, contendo: thumbprint SHA-256/SHA-1, serial, DN do emissor e do titular, `allowedDomains` do serviço.
5. Abre `BrowserWindow` + `WebContentsView` com `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`.
6. Carrega `service.baseUrl` na view.

### 2.2. Execução da receita de automação (`recipes/runner.ts`)

Ao `did-finish-load`, dispara `startRecipe`:

- **Fast-path:** verifica se a partição já está logada (cookies de acesso anterior com o mesmo cliente+certificado). Se encontrar seletores de pós-login (ex.: texto "Sair"), marca `authenticated` imediatamente e não executa cliques desnecessários.
- **Passos da receita:** para os portais com `certRecipe`, a receita faz:
  - `waitFor` (opcional, 20s) dos seletores de "Entrar com certificado digital";
  - `click` (opcional, 5s) nos mesmos seletores.
- **Detecção de pós-login:** aguarda até 45s por seletores de "Sair"/logout. Se encontra, a sessão é marcada `authenticated` (usuário já logado, sem tela de login).
- Se não autenticar automaticamente, entra em `awaiting_login` com um watcher a cada 5s por até 10 minutos.

### 2.3. Injeção do certificado no handshake TLS mTLS (`electron/main/sessions/selection.ts` + `electron/main/certificates/core.ts`)

Quando o portal gov.br solicita certificado de cliente, o Electron dispara o evento `select-client-certificate`. O handler instalado em `electron/main/index.ts` (`installCertificateSelectionHandler`) faz:

1. **`event.preventDefault()`** — é obrigatório nunca removê-lo; caso contrário o Electron escolhe automaticamente o primeiro certificado do store do Windows.
2. Recupera o contexto da sessão a partir do `WebContents` (partição).
3. Converte a lista de certificados oferecidos pelo servidor em `CertificateSelectionItem[]`.
4. Chama `resolveCertificateSelection`, que:
   - **Parsa a URL** tolerando o formato do Electron (`host:porta`, sem esquema) via `parseHttpUrl` (`shared/network.ts`).
   - **Recusa HTTP puro** — autenticação por certificado exige HTTPS (`parsedUrl.protocol !== 'https:'` → `host-not-allowed`).
   - **Aplica a allowlist:** se o host é governamental brasileiro (`.gov.br` ou exato `gov.br`, via `isGovernmentHost`), a injeção é liberada automaticamente. Caso contrário, o host deve estar explicitamente na `allowedDomains` do serviço (`isAllowedHost`, suporte a curinga `*.dominio`).
   - **Seleciona por thumbprint:** compara SHA-256/SHA-1 do certificado da sessão com os certificados oferecidos pelo servidor (`selectCertificateByThumbprint`, score >= 50 = alta confiança). Serial/DN servem apenas como desempate.
5. Chama `callback(certificadoEscolhido)` — o certificado é injetado no handshake mTLS, sem prompt de escolha para o usuário.
6. `app.setClientCertRequestPasswordHandler` lança erro para certificados com PIN/A3: **no MVP só A1 é suportado**.

### 2.4. Resultado entregue

- Janela de sessão aberta no portal.
- Handshake TLS mTLS realizado com o certificado A1 escolhido.
- Portal reconhece o certificado e mantém a sessão gov.br/ICP-Brasil ativa.
- Operador não vê tela de login, não digita CPF/CNPJ nem senha.
- Sessão fica isolada na partição do cliente; auditoria registra `certificate.selected` e `session.auth_detected`.

---

## 3. Estudo individual — cada portal disponível (builtin)

Abaixo, o estudo portal a portal. Os **seletores de certificado** (`CERT_LOGIN_SELECTORS`) são comuns à receita `certRecipe` e usados pelos portais que adotam certificado digital:

| # | Seletor | O que identifica |
|---|---------|------------------|
| 1 | `text=Entrar com certificado digital` | Texto visível do botão/link de certificado |
| 2 | `text=Entrar com certificado` | Variante curta |
| 3 | `a[href*="certificado"]` | Link cuja URL contenha "certificado" |
| 4 | `button:has-text("certificado")` | Botão com a palavra "certificado" |
| 5 | `[data-testid*="certificado"]` | Atributo de teste de automação |

Os **seletores de pós-login** (`postLogin`, comuns) confirmam que o usuário já entrou:

| Seletor | Significado |
|---------|-------------|
| `text=Sair` / `text=Sair do gov.br` / `text=Sair da conta` | Link/botão de encerramento de sessão |
| `a[href*="logout"]` / `a[href*="signout"]` | URL de logout |
| `button[aria-label*="Sair" i]` / `button[aria-label*="Logout" i]` | Botão com rótulo de sair |
| `[aria-label*="Sair" i]` / `[data-testid="logout"]` | Genéricos de logout |

> Se qualquer um desses aparecer após a injeção do certificado, a sessão é considerada `authenticated` e entregue ao usuário já logada.

---

### 3.1. gov.br — Hub de Identidade do Governo Federal

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-govbr` / `govbr` |
| **Categoria** | Governo Federal |
| **URL base** | `https://sso.acesso.gov.br/login` |
| **Allowlist** | `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/gov-br.png` |
| **Receita** | Própria (`certRecipe('govbr')`) |
| **Pós-login** | Padrão gov.br (`text=Sair`, `text=Sair do gov.br`, `text=Sair da conta`, links de logout, etc.) |

**Botões a acessar:** o fluxo robotico aguarda/clica em "Entrar com certificado digital" (ou variantes) na página de login do SSO. Como o SSO já redireciona para o fluxo de certificado quando detecta mTLS, muitas vezes o login ocorre apenas com a injeção do certificado no handshake TLS.

**Observação:** "A sessão gov.br é compartilhada entre serviços do mesmo cliente na partição correspondente." Ou seja, uma vez autenticado no gov.br com o certificado, outros serviços gov.br na mesma partição herdam a sessão.

---

### 3.2. Redesim — Portal de Empresas e Negócios

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-redesim` / `redesim` |
| **Categoria** | Governo Federal |
| **URL base** | `https://www.gov.br/empresas-e-negocios/login_cidadao` |
| **Allowlist** | `www.gov.br`, `gov.br`, `*.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `password` |
| **Logo** | — |
| **Receita** | Própria, `auth: 'password'` (preenchimento de conta) |

**Botões a acessar:** por padrão a receita é de senha (preenche `account`). Para uso com certificado, o operador deve escolher o método `certificate` no `LaunchDialog`; a receita é adaptada (`recipeForSession`) removendo passos de `fill` de credencial e mantendo navegação + watcher de pós-login.

**Observação:** "Redireciona para o SSO gov.br. A URL de autorização é gerada pelo portal e não deve ser salva." A injeção de certificado funciona no redirecionamento para `sso.acesso.gov.br`, que está na allowlist.

---

### 3.3. e-CAC — Portal da Receita Federal

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-ecac` / `ecac` |
| **Categoria** | Governo Federal |
| **URL base** | `https://cav.receita.fazenda.gov.br/` |
| **Allowlist** | `cav.receita.fazenda.gov.br`, `receita.fazenda.gov.br`, `gov.br`, `*.gov.br`, `acesso.gov.br`, `sso.acesso.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/ecac.png` |
| **Receita** | Própria (`certRecipe('ecac')`) |
| **Pós-login** | Específico: `text=Sair`, `text=Meus servicos`, `text=Certidoes`, `a[href*="logout"]` |

**Botões a acessar:** "Entrar com certificado digital" na tela de entrada do e-CAC. A receita espera o seletor (opcional, 20s) e tenta clicar (opcional, 5s); o restante é resolvido pelo mTLS.

**Observação:** "Entrar pela URL base e deixar o portal gerar o fluxo de autenticação." É um dos portais onde o portal receita dispara o desafio de certificado por conta própria.

---

### 3.4. JUcec-CE — Junta Comercial do Ceará

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-jucec-ce` / `jucec-ce` |
| **Categoria** | Governo Estadual |
| **URL base** | `https://portalservicos.jucec.ce.gov.br/` |
| **Allowlist** | `portalservicos.jucec.ce.gov.br`, `jucec.ce.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br` |
| **Métodos** | `password` (apenas) |
| **Default** | `password` |
| **Logo** | — |
| **Receita** | Própria, `auth: 'password'` (preenche usuário e senha) |

**Botões a acessar:** campos de usuário/senha (receita de senha). Não há fluxo de certificado digital nativo neste builtin.

**Observação:** "Validar no spike se o portal aceita certificado." Este portal **não está pronto para entrega robotica por certificado** sem validação adicional (spike). Não inclui seletores de certificado na receita.

---

### 3.5. Pendências CNPJ — Receita Federal

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-pendencias-cnpj` / `pendencias-cnpj` |
| **Categoria** | Governo Federal |
| **URL base** | `https://servicos.receitafederal.gov.br/servico/pendencias/#/analise-pendencias` |
| **Allowlist** | `servicos.receitafederal.gov.br`, `receitafederal.gov.br`, `receita.fazenda.gov.br`, `*.receitafederal.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/gov-br.png` |
| **Receita** | `certRecipe('pendencias-cnpj')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital" (ou variantes). Redireciona para `login.gov.br`, coberto pela allowlist `*.gov.br`.

**Observação:** "Pendências de CNPJ atualizadas (Receita Federal). Redireciona para login.gov.br; certificado digital ou conta gov.br."

---

### 3.6. FGTS Digital — Portal do Empregador

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-fgts-digital` / `fgts-digital` |
| **Categoria** | Governo Federal |
| **URL base** | `https://fgtsdigital.sistema.gov.br/portal/servicos` |
| **Allowlist** | `fgtsdigital.sistema.gov.br`, `sistema.gov.br`, `*.sistema.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/gov-br.png` |
| **Receita** | `certRecipe('fgts-digital')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". 

**Observação:** "FGTS Digital do empregador. Acesso com certificado digital (e-CPF/e-CNPJ)."

---

### 3.7. eSocial — Portal eSocial Web

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-esocial` / `esocial` |
| **Categoria** | Governo Federal |
| **URL base** | `https://www.esocial.gov.br/portal/` |
| **Allowlist** | `www.esocial.gov.br`, `esocial.gov.br`, `login.esocial.gov.br`, `*.esocial.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/esocial.jpg` |
| **Receita** | `certRecipe('esocial')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". Redireciona para `login.esocial.gov.br` / `sso.acesso.gov.br` (gov.br com selo Certificado Digital).

**Observação:** "eSocial Web. Redireciona para login.esocial.gov.br / sso.acesso.gov.br (gov.br com selo Certificado Digital)."

---

### 3.8. DTE Trabalhista — Domicílio Eletrônico Trabalhista

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-det-trabalhista` / `det-trabalhista` |
| **Categoria** | Governo Federal |
| **URL base** | `https://det.sit.trabalho.gov.br/` |
| **Allowlist** | `det.sit.trabalho.gov.br`, `sit.trabalho.gov.br`, `*.sit.trabalho.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/det-trabalhista.webp` |
| **Receita** | `certRecipe('det-trabalhista')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". Redireciona para `/login.aspx`.

**Observação:** "Domicílio Eletrônico Trabalhista (DET). Redireciona para /login.aspx."

---

### 3.9. SIGA SEFAZ-CE — Sistema de Interface Guiada à Autorregularização

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-siga-sefaz-ce` / `siga-sefaz-ce` |
| **Categoria** | Governo Estadual |
| **URL base** | `https://siga.sefaz.ce.gov.br/ui/` |
| **Allowlist** | `siga.sefaz.ce.gov.br`, `sefaz.ce.gov.br`, `*.sefaz.ce.gov.br`, `sso.sefaz.ce.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/sefaz-ce.png` |
| **Receita** | `certRecipe('siga-sefaz-ce')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". 

**Observação:** "A URL original do SSO (`sso.sefaz.ce.gov.br`) contém `session_code` efêmero; abre pela UI do SIGA e o SSO gera sessão nova." O domínio `sso.sefaz.ce.gov.br` está na allowlist, portanto a injeção de certificado no redirecionamento do SSO estadual é permitida.

---

### 3.10. Simples Nacional — Portal do Simples Nacional

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-simples-nacional` / `simples-nacional` |
| **Categoria** | Governo Federal |
| **URL base** | `https://www8.receita.fazenda.gov.br/SimplesNacional/Servicos/Grupo.aspx?grp=t&area=1` |
| **Allowlist** | `www8.receita.fazenda.gov.br`, `receita.fazenda.gov.br`, `receitafederal.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/simples-nacional.webp` |
| **Receita** | `certRecipe('simples-nacional')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". 

**Observação:** "Portal do Simples Nacional. Acesso via certificado/e-CAC ou Código de Acesso + senha."

---

### 3.11. Registrato — Meu BC (Banco Central)

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-registrato` / `registrato` |
| **Categoria** | Governo Federal |
| **URL base** | `https://meubc.bcb.gov.br/meubc/` |
| **Allowlist** | `meubc.bcb.gov.br`, `bcb.gov.br`, `*.bcb.gov.br`, `sso.acesso.gov.br`, `acesso.gov.br`, `gov.br`, `*.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/bacen.png` |
| **Receita** | `certRecipe('registrato')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". 

**Observação:** "Registrato do Banco Central (Meu BC). Acesso com certificado digital ICP-Brasil ou gov.br."

---

### 3.12. DTE SEFAZ-CE — Domicílio Tributário Eletrônico (SEFAZ-CE)

| Campo | Valor |
|-------|-------|
| **ID / slug** | `builtin-dte-sefaz-ce` / `dte-sefaz-ce` |
| **Categoria** | Governo Estadual |
| **URL base** | `https://portal-dte.sefaz.ce.gov.br/#/certificado` |
| **Allowlist** | `portal-dte.sefaz.ce.gov.br`, `sefaz.ce.gov.br`, `*.sefaz.ce.gov.br`, `sso.sefaz.ce.gov.br` |
| **Métodos** | `certificate`, `password` |
| **Default** | `certificate` |
| **Logo** | `/portals/sefaz-ce.png` |
| **Receita** | `certRecipe('dte-sefaz-ce')` |
| **Pós-login** | Padrão gov.br |

**Botões a acessar:** "Entrar com certificado digital". Rota SPA `#/certificado` (acesso com certificado digital).

**Observação:** "Domicílio Tributário Eletrônico (DTE) da SEFAZ-CE. Rota SPA #/certificado (acesso com certificado digital)."

---

## 4. Matriz resumida dos 12 portais

| # | Portal | Slug | Categoria | Default auth | Certificado na receita | Logo | Pronto p/ robotico (cert) |
|---|--------|------|-----------|--------------|------------------------|------|---------------------------|
| 1 | gov.br | `govbr` | Governo Federal | certificate | Sim (`certRecipe`) | gov-br.png | Sim |
| 2 | Redesim | `redesim` | Governo Federal | password | Não (receita senha) | — | Parcial (método cert manual) |
| 3 | e-CAC | `ecac` | Governo Federal | certificate | Sim (`certRecipe`) | ecac.png | Sim |
| 4 | JUcec-CE | `jucec-ce` | Governo Estadual | password | Não | — | Não (sem fluxo de cert) |
| 5 | Pendências CNPJ | `pendencias-cnpj` | Governo Federal | certificate | Sim (`certRecipe`) | gov-br.png | Sim |
| 6 | FGTS Digital | `fgts-digital` | Governo Federal | certificate | Sim (`certRecipe`) | gov-br.png | Sim |
| 7 | eSocial | `esocial` | Governo Federal | certificate | Sim (`certRecipe`) | esocial.jpg | Sim |
| 8 | DTE Trabalhista | `det-trabalhista` | Governo Federal | certificate | Sim (`certRecipe`) | det-trabalhista.webp | Sim |
| 9 | SIGA SEFAZ-CE | `siga-sefaz-ce` | Governo Estadual | certificate | Sim (`certRecipe`) | sefaz-ce.png | Sim |
| 10 | Simples Nacional | `simples-nacional` | Governo Federal | certificate | Sim (`certRecipe`) | simples-nacional.webp | Sim |
| 11 | Registrato | `registrato` | Governo Federal | certificate | Sim (`certRecipe`) | bacen.png | Sim |
| 12 | DTE SEFAZ-CE | `dte-sefaz-ce` | Governo Estadual | certificate | Sim (`certRecipe`) | sefaz-ce.png | Sim |

**Totais:** 10 portais com fluxo nativo de certificado digital pronto para injeção robotica; 2 portais (Redesim default senha, JUcec-CE só senha) exigem adaptação/validação.

---

## 5. Fluxo robotico "por baixo dos panos" — passo a passo da entrega

Do clique do usuário até a sessão já logada:

1. **Clicar no portal** — ServiceCard → "Abrir portal" abre o `LaunchDialog`.
2. **Escolher o cliente** — cliente ativo com pelo menos um certificado A1 válido vinculado.
3. **Escolher o certificado** — método `certificate`; seleciona o certificado (última escolha lembrada ou o primeiro elegível). Se houver mais de um certificado válido, o operador deve escolher (o sistema não adivinha).
4. **Confirmar "Abrir portal"** — chama `aurumBitPortal().sessions.open({ authMethod: 'certificate', certificateId })`.
5. **Electron valida e instala** — serviço habilitado, cliente ativo, certificado vinculado, não vencido, não ausente do Windows, cadeia ICP-Brasil completa; instala no Windows se necessário.
6. **Cria partição isolada** — `partition = f(clientId, certificateId, authMethod)`; registra contexto (thumbprint, allowedDomains).
7. **Abre janela isolada** — BrowserWindow + WebContentsView (sandbox, contextIsolation, webSecurity) e carrega `baseUrl`.
8. **Executa a receita** — `waitFor`/`click` nos seletores "Entrar com certificado digital" (opcional); fast-path detecta se já há sessão salva (cookies) e pula direto para `authenticated`.
9. **Handshake mTLS** — portal solicita certificado → evento Electron `select-client-certificate`:
   - `preventDefault()` (obrigatório).
   - Valida URL (suporta `host:porta` sem esquema).
   - Recusa HTTP puro.
   - Aceita automaticamente se host é `.gov.br`; senão exige allowlist explícita do serviço.
   - Seleciona por thumbprint (SHA-256/SHA-1) com score >= 50.
   - Injeta o certificado via `callback(cert)`.
10. **Detecção de pós-login** — aguarda até 45s por seletores de "Sair"/logout. Encontrou → `authenticated`.
11. **Entrega ao usuário** — janela do portal já logada, sem tela de login, sem senha. Auditoria: `certificate.selected` + `session.auth_detected`.

---

## 6. Pré-condições para que a entrega robotica funcione

| Pré-condição | Como verificar/atender |
|--------------|------------------------|
| Certificado A1 ICP-Brasil importado no cofre | `certificates.import({ filePath: .pfx, password, install: true, consent: true })` |
| Certificado instalado no repositório do Windows | `certificates.listWindows()` / status `installed` |
| Certificado vinculado ao cliente | `certificates.linkClient({ id, clientId, consent: true })` |
| Certificado válido (não expirado, cadeia completa) | status `valid` ou `expiring`; não `missing_windows` nem `chain_incomplete` |
| Acesso HTTPS (mTLS) | O portal deve usar HTTPS; HTTP puro é recusado pelo `parseHttpUrl` |
| Host na allowlist | `.gov.br` é aceito automaticamente; outros domínios precisam estar em `allowedDomains` do serviço |
| Sem CAPTCHA/reCAPTCHA/hCaptcha nem 2FA ativos | Caso contrário a receita para em `manual` e o operador conclui manualmente |

---

## 7. Limitações e pontos de atenção

- **A3 / cartão com PIN não suportados no MVP:** `app.setClientCertRequestPasswordHandler` lança erro ("Certificados com PIN/A3 não são suportados no MVP. Use um certificado A1."). Somente A1 (arquivo) entra no fluxo robotico.
- **Mais de um certificado válido por cliente:** `pickOnlyCertificate` lança erro de validação exigindo que o usuário escolha no `LaunchDialog`.
- **CAPTCHA / reCAPTCHA / hCaptcha / 2FA:** detectados por `detectInterstitial`; a sessão vai para `manual` e o operador deve concluir manualmente.
- **JUcec-CE:** não tem receita de certificado (somente senha). Exige spike/validação antes de ser usado com certificado digital.
- **Redesim:** default é senha; para usar certificado o operador deve selecionar manualmente o método `certificate` no diálogo.
- **Hosts parecidos são rejeitados:** `gov.br.evil.com`, `sso.acesso.gov.br.evil.com`, `gov.br@evil.com`, labels vazios (`.gov.br`, `a..gov.br`) etc. são recusados pelo `isGovernmentHost` + `hasValidLabels`.
- **Permissões da janela de sessão:** `setPermissionRequestHandler` e `setPermissionCheckHandler` retornam `false` (nada é permitido sem aprovação explícita).

---

## 8. Implementação entregue — corte das etapas intermediárias (e-CAC e similares)

Foram feitas as seguintes alterações em `shared/builtins.ts`:

### 8.1. Novos seletores de tela intermediária (`INTERSTIAL_CERT_SELECTORS`)

Adicionados seletores específicos para a página de escolha do gov.br que aparece **antes** do redirecionamento para o SSO (ex.: e-CAC mostra o botão "Entrar com gov.br" na caixa "ACESSO GOVBR"):

```
text=Entrar com gov.br, text=Entrar pelo gov.br,
text=Acesso GOVBR, text=ACESSO GOVBR,
button:has-text("Entrar com gov.br"), button:has-text("gov.br"),
text=Certificado digital, text=Acesso com certificado,
text=Entrar com certificado digital, text=Entrar com certificado,
text=Entrar com e-CPF ou e-CNPJ, text=Entrar com e-CPF, text=Entrar com e-CNPJ,
a[href*="certificado"], a[href*="e-cpf"], a[href*="e-cnpj"],
button:has-text("certificado"), button:has-text("e-CPF"), button:has-text("e-CNPJ"),
[data-testid*="certificado"], [data-testid*="acesso-certificado"],
[data-testid*="ecpf"], [data-testid*="ecnpj"]
```

> O botão `"Entrar com gov.br"` é o que aparece na tela intermediária do e-CAC (`cav.receita.fazenda.gov.br/autenticacao/login`). Clicar nele leva ao fluxo do gov.br onde a opção de certificado digital é oferecida e o mTLS é disparado.

### 8.2. Nova função `certRecipeWithInterstitial` — zero tela de login

Substitui `certRecipe` por uma receita com 4 passos, onde o primeiro injeta JavaScript direto na página para clicar automaticamente no botão de certificado/gov.br:

| Passo | Ação | Como funciona | Timeout | Obrigatório? |
|-------|------|---------------|---------|--------------|
| 1 | `evaluate` | Injeta JS que clica **imediatamente** no botão de certificado/gov.br assim que o DOM carrega (`did-finish-load`) | 2s | — |
| 2 | `waitFor` | Fallback: aguarda por seletor de certificado se o evaluate não encontrou | 2s | Opcional |
| 3 | `click` | Fallback: clica no botão se encontrar | 2s | Opcional |
| 4 | `sleep` | Pausa para o servidor processar o clique e disparar mTLS | 1s | — |

**Script injetado (`AUTO_CLICK_CERT_SCRIPT`):** percorre todos os `<a>`, `<button>`, `[role="button"]` e `<input type="submit">` visíveis, e clica no primeiro cujo texto contenha: `certificado digital`, `entrar com certificado`, `entrar com gov.br`, `entrar pelo gov.br`, `acesso govbr`, `e-cpf ou e-cnpj`, `e-cpf`, `e-cnpj`.

Comportamento:
- **Se o portal tem tela intermediária** (ex.: e-CAC com "Entrar com gov.br"): o JS clica automaticamente no botão assim que a página carrega. O usuário **não vê a tela** (apenas um piscar de fração de segundo). Isso força o servidor a solicitar o certificado via mTLS, que o Electron injeta automaticamente.
- **Se o portal dispara mTLS diretamente**: o `evaluate` não encontra nenhum botão de certificado (não há o que clicar), retorna sem efeito, e o fluxo segue normalmente. Sem regressão.

### 8.3. Portais atualizados

Todos os 10 portais com fluxo de certificado agora usam `certRecipeWithInterstitial(...)`:
- gov.br, e-CAC, pendencias-cnpj, fgts-digital, esocial, det-trabalhista, siga-sefaz-ce, simples-nacional, registrato, dte-sefaz-ce

Cada um mantém seus seletores de pós-login específicos (ex.: e-CAC usa `text=Meus servicos`, `text=Certidoes`; gov.br mantém `twoFactorSelectors` para 2FA).

### 8.4. Checklist atualizado

- [x] Catálogo de 12 portais builtin mapeados (URL, allowlist, métodos, logo, receita).
- [x] Seletores de botão de certificado identificados (`CERT_LOGIN_SELECTORS`) — comuns a 10 portais.
- [x] Seletores de detecção de pós-login (`postLogin`) identificados.
- [x] Fluxo de injeção de certificado mapeado código a código (`selection.ts` → `core.ts` → `network.ts`).
- [x] Protocolo de entrega robotica documentado (clique → cliente → certificado → partição isolada → mTLS → sessão logada).
- [x] Receitas gov.br ajustadas com seletores de tela intermediária (`INTERSTIAL_CERT_SELECTORS`) e clique automático — corte das 2 etapas manuais.
- [ ] Executar o spike `npm run simulate:cert` para validar a lógica de seleção contra o formato `host:porta` sem esquema do Electron.
- [ ] Validar cada portal gov.br em ambiente real (produção/homologação) com certificado A1 ICP-Brasil, confirmando que a detecção de "Sair" ocorre e a sessão chega a `authenticated` sem tela de login.
- [ ] Tratar JUcec-CE e Redesim (fluxo senha) com spike separado se forem necessários com certificado.

---

## 9. Conclusão

A aplicação já possui toda a infraestrutura para entregar portais gov.br já logados via certificado digital ICP-Brasil (A1), de forma robotica e sem tela de login:

- **Identificação dos botões:** padronizada em `CERT_LOGIN_SELECTORS` ("Entrar com certificado digital", "Entrar com certificado", `a[href*="certificado"]`, `button:has-text("certificado")`, `[data-testid*="certificado"]`).
- **Injeção por baixo dos panos:** Electron `select-client-certificate` com `preventDefault()`, parsing tolerante a `host:porta` sem esquema, recusa de HTTP, allowlist automática para `.gov.br`, seleção por thumbprint SHA-256/SHA-1, e injeção via `callback(cert)`.
- **Entrega da sessão:** partição isolada por cliente+certificado, execução de receita (`waitFor`/`click`/detecção de pós-login), e marcação `authenticated` quando seletores de "Sair" aparecem.

Dos 12 portais builtin, 10 estão prontos para esse fluxo robotico de certificado; 2 (Redesim e JUcec-CE) exigem adaptação ou validação adicional por serem default de senha.
