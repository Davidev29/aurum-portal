<div align="center">

<img src="public/Logomarca%20da%20empresa.png" alt="AurumBit Portal" width="280" />

# AurumBit Portal

**Cofre de acessos e sessões isoladas para portais públicos brasileiros.**

Clientes, credenciais e certificados digitais A1 em um único lugar — com sessões
isoladas por cliente e certificado, seleção explícita no handshake TLS e um cofre
local criptografado para todos os segredos.

[![CI](https://github.com/Davidev29/aurum-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/Davidev29/aurum-portal/actions/workflows/ci.yml)
[![Versão](https://img.shields.io/badge/versão-0.1.0-c9a24b?style=flat-square&logoColor=white)](package.json)
[![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11%20x64-1a1a1a?style=flat-square&logo=windows)](#requisitos)
[![Node](https://img.shields.io/badge/Node.js-%E2%89%A5%2022-339933?style=flat-square&logo=node.js&logoColor=white)](#requisitos)
[![Stack](https://img.shields.io/badge/Electron%2045%20·%20Next.js%2016%20·%20React%2019-1a1a1a?style=flat-square)](#arquitetura)
[![Licença](https://img.shields.io/badge/licença-privado%20·%20uso%20restrito-8a8a8a?style=flat-square)](docs/TERMS.md)

[Recursos](#recursos) · [Destaques 0.1](#destaques-01) · [Instalação](#instalação-e-execução) · [Arquitetura](#arquitetura) · [Segurança](#segurança-e-privacidade) · [Testes](#testes) · [Documentação](#documentação)

</div>

---

## Sobre

O **AurumBit Portal** é um aplicativo desktop para Windows que organiza **clientes,
credenciais e certificados digitais A1** e abre **portais públicos brasileiros** em
sessões isoladas — com seleção explícita do certificado no handshake TLS e um cofre
local criptografado para todos os segredos.

É feito para quem opera **portais públicos em escala**: escritórios de contabilidade,
departamentos fiscais e escritórios de advocacia que abrem dezenas de portais por dia,
para dezenas de clientes, no certificado certo, para a pessoa certa.

> **Escopo 0.1.0** — uso local, por um único usuário do Windows. Certificados **A1**
> (PFX/P12) com senha. **A3, token, smart card e PIN não são suportados.** Sem
> sincronização com nuvem e sem telemetria — a única comunicação opcional é a
> verificação de atualizações contra o servidor configurado (desabilitada por padrão).

---

## Destaques 0.1

- **Visão mensal de obrigações** — o mês corrente do escritório em uma tela: competências por
  cliente, baixas (entregas) diretamente no calendário, legenda por situação, alertas de
  vencimento e feriados com ícone e cor personalizados.
- **Assinatura digital de PDFs (PAdES-B-T)** — lote com o certificado A1 do cofre, carimbo
  premium responsivo (o bloco adota o retângulo desenhado, como o Adobe Reader), posição
  livre via arrastar-e-soltar sobre o preview, marca d'água biométrica e carimbo de tempo
  RFC 3161 obrigatório (*fail-closed*).
- **Workflow pesado validado** — suíte de stress dedicada e testes E2E com volume (ver
  [Testes](#testes)); *fail-closed* por toda parte.

---

## Recursos

### Store de serviços
Catálogo visual de portais — serviços embutidos e **serviços personalizados** ("Novo site")
com URL HTTPS, domínios permitidos, logomarca, autenticação preferencial e receita de login
assistido.

### Clientes PF e PJ
Cadastro completo com validação de CPF/CNPJ, consentimento, tags, arquivamento, exportação
CSV, campo de honorários (moeda) e **relatórios em PDF com modelo timbrado**: lista de
clientes (somente nomes ou nomes + honorários) e relatório por cliente (dados, honorários,
observações, credenciais sem senhas e certificados).

### Certificados digitais A1
Importação de PFX/P12 ou do repositório do Windows (`Cert:\CurrentUser\My`), com validação
de senha, titular, validade e impressão digital. **Vínculo certificado↔cliente** com
consentimento, um certificado para vários clientes, teste de injeção mTLS, instalação/
remoção no repositório do Windows e backup `.pvbackup` protegido por frase-senha. A cadeia
ICP-Brasil não é validada ativamente — o handshake depende do repositório do Windows.

### Assinatura digital de PDFs (PAdES-B-T)
Assine PDFs em lote com o **mesmo certificado A1 do cofre** — sem instalar nada e sem o
documento sair da estação:

- Assinatura **qualificada** com validade jurídica (Lei 14.063/2020), `SubFilter = ETSI.CAdES.detached`, SHA-256;
- **Carimbo de tempo RFC 3161** obrigatório (*fail-closed*) — padrão DigiCert pública; a
  assinatura é bloqueada se a TSA estiver indisponível. A seção de configuração da TSA
  está oculta na interface na 0.1.0 (a TSA é escolhida/validada no código).
- **Assinatura incremental** (`@signpdf/signpdf`) que preserva assinaturas preexistentes;
- Carimbo visual em pt-BR desenhado com `pdf-lib`, escala proporcional ao retângulo
  desenhado, **posição livre via drag-and-drop** sobre o preview (`pdfjs-dist`);
- O documento original **nunca é sobrescrito** (`<nome>-assinado.pdf`, sufixo `(2)`, `(3)`…);
  limite de 50 MB; auditoria `pdf.signed` / `pdf.sign_failed` sem dados sensíveis.

### Obrigações recorrentes — visão mensal
Catálogo de obrigações (SPED, DCTF, FGTS, eSocial…), **matriz cliente × obrigação**,
departamentos, grupos reutilizáveis, cópia/colagem entre clientes, **agenda do mês com
baixa por competência** e **avisos de vencimento** na central de avisos (agendador local).
Feriados nacionais e extras com apresentação personalizada (ícone e cor).

### Credenciais por cliente e serviço
Senha criptografada no cofre, geração segura, revelação temporária, cópia com limpeza
automática da área de transferência e **detecção de reutilização** de senhas.

### Sessões isoladas por cliente e certificado
Janelas próprias com partições persistentes do Chromium (`persist:client:<id>[:cert:<id>]`),
**allowlist de domínios** e **seleção explícita do certificado** no handshake TLS. O evento
`select-client-certificate` só aceita o certificado daquela sessão, apenas para hosts
`.gov.br` ou para os domínios do serviço — sem correspondência, a autenticação é cancelada
e auditada.

### Login assistido
Receitas de login por serviço, geradas automaticamente no cadastro: preenchimento de
usuário/senha, detecção de login, captcha e segundo fator. Nos serviços de senha gerados
automaticamente, a automação clica em **Entrar sozinho** por padrão — desligue no cadastro
do serviço ("Entrar sozinho") para revisar o preenchimento antes de enviar.

### Auditoria local
Registro de eventos sensíveis com filtros e exportação CSV/JSON — com *redaction* de
senhas, tokens, cookies, PFX e chaves.

### Segurança em profundidade
`contextIsolation`, `sandbox`, `nodeIntegration` desativado, CSP restritiva, protocolo
interno `app://`, IPC validado com Zod e permissões de mídia negadas. Segredos e PFX
cifrados com **AES-256-GCM**; chave-mestra protegida pelo **DPAPI** do Windows (`safeStorage`).

---

## Portais embutidos

Todos os 12 portais nacionais/estaduais aceitam os dois métodos (**certificado + senha**,
padrão **certificado**):

| Portal | Categoria |
| --- | --- |
| gov.br | Governo Federal |
| Redesim | Governo Federal |
| e-CAC | Governo Federal |
| JUcec-CE | Governo Estadual |
| Pendências CNPJ | Governo Federal |
| FGTS Digital | Governo Federal |
| eSocial | Governo Federal |
| DTE Trabalhista | Governo Federal |
| Simples Nacional | Governo Federal |
| Registrato | Governo Federal |
| SIGA SEFAZ-CE | Governo Estadual |
| DTE SEFAZ-CE | Governo Estadual |

Também embutidos: **10 portais municipais SpeedGov (ISS/NFS-e)** — Tianguá, Juazeiro do
Norte, Tauá, Itarema, Pindoretama, Limoeiro do Norte, Sobral, Crateús, Icapuí e Paracuru
(categoria **Prefeituras**, autenticação por **senha do município**, "Entrar sozinho"
ativo).

No total, **22 serviços embutidos**. Novos portais podem ser cadastrados em
**Configurações › Novo site** (URL HTTPS + domínios permitidos + receita de login).

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
| Rede | Acesso aos portais; a verificação de atualizações é opcional e depende de servidor configurado |

_O projeto usa `better-sqlite3` com binários pré-compilados para Windows x64; o `postinstall` apenas verifica a presença do binário nativo._

---

## Instalação e execução

```powershell
npm install
npm run dev
```

`npm run dev` sobe o renderer Next.js na porta **3000**, recompila o processo principal com
`tsup --watch` e abre o Electron quando ambos estiverem prontos.

**Versão compilada:**

```powershell
npm run build
npm start
```

**Instalador NSIS:** `npm run dist` (grava em `dist/`). A URL de atualizações em
`electron-builder.yml` é um placeholder (`updates.aurumbit.invalid`) e deve ser
substituída antes de distribuir.

---

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run dev` | Renderer + processo principal + Electron em desenvolvimento. |
| `npm run build` / `start` | Compila renderer (export estático) + main, e abre o artefato. |
| `npm run typecheck` | `tsc --noEmit` nos dois `tsconfig`. |
| `npm run lint` | ESLint. |
| `npm test` | 497 testes unitários (Vitest). |
| `npm run test:stress` | Suíte de stress/carga (`tests/stress/`) — fora do `npm test`. Ver [fluxo agêntico](docs/qa/QA-STRESS-AGENTIC-FLOW.md) e [relatório](docs/qa/QA-STRESS-REPORT.md). |
| `npm run test:coverage` | Cobertura de testes. |
| `npm run test:e2e` | Compila e executa os testes Playwright/Electron. |
| `npm run db:generate` | Gera artefatos do Drizzle Kit. |
| `npm run dist` / `dist:dir` | Instalador NSIS x64 / empacotado sem instalador. |

Diagnóstico do spike A1 (somente leitura): `npm run spike -- --check-only` ·
`npm run spike:certs -- --password "TesteA1!2026"` · ver [docs/SPIKE_GO_NO_GO.md](docs/SPIKE_GO_NO_GO.md).

---

## Arquitetura

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main (Node.js)                                      │
│  ├─ SQLite + Drizzle (clientes, certificados, credenciais…)  │
│  ├─ VaultService (AES-256-GCM) + chave-mestra via DPAPI      │
│  ├─ CertificateService (PFX, loja do Windows, injeção mTLS)  │
│  ├─ SessionManager (partições, allowlist, downloads)         │
│  ├─ Assinatura PAdES (workers isolados de PDF e PFX)         │
│  ├─ ObligationsScheduler (avisos de vencimento)              │
│  ├─ IPC validado com Zod + auditoria + redaction             │
│  └─ Protocolo app:// + CSP                                   │
└──────────────────────────────────────────────────────────────┘
                │ preload com contextBridge (API tipada)
┌──────────────────────────────────────────────────────────────┐
│ Renderer Next.js (export estático em out/)                   │
│  → Store · Clientes · Obrigações · Certificados · Assinaturas│
│    Sessões · Auditoria · Configurações                       │
└──────────────────────────────────────────────────────────────┘
                │ WebContentsView com partição isolada
┌──────────────────────────────────────────────────────────────┐
│ Portal remoto (HTTPS) — sessão por cliente/certificado       │
└──────────────────────────────────────────────────────────────┘
```

Decisões estruturantes em [docs/adr/](docs/adr/README.md):
[0001 local-only](docs/adr/0001-local-only-architecture.md) ·
[0002 Electron + Next export](docs/adr/0002-electron-nextjs-static-export.md) ·
[0003 isolamento de sessão](docs/adr/0003-session-isolation-and-certificate-selection.md) ·
[0004 DPAPI + AES-256-GCM](docs/adr/0004-vault-dpapi-aes-gcm.md) ·
[0005 segredos](docs/adr/0005-secrets-encryption.md) ·
[0006 SSO gov.br](docs/adr/0006-gov-sso-certificate-urls.md) ·
[0007 CNPJ opt-in](docs/adr/0007-external-cnpj-lookup-opt-in.md) ·
[0008 PAdES-B-T](docs/adr/0008-pdf-signature-pades.md).

---

## Segurança e privacidade

- **Local-only** ([ADR 0001](docs/adr/0001-local-only-architecture.md)) — nenhum dado sai da estação; sem telemetria.
- Segredos e PFX cifrados com **AES-256-GCM**; chave-mestra protegida pelo **DPAPI** do Windows. O banco **não** é integralmente criptografado — apenas os campos sensíveis.
- O renderer não tem acesso a Node.js; toda operação passa pelo preload e pelo IPC validado com Zod.
- Permissões de câmera, microfone, geolocalização e notificações são negadas; downloads executáveis/scripts bloqueados.
- URLs fora da allowlist são bloqueadas; links externos exigem confirmação quando a opção estiver ativa.
- **A3/PIN nunca é solicitado nem armazenado.**
- Logs e auditoria passam por *redaction* de senhas, tokens, cookies, PFX e chaves.
- Consulta externa de CNPJ (BrasilAPI) é **opt-in** e auditada ([ADR 0007](docs/adr/0007-external-cnpj-lookup-opt-in.md)).
- A assinatura usa o PFX do cofre em **worker isolado**; o documento nunca trafega pela rede — somente o hash vai à TSA.

Leia [docs/SECURITY.md](docs/SECURITY.md) e [docs/PRIVACY.md](docs/PRIVACY.md) antes de uso em produção.

---

## Testes

```powershell
npm run typecheck
npm run lint
npm test                # 497/497 unitários
npm run test:stress     # 15/15 — carga e fluxo pesado
npm run test:e2e        # build + Playwright/Electron
```

Cobertura: cofre/criptografia, parsing de PFX, seleção de certificado, partições,
contratos, receitas, redaction, geometria do carimbo e **stress de fluxo pesado**
(seed de 500 clientes, 400 credenciais com detecção de reúso, matriz de obrigações
60 × 15 com agendador e deduplicação, PAdES em lote, E2E com volume via UI).
Detalhes e evidências em [docs/qa/QA-STRESS-REPORT.md](docs/qa/QA-STRESS-REPORT.md) —
veredicto **APPROVED**.

---

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [Guia do usuário](docs/USER_GUIDE.md) | Uso completo, tela a tela. |
| [Relatório de QA / stress](docs/qa/QA-STRESS-REPORT.md) | Evidências, métricas e veredicto. |
| [Fluxo agêntico de QA](docs/qa/QA-STRESS-AGENTIC-FLOW.md) | Metodologia do QA agentico. |
| [Segurança](docs/SECURITY.md) · [Privacidade](docs/PRIVACY.md) · [Termos](docs/TERMS.md) · [Suporte](docs/SUPPORT.md) | Modelo de ameaça, LGPD e políticas. |
| [Spike Windows A1: go/no-go](docs/SPIKE_GO_NO_GO.md) | Decisão do certificado A1. |
| [ADRs](docs/adr/README.md) | Decisões de arquitetura. |
| [Sistema de cores](docs/COLOR_SYSTEM.md) · [Movimento](docs/motion-system.md) | Design system da interface. |

---

## Limitações conhecidas

- Somente **Windows x64**; sem suporte a macOS ou Linux.
- **A3, token, smart card e PIN não são suportados.**
- `idleLockMinutes` e `retainAuditDays` existem nas configurações, mas **não há bloqueio automático por inatividade nem purga automática da auditoria** nesta versão.
- Partições persistentes mantêm cookies no disco após fechar a janela; não há limpeza automática por sessão.
- A remoção de certificado atua somente em `Cert:\CurrentUser\My`.
- O status `chain_incomplete` existe no modelo e no filtro, mas a versão 0.1.x não calcula a cadeia ICP-Brasil ativamente — a validação efetiva ocorre no handshake do Windows/portal.
- O teste de injeção usa servidor mTLS local: confirma que o Windows/Chromium apresenta o certificado — não valida a cadeia nem garante aceitação por um portal específico.
- Assinatura de PDF: sem suporte a PDF com senha, 1 assinatura por vez (fila), limite de 50 MB e o TSA padrão (DigiCert pública) não tem SLA.
- Sem backup automático do banco; backups de PFX são exportados individualmente como `.pvbackup` (a 0.1.x não importa/restaura envelope pela interface).

---

## Solução de problemas

| Sintoma | Ação |
| --- | --- |
| `safeStorage/DPAPI indisponível` | Execute com o mesmo usuário do Windows que criou o cofre; não copie só o `vault.key`. |
| PowerShell não encontrado | Confirme `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`. |
| Certificado não oferecido | Confira instalação em `CurrentUser\My`, chave privada, validade, cadeia ICP-Brasil e vínculo com o cliente. |
| Portal recusa por cadeia incompleta | Instale a cadeia ICP-Brasil no repositório do Windows e repita o teste. |
| Senha do PFX incorreta | Layout do teclado e maiúsculas/minúsculas; o app não armazena a senha em claro. |
| Assinatura PAdES falha | Validade do certificado, URL da TSA (botão "Testar TSA" em Configurações) e se o PDF tem senha. |
| Aplicativo não abre | Consulte `%APPDATA%\AurumBit Portal\logs\aurumbit-portal.log` e `npm run spike -- --check-only`. |
| Limite de sessões | Ajuste em Configurações (2 a 40) ou feche sessões existentes. |

Mais detalhes em [docs/SUPPORT.md](docs/SUPPORT.md).

---

## Licença e uso

Projeto **privado**, sem licença pública declarada. Uso restrito à organização responsável.
Consulte [docs/TERMS.md](docs/TERMS.md).

<div align="center">

---

**AurumBit Portal** — para quem opera **portais públicos brasileiros** em escala.

</div>
