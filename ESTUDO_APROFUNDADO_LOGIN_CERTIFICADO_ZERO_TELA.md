# Estudo Aprofundado — Login por Certificado Digital com Entrega de Sessão Já Logada

**Aplicação:** AurumBit Portal ("AurumBit Portal") — *Cofre de acessos gov.br*  
**Problema:** A janela de sessão abria a URL do portal (ex.: e-CAC) sem nenhum mascaramento. O usuário via a tela intermediária de "Entrar com gov.br" antes do robô clicar e injetar o certificado.  
**Objetivo:** Entregar a janela do portal **já logada**, com um overlay de loading com micro interações cobrindo a transição, para que o usuário nunca veja tela de login.  
**Data:** 10/nov/2026

---

## 1. Diagnóstico — por que não estava entregando logado

### 1.1. Fluxo original (antes da correção)

```
1. Usuario clica no portal -> escolhe cliente -> escolhe certificado A1
   ↓
2. Janela isolada aberta (particao por cliente+certificado)
   ↓
3. view.webContents.loadURL(service.baseUrl)  <-- carrega o portal bruto
   ↓
4. did-finish-load dispara -> startRecipe(record)
   ↓
5. Receita executa waitFor/click nos seletores de certificado
   ↓
6. Electron injeta certificado via select-client-certificate (mTLS)
   ↓
7. postLogin detecta "Sair" -> authenticated
```

**Problemas identificados:**

| Problema | Impacto |
|----------|---------|
| Nenhum overlay de loading | O usuário vê a página bruta do portal (e-CAC com "Entrar com gov.br") |
| `evaluate` com timeout de apenas 2s | Muito curto para portais que carregam o botão de forma assíncrona |
| Apenas 1 tentativa de clique | Se o botão não estiver no DOM no primeiro `did-finish-load`, desiste |
| `optional: true` nos passos | Se falhar, segue em frente sem clicar |
| Sem fast-path agressivo | Mesmo com cookies salvos, a receita executava cliques desnecessários |

---

## 2. Pesquisa — melhor biblioteca para perfil de uso robotizado

### 2.1. Bibliotecas avaliadas

| Biblioteca | Vantagens | Desvantagens | Adequação |
|------------|-----------|--------------|-----------|
| **Playwright** | Automação robusta, suporte a múltiplos navegadores, contexto isolado, headless | Requer binários separados, mais pesado | Boa para testes E2E, não ideal para embutir em Electron |
| **Puppeteer** | Controle direto do Chrome, amplamente adotado, fácil de usar | Acoplado ao Chrome, menos flexível que Playwright | Boa, mas sobrepõe a arquitetura Electron existente |
| **Selenium WebDriver** | Padrão da indústria, suporte a muitos browsers | Lento, complexo de configurar, WebDriver overhead | Não adequado para desktop app |
| **Electron nativo (select-client-certificate)** | **Já integrado, injeta certificado no handshake TLS mTLS, sem dependências externas** | Requer certificado instalado no Windows | **Melhor escolha — já está na aplicação** |
| **Chrome DevTools Protocol (CDP)** | Controle granular do navegador, perfil de usuário persistente | Complexo, requer manter conexão CDP | Sobrepõe a solução Electron nativa |

### 2.2. Recomendação

**Manter a arquitetura Electron nativa** (`select-client-certificate` + `WebContentsView` com partição isolada). Isso já é a melhor abordagem porque:

- Injeta o certificado diretamente no handshake TLS mTLS (não depende de automação de UI para autenticar)
- Partição isolada por cliente+certificado (cookies não vazam entre sessões)
- Sem dependências externas adicionais
- Funciona com certificados A1 instalados no Windows

O que faltava era **mascarar a transição visual** com um overlay de loading e tornar a receita mais agressiva no clique automático.

---

## 3. Proposta de Correção — Fluxo Robotico "Zero Tela de Login"

### 3.1. Arquitetura da solução

```
┌─────────────────────────────────────────────────────────────────┐
│  Janela de Sessao Electron (WebContentsView)                    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  OVERLAY DE LOADING (injetado via evaluate)              │  │
│  │  [Logo] [Spinner]                                         │  │
│  │  "Autenticando sessão"                                    │  │
│  │  "Criptografando canal de comunicacao..."                 │  │
│  │  [progress bar 30%]                                       │  │
│  │  "Mantenha esta janela aberta..."                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Por baixo dos panos (invisível ao usuario):                    │
│  1. evaluate injeta JS -> clica em "Entrar com gov.br"         │
│  2. Servidor solicita certificado mTLS                          │
│  3. Electron injeta certificado A1 (select-client-certificate)  │
│  4. postLogin detecta "Sair" -> authenticated                   │
│  5. Overlay removido                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2. Arquivos modificados/criados

#### 3.2.1. NOVO: `electron/main/sessions/loading-overlay.ts`

Contém:
- `LOADING_STYLES` — CSS do overlay (fundo escuro, spinner, barra de progresso, tipografia)
- `LOADING_HTML(message, progress)` — HTML do overlay com mensagem e progresso dinâmicos
- `LOADING_MESSAGES` — 8 mensagens de progresso sequenciais:
  1. "Inicializando sessão isolada..."
  2. "Criptografando canal de comunicação..."
  3. "Validando certificado digital A1..."
  4. "Estabelecendo handshake mTLS..."
  5. "Apresentando certificado ao portal..."
  6. "Autenticando identidade no gov.br..."
  7. "Confirmando sessão ativa..."
  8. "Finalizando acesso..."
- `buildInjectScript()` — injeta o overlay no DOM via JavaScript
- `buildUpdateMessageScript()` — atualiza mensagem e barra de progresso
- `buildRemoveOverlayScript()` — remove o overlay e restaura visibilidade da página
- `buildIsAuthenticatedScript()` — verifica se seletores de pós-login ("Sair") estão visíveis

#### 3.2.2. MODIFICADO: `electron/main/sessions/manager.ts`

**Novos campos no `ManagedSession`:**
- `loadingOverlayInjected: boolean` — controle se o overlay foi injetado
- `loadingMessageIndex: number` — índice da mensagem atual
- `loadingProgress: number` — progresso (0-100)

**Novos imports:**
- `buildInjectScript`, `buildUpdateMessageScript`, `buildRemoveOverlayScript`, `buildIsAuthenticatedScript`, `LOADING_MESSAGES`

**Modificações no fluxo:**

1. **`did-start-loading`** — injeta o overlay na primeira navegação (apenas para sessões por certificado):
   ```ts
   if (!record.loadingOverlayInjected && record.authMethod === 'certificate') {
     await executeJavaScript(buildInjectScript(LOADING_MESSAGES[0], 10))
     record.loadingOverlayInjected = true
   }
   ```

2. **`did-finish-load`** — avança a mensagem de loading (índice +1, progresso +20, máximo 70%)

3. **`startRecipe`** — antes de executar `runRecipe`, atualiza o loading (índice +1, progresso +15, máximo 85%)

4. **`markAuthenticated`** — remove o overlay e define progresso em 100%

#### 3.2.3. MODIFICADO: `shared/builtins.ts`

**Script `AUTO_CLICK_CERT_SCRIPT` melhorado:**
- Percorre todos os `<a>`, `<button>`, `[role="button"]`, `<input type="submit">`
- Verifica se o elemento está visível (computed style + bounding rect)
- Clica em **todos** os botões que correspondem aos termos alvo (não para no primeiro)
- Retorna lista dos textos clicados

**Receita `certRecipeWithInterstitial` — 6 passos (agressiva):**

| Passo | Ação | Timeout | Obrigatório | Propósito |
|-------|------|---------|-------------|-----------|
| 1 | `evaluate` (AUTO_CLICK_CERT_SCRIPT) | 3s | Sim | Clica imediatamente no botão de certificado/gov.br |
| 2 | `waitFor` | 5s | Opcional | Fallback se evaluate não encontrou |
| 3 | `click` | 3s | Opcional | Clica novamente se encontrar |
| 4 | `sleep` | 2s | — | Pausa para o servidor disparar mTLS |
| 5 | `evaluate` (AUTO_CLICK_CERT_SCRIPT) | 3s | Sim | Segunda tentativa (portais assíncronos) |
| 6 | `sleep` | 1.5s | — | Estabilizar autenticação mTLS |

**Portais atualizados (todos os 10 com fluxo de certificado):**
gov.br, e-CAC, pendencias-cnpj, fgts-digital, esocial, det-trabalhista, siga-sefaz-ce, simples-nacional, registrato, dte-sefaz-ce

---

## 3.3. Fluxo Completo (Passo a Passo)

```
ETAPA 1: Clique no portal
  └─ Usuario escolhe cliente + certificado A1 no LaunchDialog
  └─ Chama aurumBitPortal().sessions.open({ authMethod: 'certificate', certificateId })

ETAPA 2: Criacao da janela isolada
  └─ SessionManager.open() cria BrowserWindow + WebContentsView
  └─ Particao isolada: persist:client:<clientId>:cert:<certificateId>
  └─ Contexto registrado com thumbprint SHA-256/SHA-1 do certificado

ETAPA 3: Carregamento da URL com overlay
  └─ did-start-loading -> injeta overlay via evaluate
  └─ Usuario ve: "Autenticando sessão" + spinner + mensagem 1 de 8
  └─ view.webContents.loadURL(service.baseUrl)

ETAPA 4: did-finish-load
  └─ Atualiza overlay: mensagem 2, progresso 30%
  └─ Inicia startRecipe()

ETAPA 5: Fast-path de detecção de login
  └─ checkPostLogin(procura por "Sair") com timeout 4s
  └─ Se ja tem cookies salvos -> markAuthenticated() -> OVERLAY REMOVIDO
  └─ Usuario ja esta logado, sem ver nenhuma tela intermediaria

ETAPA 6: Execucao da receita robotizada (se fast-path falhar)
  └─ Passo 1: evaluate injeta JS -> clica em "Entrar com gov.br"
  └─ Passo 2-3: waitFor/click como fallback
  └─ Passo 4: sleep 2s -> servidor processa clique
  └─ Passo 5: evaluate segunda tentativa -> garante clique em portais async
  └─ Passo 6: sleep 1.5s -> estabiliza mTLS

ETAPA 7: Injecao mTLS (por baixo dos panos)
  └─ Portal solicita certificado -> evento Electron select-client-certificate
  └─ preventDefault() (obrigatorio)
  └─ Valida URL (suporta host:porta sem esquema)
  └─ Recusa HTTP puro (apenas HTTPS)
  └─ Aceita automaticamente se host e .gov.br (allowlist automatica)
  || Senão, exige allowlist explicita do servico
  └─ Seleciona por thumbprint SHA-256/SHA-1 (score >= 50)
  └─ callback(certificado) -> injeta no handshake TLS

ETAPA 8: Detecção de pós-login
  └─ postLogin procura por "Sair", "Sair do gov.br", links de logout, etc.
  └─ Detectado -> markAuthenticated() -> OVERLAY REMOVIDO
  └─ Sessao status = 'authenticated'

ETAPA 9: Entrega ao usuario
  └─ Janela do portal ja logada
  └─ Usuario nao viu tela de login nem tela intermediaria
  └─ Apenas viu overlay de loading por fracoes de segundo
```

---

## 3.4. Bibliotecas para perfil de uso robotizado (pesquisa detalhada)

Como a busca web falhou (HTTP 402), baseei-me no conhecimento da arquitetura existente:

### Recomendação oficial: **Electron Nativo (select-client-certificate)**

**Por que é a melhor escolha:**

| Critério | Electron Nativo | Playwright | Puppeteer |
|----------|----------------|------------|-----------|
| Injeção de certificado mTLS | ✅ Nativo (handshake TLS) | ❌ Não suporta nativamente | ❌ Não suporta nativamente |
| Partição isolada por sessão | ✅ session.fromPartition() | ⚠️ BrowserContext | ⚠️ BrowserContext |
| Integração com app desktop | ✅ Já integrado | ❌ Requer embed | ❌ Requer embed |
| Dependências externas | ✅ Zero | ❌ Binários do navegador | ❌ Binários do Chrome |
| Certificado A1 no Windows | ✅ Repositório nativo | ❌ Difícil de acessar | ❌ Difícil de acessar |

### Quando considerar alternativas

- **Playwright**: apenas para testes E2E automatizados (já usado nos testes `tests/e2e/`)
- **Puppeteer**: apenas se precisar de automação fora do Electron (ex.: robô executando em servidor)
- **Chrome DevTools Protocol**: apenas se precisar de controle granular além do que o Electron oferece

**Conclusão:** Mantenha a arquitetura Electron nativa. A correção está no overlay de loading e na receita mais agressiva, não em trocar de biblioteca.

---

## 4. Checklist de Implementação

- [x] `electron/main/sessions/loading-overlay.ts` — criado com CSS, HTML, scripts de injeção/atualização/remoção
- [x] `electron/main/sessions/manager.ts` — importado loading-overlay, adicionado campos de controle, injeção no `did-start-loading`, atualização no `did-finish-load` e `startRecipe`, remoção no `markAuthenticated`
- [x] `shared/builtins.ts` — `AUTO_CLICK_CERT_SCRIPT` melhorado (múltiplos cliques, verificação de visibilidade), receita com 6 passos agressivos
- [x] `npx tsc --noEmit` — compila sem erros
- [ ] Validar em ambiente real com certificado A1 ICP-Brasil instalado no Windows
- [ ] Testar e-CAC: confirmar que "Entrar com gov.br" é clicado automaticamente e sessão chega a `authenticated`
- [ ] Testar gov.br: confirmar fast-path com cookies salvos (segunda abertura entra direto)

---

## 5. Como Testar

1. Importe um certificado A1 PFX no cofre (`certificates.import`)
2. Vincule o certificado a um cliente (`certificates.linkClient`)
3. Abra o e-CAC via `LaunchDialog` com método `certificate`
4. Observe o overlay de loading com mensagens sequenciais
5. Confirme que a tela intermediária do e-CAC é coberta pelo overlay
6. Confirme que a sessão chega a `authenticated` sem tela de login

---

## 6. Limitações

- **Certificados A3 com PIN não suportados** (MVP): `app.setClientCertRequestPasswordHandler` lança erro
- **Mais de um certificado válido por cliente**: o usuário deve escolher no `LaunchDialog`
- **CAPTCHA/reCAPTCHA/hCaptcha/2FA**: detectados, sessão vai para `manual`
- **JUcec-CE e Redesim**: fluxo default de senha, exigem adaptação separada para certificado
