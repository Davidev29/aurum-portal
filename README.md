<div align="center">

<img src="public/Logomarca%20da%20empresa.png" alt="AurumBit Portal" width="300" />

# AurumBit Portal

**Cofre de acessos e sessões isoladas para portais públicos brasileiros.**

Clientes, credenciais e certificados digitais A1 em um único lugar — com sessões isoladas
que abrem os portais certos, no certificado certo, para a pessoa certa.

[![CI](https://github.com/Davidev29/aurum-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/Davidev29/aurum-portal/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/badge/versão-0.1.0-c9a24b?style=flat-square&logoColor=white)](package.json)
[![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11%20x64-1a1a1a?style=flat-square&logo=windows)](#requisitos)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-339933?style=flat-square&logo=node.js&logoColor=white)](#requisitos)
[![Stack](https://img.shields.io/badge/stack-Electron%2045%20%C2%B7%20Next.js%2016%20%C2%B7%20React%2019-1a1a1a?style=flat-square)](#arquitetura)
[![Licença](https://img.shields.io/badge/licença-privado%20%C2%B7%20uso%20restrito-8a8a8a?style=flat-square)](docs/TERMS.md)

</div>

---

## Sobre

O **AurumBit Portal** é um aplicativo desktop para Windows que organiza **clientes, credenciais e certificados digitais A1** e abre **portais públicos brasileiros** em sessões isoladas — com seleção explícita do certificado no handshake TLS e um cofre local criptografado para todos os segredos.

> **Escopo da versão 0.1.0** — uso local, por um único usuário do Windows. Certificados **A1** (PFX/P12) com autenticação por senha. Certificados **A3, token, smart card e PIN não são suportados**. O aplicativo não sincroniza dados com a nuvem e não possui telemetria; a única comunicação opcional é a verificação de atualizações contra o servidor configurado (desabilitada por padrão em desenvolvimento).

---

## Sumário

- [Recursos](#recursos)
- [Portais embutidos](#portais-embutidos)
- [Requisitos](#requisitos)
- [Instalação e execução](#instalação-e-execução)
- [Scripts](#scripts)
- [Arquitetura](#arquitetura)
- [Fluxo de uma sessão](#fluxo-de-uma-sessão)
- [Segurança e privacidade](#segurança-e-privacidade)
- [Onde ficam os dados](#onde-ficam-os-dados)
- [Testes](#testes)
- [Documentação](#documentação)
- [Limitações conhecidas](#limitações-conhecidas)
- [Solução de problemas](#solução-de-problemas)
- [Licença e uso](#licença-e-uso)

---

## Recursos

### Store de serviços
Catálogo visual de portais — serviços embutidos e **serviços personalizados** ("Novo site") com URL HTTPS e domínios permitidos, cada um com logomarca, autenticação preferencial e receita de login assistido.

### Clientes PF e PJ
Cadastro completo com validação de CPF/CNPJ, consentimento, tags, arquivamento, exportação CSV, campo de honorários (moeda) e **relatórios em PDF com modelo timbrado**: lista de clientes (somente nomes ou nomes + honorários) e relatório por cliente (dados, honorários, observações, credenciais sem senhas e certificados).

### Certificados digitais A1
Importação de PFX/P12 ou do repositório do Windows (`Cert:\CurrentUser\My`), com validação de senha, titular, validade e impressão digital. **Vínculo certificado–cliente** com consentimento, possibilidade de um certificado atender mais de um cliente, teste de injeção mTLS, instalação/remoção no repositório do Windows e backup `.pvbackup` protegido por frase-senha. A cadeia ICP-Brasil não é validada ativamente — o handshake depende do repositório do Windows.

### Assinatura digital de PDFs (PAdES-B-T)
Assine PDFs em lote com o **mesmo certificado A1 do cofre** — sem instalar nada, sem o documento sair da estação:

- Assinatura **qualificada** com validade jurídica (Lei 14.063/2020), `SubFilter = ETSI.CAdES.detached`, SHA-256;
- **Carimbo de tempo RFC 3161** sobre o valor da assinatura (TSA configurável — padrão DigiCert pública; fail-closed se indisponível);
- **Assinatura incremental** (`@signpdf/signpdf`) que preserva assinaturas preexistentes;
- Carimbo visual em pt-BR desenhado com `pdf-lib`, com **posição livre via drag-and-drop** sobre o preview (`pdfjs-dist`);
- Documento original **nunca é sobrescrito** (`<nome>-assinado.pdf`, sufixo `(2)`, `(3)`…); limite de 50 MB; auditoria `pdf.signed` / `pdf.sign_failed` sem dados sensíveis.

### Obrigações recorrentes
Catálogo de obrigações (SPED, DCTF, FGTS, eSocial…), **matriz de vínculos Cliente × Obrigação**, departamentos, grupos reutilizáveis, cópia e colagem de vínculos entre clientes e **avisos de vencimento** na central de avisos (scheduler local).

### Credenciais por cliente e serviço
Senha criptografada no cofre, geração segura, revelação temporária, cópia com limpeza automática da área de transferência e **detecção de reutilização** de senhas.

### Sessões isoladas por cliente e certificado
Janelas próprias com partições persistentes do Chromium (`persist:client:<id>[:cert:<id>]`), **allowlist de domínios** e **seleção explícita do certificado** no handshake TLS. O evento `select-client-certificate` só aceita o certificado daquela sessão, apenas para hosts `.gov.br` ou para os domínios da allowlist do serviço — sem correspondência, a autenticação é cancelada e auditada.

### Login assistido
Receitas de login por serviço, geradas automaticamente no cadastro: preenchimento de usuário/senha, envio **sempre manual por padrão**, detecção de login, captcha e segundo fator.

### Auditoria local
Registro de eventos sensíveis com filtros e exportação CSV/JSON — com *redaction* de senhas, tokens, cookies, PFX e chaves.

### Segurança em profundidade
`contextIsolation`, `sandbox`, `nodeIntegration` desativado, CSP restritiva, protocolo interno `app://`, IPC validado com Zod e permissões de mídia negadas. Segredos e PFX cifrados com **AES-256-GCM**; chave-mestra protegida pelo **DPAPI** do Windows (`safeStorage`).

---

## Portais embutidos

| Portal | Categoria | Autenticação |
| --- | --- | --- |
| gov.br | Hub federal | Certificado / Senha |
| Redesim | Empresas | Certificado |
| e-CAC (Receita Federal) | Fiscal | Certificado / Senha |
| JUcec-CE | Junta Comercial | Certificado |
| eSocial | Trabalhista | Certificado |
| DET Trabalhista | Trabalhista | Senha |
| FGTS Digital | Trabalhista | Certificado |
| eSocial — pendências Receita (CNPJ) | Fiscal | Certificado |
| Simples Nacional | Fiscal | Certificado / Senha |
| Registrato (Banco Central) | Financeiro | Certificado |
| SIGA SEFAZ-CE | Estadual | Certificado / Senha |
| DTE SEFAZ-CE | Estadual | Certificado |

Novos portais podem ser cadastrados em **Configurações → Novo site** (URL HTTPS + domínios permitidos + receita de login).

---

## Requisitos

| Item | Requisito |
| --- | --- |
| Sistema operacional | Windows 10 ou 11, x64 |
| Node.js | 22 ou superior |
| npm | Incluído com o Node.js |
| PowerShell | Windows PowerShell 5.1 (`powershell.exe`) — leitura e instalação de certificados |
| Repositório de certificados | `Cert:\CurrentUser\My`; **não** é necessário executar como administrador |
| Certificado | A1 em PFX/P12, válido e com chave privada |
| Rede | Acesso aos portais; a verificação de atualizações é opcional e depende de um servidor configurado |

O projeto usa `better-sqlite3` com binários pré-compilados para Windows x64. O `postinstall` apenas verifica se o binário nativo está presente — nenhuma compilação nativa é necessária na instalação.

---

## Instalação e execução

```powershell
npm install
npm run dev
```

`npm run dev` sobe o renderer Next.js na porta **3000**, recompila o processo principal com `tsup --watch` e abre o Electron quando ambos estiverem prontos.

**Versão compilada:**

```powershell
npm run build
npm start
```

**Instalador NSIS:**

```powershell
npm run dist
```

O instalador é gravado em `dist/`. A configuração atual espera um ícone em `build/icon.ico`; sem esse arquivo, o empacotamento pode falhar. A URL de atualização em `electron-builder.yml` é um placeholder (`updates.aurumbit.invalid`) e deve ser substituída antes de distribuir o aplicativo.

---

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | Renderer + processo principal + Electron em modo de desenvolvimento. |
| `npm run dev:renderer` | Apenas o Next.js em `http://localhost:3000`. |
| `npm run dev:main` | Compila o processo principal e o preload em modo watch. |
| `npm run dev:electron` | Abre o Electron apontando para o renderer de desenvolvimento. |
| `npm run build` | Compila o renderer (export estático) e o processo principal. |
| `npm run build:renderer` | Gera o export estático do Next.js em `out/`. |
| `npm run build:main` | Gera `dist-electron/main.cjs`, `preload.cjs` e workers. |
| `npm start` | Abre o Electron usando os artefatos já compilados. |
| `npm run typecheck` | Verifica os dois `tsconfig` sem emitir arquivos. |
| `npm run lint` | Executa o ESLint. |
| `npm run format` / `format:check` | Formata (ou verifica) o repositório com Prettier. |
| `npm test` | Testes unitários com Vitest. |
| `npm run test:watch` | Testes unitários em modo watch. |
| `npm run test:coverage` | Cobertura de testes. |
| `npm run test:e2e` | Compila o aplicativo e executa os testes Playwright/Electron. |
| `npm run test:e2e:ui` | Interface do Playwright. |
| `npm run db:generate` | Gera artefatos do Drizzle Kit. |
| `npm run spike` | Diagnóstico não invasivo do spike Windows A1. |
| `npm run spike:certs` | Gera um PFX autoassinado de teste (não instala nada). |
| `npm run dist` | Instalador NSIS x64. |
| `npm run dist:dir` | Aplicação empacotada sem instalador. |
| `npm run postinstall` | Verifica o binário nativo do `better-sqlite3`. |

### Diagnóstico do spike A1

```powershell
# Somente leitura: não altera o repositório de certificados
npm run spike -- --check-only

# Relatório em JSON para anexar ao resultado do spike
npm run spike -- --check-only --json

# Usar uma pasta de dados alternativa
npm run spike -- --check-only --user-data "C:\caminho\userData"

# Gerar um PFX de teste (não instala no Windows)
npm run spike:certs -- --password "TesteA1!2026"
```

Consulte [docs/SPIKE_GO_NO_GO.md](docs/SPIKE_GO_NO_GO.md) para o plano completo, critérios de decisão, comandos e modelo de resultados.

---

## Arquitetura

```text
┌──────────────────────────────────────────────────────────────────┐
│ Electron main (Node.js)                                          │
│  ├─ SQLite + Drizzle (clientes, certificados, credenciais, ...)  │
│  ├─ VaultService (AES-256-GCM) + SafeStorageKeyStore (DPAPI)     │
│  ├─ CertificateService (PFX, Windows store, testes mTLS)         │
│  ├─ SessionManager (partições, janelas, allowlist, downloads)    │
│  ├─ Assinatura PAdES (workers isolados de PDF e PFX)             │
│  ├─ ObligationsScheduler (avisos de vencimento)                  │
│  ├─ IPC validado com Zod + auditoria + redaction                 │
│  └─ Protocolo app:// + CSP                                       │
└───────────────┬──────────────────────────────────────────────────┘
                │ preload com contextBridge (API tipada)
┌───────────────▼──────────────────────────────────────────────────┐
│ Renderer Next.js (export estático em out/)                       │
│  └─ Store · Clientes · Obrigações · Certificados · Assinaturas   │
│     · Sessões · Auditoria · Configurações                        │
└───────────────┬──────────────────────────────────────────────────┘
                │ WebContentsView com partição isolada
┌───────────────▼──────────────────────────────────────────────────┐
│ Portal remoto (HTTPS)                                            │
│  └─ Sessão por cliente/certificado + seleção explícita no TLS    │
└──────────────────────────────────────────────────────────────────┘
```

### Estrutura de pastas

```text
electron/
  main/            processo principal: banco, cofre, certificados,
                   sessões, assinatura PDF, obrigações e IPC
  preload/         ponte segura entre main e renderer
shared/            contratos, tipos, validações (Zod), serviços
                   embutidos, regras de obrigações e constantes
src/               interface Next.js (App Router) e componentes
  app/             rotas: Store, clientes, obrigações, certificados,
                   assinaturas, sessões, auditoria, configurações
  components/      ui, app-shell, obligations, certificates, ...
tests/             testes unitários (Vitest) e E2E (Playwright)
scripts/           postinstall e scripts do spike Windows A1
docs/              documentação, políticas, guias e ADRs
assets/            logomarcas utilizadas nos documentos em PDF
```

Decisões estruturantes registradas em [docs/adr/](docs/adr/README.md):
[0001 — local-only](docs/adr/0001-local-only-architecture.md) ·
[0002 — Electron + Next.js static export](docs/adr/0002-electron-nextjs-static-export.md) ·
[0003 — isolamento de sessão e seleção de certificado](docs/adr/0003-session-isolation-and-certificate-selection.md) ·
[0004 — DPAPI + AES-256-GCM](docs/adr/0004-vault-dpapi-aes-gcm.md) ·
[0005 — tratamento de segredos](docs/adr/0005-secrets-encryption.md) ·
[0006 — URLs gov.br SSO](docs/adr/0006-gov-sso-certificate-urls.md) ·
[0007 — CNPJ lookup com opt-in](docs/adr/0007-external-cnpj-lookup-opt-in.md) ·
[0008 — assinatura PAdES-B-T](docs/adr/0008-pdf-signature-pades.md)

---

## Fluxo de uma sessão

1. O renderer envia `sessions:open` com serviço, cliente, método de autenticação e certificado ou credencial.
2. O processo principal valida o pedido com Zod, confirma o vínculo e o status do certificado, instala o PFX no repositório do Windows se necessário e monta a partição `persist:client:<id>[:cert:<id>]`.
3. Uma janela Electron abre o portal em um `WebContentsView` isolado.
4. No handshake TLS, o evento `select-client-certificate` só aceita o certificado daquela sessão e apenas para hosts `.gov.br` ou para os domínios da allowlist do serviço. Sem correspondência, a autenticação é cancelada e auditada.
5. A automação de login pode preencher usuário e senha, mas o envio é **sempre manual por padrão**.
6. Ao fechar a janela, a sessão é marcada como encerrada. A partição persistente **não** é apagada automaticamente.

---

## Segurança e privacidade

- **Local-only** ([ADR 0001](docs/adr/0001-local-only-architecture.md)): nenhum dado é sincronizado com nuvem; não há telemetria.
- Segredos e PFX cifrados com **AES-256-GCM**; chave-mestra protegida pelo **DPAPI** do Windows. O banco **não** é integralmente criptografado — apenas os campos sensíveis.
- O renderer não tem acesso a Node.js, `require` ou `process`; toda operação passa pelo preload e pelo IPC validado com Zod.
- Permissões de câmera, microfone, geolocalização e notificações são negadas. Downloads de executáveis e scripts perigosos são bloqueados.
- URLs fora da allowlist são bloqueadas; links externos exigem confirmação quando a opção está ativa.
- **A3/PIN não é suportado**: o aplicativo nunca solicita nem armazena PIN de token.
- Logs e auditoria passam por *redaction* de senhas, tokens, cookies, PFX e chaves.
- Consulta externa de CNPJ (BrasilAPI) é **opt-in** e auditada ([ADR 0007](docs/adr/0007-external-cnpj-lookup-opt-in.md)).
- Assinatura de PDF usa o PFX do cofre em **worker isolado**; o documento nunca trafega pela rede — somente o hash vai à TSA ([ADR 0008](docs/adr/0008-pdf-signature-pades.md)).

Leia [docs/SECURITY.md](docs/SECURITY.md) e [docs/PRIVACY.md](docs/PRIVACY.md) antes de usar em produção.

---

## Onde ficam os dados

Por padrão, em `%APPDATA%\AurumBit Portal`:

| Caminho | Conteúdo |
| --- | --- |
| `aurumbit-portal.db` | Banco SQLite com cadastros, sessões, auditoria e preferências. |
| `aurumbit-portal.db-wal` | WAL do SQLite; pode conter dados recentes. |
| `vault.key` | Chave-mestra cifrada pelo DPAPI. |
| `logs\aurumbit-portal.log` | Logs rotativos de até 10 MB. |
| `Partitions\` | Armazenamento das sessões persistentes do Chromium. |

Para uma instalação limpa, feche o aplicativo e remova a pasta `%APPDATA%\AurumBit Portal`. Isso apaga cadastros, certificados do cofre, auditoria e sessões. **Faça backup antes.**

---

## Testes

```powershell
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run test:e2e
```

Os testes unitários cobrem criptografia do cofre, parsing de PFX, seleção de certificado, partições, contratos, receitas, redaction e geometria do carimbo de assinatura. Os testes E2E abrem o Electron com uma pasta de dados temporária, validam a fronteira de segurança, CRUD pela API, autofill assistido, envio manual e isolamento de sessão.

---

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [Guia do usuário](docs/USER_GUIDE.md) | Uso completo, tela a tela. |
| [Segurança](docs/SECURITY.md) | Modelo de ameaça e controles. |
| [Privacidade e LGPD](docs/PRIVACY.md) | Tratamento de dados pessoais. |
| [Termos de uso](docs/TERMS.md) | Condições de uso restrito. |
| [Suporte](docs/SUPPORT.md) | Canais e procedimentos. |
| [Spike Windows A1: go/no-go](docs/SPIKE_GO_NO_GO.md) | Plano de decisão do certificado A1. |
| [ADRs](docs/adr/README.md) | Decisões de arquitetura. |
| [Sistema de cores](docs/COLOR_SYSTEM.md) · [Sistema de movimento](docs/motion-system.md) | Design system da interface. |

---

## Limitações conhecidas

- Somente **Windows x64**; não há suporte a macOS ou Linux.
- Certificados **A3, token, smart card e PIN** não são suportados.
- `idleLockMinutes` e `retainAuditDays` existem nas configurações, mas **não há bloqueio automático por inatividade nem purga automática da auditoria** nesta versão. O bloqueio manual encerra as sessões, mas não exige senha para reabrir o aplicativo.
- Sessões usam partições persistentes: cookies e storage continuam no disco após fechar a janela. O aplicativo não oferece limpeza automática por sessão.
- A remoção de certificado atua somente em `Cert:\CurrentUser\My`.
- O status `chain_incomplete` existe no modelo e no filtro da interface, mas a versão 0.1.x não calcula a cadeia ICP-Brasil ativamente. A validação efetiva ocorre no handshake do Windows/portal.
- O teste de injeção usa um servidor mTLS local. Verifica se o Windows/Chromium apresenta o certificado no handshake, mas não valida a cadeia nem garante que um portal específico o aceitará.
- A verificação de atualizações está desabilitada em desenvolvimento e depende de um servidor de updates válido no aplicativo empacotado.
- Não há backup automático do banco. Backups de certificado PFX são exportados individualmente como `.pvbackup`, protegidos por frase-senha; a versão 0.1.x não importa/restaura esse envelope pela interface. Preserve também o PFX original.
- Assinatura de PDF: sem suporte a PDF com senha, 1 assinatura por vez (fila), limite de 50 MB, e o TSA padrão (DigiCert pública) não tem SLA — pode ser substituído por uma TSA ICP-Brasil credenciada em Configurações.

---

## Solução de problemas

| Sintoma | Ação |
| --- | --- |
| `safeStorage/DPAPI indisponível` | Execute com o mesmo usuário do Windows que criou o cofre; verifique políticas de segurança e o perfil. Não copie apenas `vault.key` para outra máquina. |
| PowerShell não encontrado | Confirme `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` e as políticas de execução. |
| Certificado não oferecido | Confirme instalação em `CurrentUser\My`, chave privada, validade, cadeia ICP-Brasil e vínculo com o cliente. |
| Portal recusa por cadeia incompleta | Instale os certificados da cadeia ICP-Brasil no repositório do Windows e repita o teste. |
| Senha do PFX incorreta | Verifique maiúsculas/minúsculas e o layout do teclado; o aplicativo não armazena a senha em texto claro. |
| Assinatura PAdES falha | Verifique a validade do certificado, a URL da TSA (botão "Testar TSA" em Configurações) e se o PDF tem senha (não suportado). |
| Aplicativo não abre | Consulte `%APPDATA%\AurumBit Portal\logs\aurumbit-portal.log` e execute `npm run spike -- --check-only`. |
| Atualização indisponível | Esperado enquanto a URL de updates for placeholder ou em modo de desenvolvimento. |
| Limite de sessões | Ajuste em Configurações (2 a 40) ou feche sessões existentes. |

Mais detalhes em [docs/SUPPORT.md](docs/SUPPORT.md).

---

## Licença e uso

Projeto **privado**, sem licença pública declarada neste repositório. O uso é restrito à organização responsável. Consulte [docs/TERMS.md](docs/TERMS.md).

<div align="center">

---

**AurumBit Portal** — © 2026 AurumBit Portal · Feito para quem opera **portais públicos brasileiros** em escala.

</div>
