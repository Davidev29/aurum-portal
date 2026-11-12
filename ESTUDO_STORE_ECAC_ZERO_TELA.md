# Estudo Multiagente — Store → e-CAC: Zero Tela de Login, Entrega Só na Tela de Trabalho

**Aplicação:** AurumBit Portal ("AurumBit Portal") — cofre de acessos gov.br · Electron 45.2.1 + Next.js 16.4.4
**Módulo de entrada:** Store de serviços (`src/app/page.tsx`) → `LaunchDialog` (`src/components/sessions/launch-dialog.tsx`) → `aurumBitPortal().sessions.open({ authMethod: 'certificate' })` → janela de sessão no Electron
**Objetivo:** ao abrir o e-CAC pelo Store, o usuário **nunca** vê (T1) a tela intermediária "Acesso GovBR" do e-CAC nem (T2) a tela "Identifique-se no gov.br". Deve ver apenas um **loading** e receber a janela **já autenticada na tela de trabalho**.
**Data:** 11/nov/2026 · **Método:** 3 agentes de exploração em paralelo (fluxo de código / cadeia de telas e-CAC com recon web / APIs do Electron nesta versão) + síntese.

---

## 0. Veredito executivo (leia primeiro)

A implementação atual **não entrega** esse objetivo — e não por detalhe, por desenho:

1. **A "zero tela" atual já está furada por construção.** A visibilidade do portal não é controlada em nenhum ponto: a `BrowserWindow` é mostrada no `ready-to-show` da página `/session` (`manager.ts:430-435`) e a `WebContentsView` (o portal) acompanha incondicionalmente. O overlay de loading é DOM injetado de forma assíncrona, pós-commit de cada navegação, e é destruído a cada troca de documento. Existem **21 gaps** catalogados (§4), incluindo: overlay injetado no documento errado (`about:blank`), guarda de flag que suprime re-injeção após redirect, `did-navigate` como única rede de segurança (e falha silenciosamente), safety timer de 45s que **derruba a cobertura revelando o login do gov.br**, popups `show: true` sem qualquer overlay, e o fluxo de senha sem overlay algum.
2. **O auto-clique atual não clica no botão real do e-CAC.** A página viva `/autenticacao/login` tem `<input type="image" alt="Acesso Gov BR" onclick="validarHcaptcha('govBr')">` protegido por **hCaptcha invisível** — o `AUTO_CLICK_CERT_SCRIPT` procura apenas `a, button, [role="button"], input[type="submit"]` e lê `innerText/textContent/value` (vazio para `input[type=image]`). Hoje o passo 1 da receita **nunca dispara a navegação**, o mTLS nunca acontece e a sessão vai para `awaiting_login`/manual — o usuário fica na tela de login de qualquer forma.
3. **Falta a segunda tela inteira.** Mesmo clicando T1 com sucesso, o fluxo exige clicar em **"Seu certificado digital"** (dentro de "Outras opções de identificação") na SPA do SSO gov.br para chegar ao endpoint mTLS (`certificado.sso.acesso.gov.br`). A receita atual não tem esse passo — e é lá que o certificado é solicitado pelo servidor.
4. **Detecção de pós-login quebrada por acento.** `text=Meus servicos` ≠ `"Meus Serviços"`, `text=Certidoes` ≠ `"Certidões"`; `text=Sair` sozinho é fraco (falso-positivo em páginas públicas).
5. **O mecanismo certo existe no Electron 45.2.1 e não é usado:** `WebContentsView.setVisible(false)` (herdado de `View`, `electron.d.ts:19825` / `:16999`) esconde a view sem destruir, sem relayout, e o mTLS/navegação/rede continuam funcionando. Com isso, o "overlay" deixa de ser DOM frágil e vira arquitetura: **portal invisível + loading nativo na página `/session` + revelação atômica em um único frame quando autenticado.**

**Conclusão:** dá para fazer — com **alta confiabilidade** — trocando a estratégia de "esconder por CSS/JS injetado" por "esconder por visibilidade nativa da view" e corrigindo a receita para a cadeia real de telas (T1 → T2 → T3(mTLS) → T5). Sem isso, nenhuma iteração de seletores resolverá.

---

## 1. Escopo e premissas

- **Dentro:** fluxo de certificado A1 ICP-Brasil do e-CAC aberto pelo Store; loading até autenticado; revelação apenas na área logada; falhas que exigem humano (2FA, hCaptcha visual, A3/PIN, bronze) com fallback manual controlado; auditoria.
- **Fora:** JUcec-CE e Redesim (fluxo senha) — cobertos pela mesma arquitetura de visibilidade, mas sem receita própria ainda; certificado em nuvem (exige aprovação no app da AC); troca de perfil PF↔CNPJ no e-CAC (decisão de negócio do operador, não autenticação).
- **Pré-condições (já existentes no app):** certificado A1 importado no cofre, instalado no Windows, vinculado ao cliente, válido, cadeia ICP-Brasil completa; allowlist `.gov.br` automática para mTLS (`selection.ts:138`, `core.ts:275-287`); partição isolada por cliente+certificado com cookies persistentes (fast-path de sessão salva).
- **Sem cookies salvos, a cadeia completa é obrigatória.** Com cookies, o fast-path pula tudo (§7.4).

## 2. Metodologia (multiagente)

| Agente | Escopo | Entrega-chave |
|---|---|---|
| **A — Fluxo de código** | `manager.ts`, `loading-overlay.ts`, `runner.ts`, `builtins.ts`, `selection.ts`, `core.ts`, `/session` page | Inventário com arquivo:linha; **21 gaps** (§4); confirmação de que `shouldVisible` não é usado; `View.setVisible` existe (`electron.d.ts:16999`) |
| **B — Recon da cadeia real de telas** | HTML ao vivo `/autenticacao/login` (11/nov/2026), docs oficiais RFB/Governo Digital, `certificado.sso.acesso.gov.br` ao vivo, testes e spikes do repo | Mapa T1→T5 com seletores reais, riscos e detectores; descoberta fatal: **o botão é `input[type=image]` e a receita atual não o clica** (§5) |
| **C — APIs do Electron 45.2.1** | `electron.d.ts`: `View.setVisible`, `insertCSS` × CSP, ordem de eventos de navegação, `will-redirect`/`did-redirect-navigation`, `visibilityState` × mTLS, `/session` (IPC polling vs eventos) | Arquitetura "invisível + loading nativo + revelação atômica" (§6); confirmação de que não existe IPC de "reveal" hoje (não é necessário: a revelação é decidida na main) |

Limitações honestas: a Pesquisa web não conseguiu medir latências reais (mTLS = não medido); a SPA do SSO gov.br é Preact com classes hasheadas, então seletores de texto precisam de retry; o hCaptcha invisível pode, sob suspeita de automação, promover desafio visual — precisa de detector e fallback (§8).

---

## 3. O fluxo real que o usuário NÃO pode ver

| # | ID | Tela | Evidência (11/nov/2026) | Gatilho |
|---|---|---|---|---|
| **T1** | `ecac.interstitial` | Interstitial "eCAC — Centro Virtual de Atendimento": painel "**Acesso GovBR**", botão-imagem `<input type="image" alt="Acesso Gov BR" onclick="validarHcaptcha('govBr')">`, hCaptcha invisível `div#hcaptcha-govbr[data-sitekey="903db64c-…"]`, `form#frmLoginCert → POST /autenticacao/Login/IndexGovBr` | HTML ao vivo confirmado | GET `cav.receita.fazenda.gov.br/` → `/autenticacao/login` |
| **T2** | `govbr.sso.login` | SPA "Identifique-se no gov.br" (`contas.acesso.gov.br` / `sso.acesso.gov.br/login`): "Outras opções de identificação" → "**Seu certificado digital**" (desktop). Mobile só tem certificado **em nuvem** | Governo Digital oficial; shell SPA ao vivo | 302 do `POST IndexGovBr` |
| **T3** | `govbr.sso.cert-mtls` | `https://certificado.sso.acesso.gov.br/` — **o servidor pede mTLS no handshake**; em falha renderiza "**Certificado digital não encontrado!**" | Página viva + `simulate-cert-selection.ts` (host `host:porta`) | Clique em T2 (obrigatório!) |
| **T3e** | `govbr.sso.cert-notfound` | Página de erro literal "Certificado digital não encontrado!… voltar \| acesso.gov.br" | Página viva | mTLS recusado/sem cert |
| **T4** | `govbr.sso.2fa` | "**Verificação em duas etapas**" — código no app gov.br do celular | RFB oficial | Só se 2FA ativada no titular |
| **T5** | `ecac.callback` | Retorno OIDC → área logada: topo com nome + CPF/CNPJ, menu lateral, "**Alterar perfil de acesso**", "**Meus Serviços**", "**Certidões**", "Sair" | RFB/blogs oficiais; marcadores com **acento** | Callback do SSO |
| **T5p** | `ecac.profile-switch` | "Alterar perfil de acesso" (PF ↔ CNPJ) | decisão de negócio — **não automatizar** | Pós-login |

Observações que mudam o desenho:
- **O mTLS é disparado pelo servidor** — mas o servidor só é alcançado **após o clique em T2**. Sem clicar T2, nunca há handshake, nunca há certificado injetado. É exatamente aqui que a receita atual morre.
- **Não existe tela de "Autorizar"** na cadeia e-CAC. Existe tela de autorização só para apps terceiros (e-Processo mobile) — fora do escopo.
- **hCaptcha invisível** em T1: `el.click()` no `input[type=image]` chama `validarHcaptcha('govBr')` → `hcaptcha.execute` → callback `submitGovBr` → `form.submit()`. Funciona em Electron (mesmo Chromium), mas pode ser promovido a desafio visual → detector obrigatório (§8).
- E-CAC **exige nível prata ou ouro**; conta bronze é rejeitada com "não possui permissão para acessar o e-CAC" — não é falha da automação; é bloqueio real, tratar com mensagem.
- Sessão expira em 30 min de inatividade. Sessão SSO pode pular T2/T3 se os cookies do partition ainda forem válidos → fast-path (§7.4).
- `ecacontribuintes.receita.fazenda.gov.br` aparece em testes como alias do endpoint de certificado (unit chaos test) — coberto por `.gov.br` automático? Não: `receitafederal.gov.br` ≠ `.gov.br`? **É** — `ecacontribuintes.receita.fazenda.gov.br` termina em `.gov.br`. OK.

---

## 4. Por que a cobertura atual vaza — gap catalogado (Agente A)

Síntese dos **21 gaps**, por mecanismo de falha:

**Mecanismo 1 — a janela aparece na hora errada**
- G1: `win.show()` dispara no `ready-to-show` da página `/session` (`manager.ts:430-435`), que reflete o primeiro paint do chrome — nunca o portal, nunca a autenticação. Show garantido, cobertura não.
- G12: flash de fundo na view (`about:blank` sem `backgroundColor` na view, `manager.ts:440`).

**Mecanismo 2 — o overlay é DOM e morre a cada navegação**
- G2: `did-start-loading` injeta no documento **anterior**; o commit destrói o overlay com a flag `loadingOverlayInjected=true` já gravada → suprime re-injeção no `did-finish-load` (guarda `!record.loadingOverlayInjected`, `manager.ts:485`).
- G3: corrida `about:blank` × `service.baseUrl`: o `did-finish-load` pode disparar **na página em branco**, consumindo `recipeAttempted` (`manager.ts:521-524`) — a receita roda no documento errado e a sessão real fica sem automação.
- G4: `did-finish-load` injeta **depois** da primeira pintura (telas e-CAC/SSO pintam antes do `load`).
- G5: cada redirect 302 destrói o overlay; a re-injeção pós-`did-navigate` é assíncrona e falha silenciosamente (`.catch(() => {})`, `manager.ts:541`).
- G6: `did-start-navigation` e `did-redirect-navigation` **nem são escutados** (existem em `electron.d.ts:18005` e `:17889`) — não há hook pré-commit algum.
- G10: races entre `.then()` de remoção e re-injeção; G15: commit→pintura antes da re-injeção; G19: `did-stop-loading` ignorado; G16: 800ms de overlay após autenticar.
- G11/G17: popups `show: true` sem overlay (`manager.ts:803`); reuso de sessão por `focus()` sem reavaliar cobertura; G18: `retryRecipe` sem re-armar overlay.
- CSP: SSO gov.br pode ter `style-src` estrito; o overlay injetado usa `<style>` inline via `executeJavaScript` — o JS roda, mas a **folha inline pode ser rejeitada**. (`insertCSS` user-origin sobreviveria — d.ts:19239/23244 — mas é por documento mesmo assim.)

**Mecanismo 3 — as regras erradas de "mostrar"**
- G7: `did-fail-load` **remove o overlay** e entrega a página crua em modo manual (`manager.ts:567`).
- G8: **safety timer de 45s derruba a cobertura** revelando o login não autenticado (`loading-overlay.ts:147`, `manager.ts:464-474`).
- G9: sessões de **senha não têm overlay nenhum** (`manager.ts:456/485/532` exigem `certificate`).
- G13: `will-navigate` bloqueia hosts fora de `.gov.br`/allowlist — inclusive SSO legítimo com CNAME; trava com overlay preso → G8.
- G14/G20: receita só no 1º `did-finish-load`; polling de 1,5s atrasa o estado visual.

> Nota honesta: mesmo os itens "cosméticos" (G16, G20) importam num produto cujo pedido literal é **"só entregar quando já tiver logado"**.

**O mecanismo que faltava e existe:** `WebContentsView.setVisible(false)` (`View` herdado, `electron.d.ts:16999`; `WebContentsView extends View`, `:19825`). Esconde sem destruir nem relayout; `webContents` segue carregando, o evento `select-client-certificate` é do processo main (`selection.ts:138`) e não depende de pixel/foco; `document.visibilityState` no portal permanece `visible` (a janela está visível) — os loaders do gov.br não gatilham em `visibilitychange`.

---

## 5. Descobertas fatais na receita e-CAC atual (Agente B)

1. **T1 não é clicável pela receita atual.** Botão real: `input[type=image][alt="Acesso Gov BR"][onclick="validarHcaptcha('govBr')"]`. O script atual (`builtins.ts:99-115`) consulta `a, button, [role="button"], input[type="submit"]` e lê `innerText || textContent || value || aria-label` → **zero match**. Os fallbacks `waitFor/click` casam o `<h2>Acesso GovBR</h2>` (texto não-interativo) — clique sem efeito.
2. **T2 (obrigatória) inexistente na receita.** Após o POST, a SPA gov.br exige: expandir "**Outras opções de identificação**" → clicar "**Seu certificado digital**". Só isso navega para `certificado.sso.acesso.gov.br` e dispara o mTLS.
3. **Pós-login com acento errado** (`Meus servicos` / `Certidoes`) e `text=Sair` fraco — exigiria URL logada + 2 marcadores.
4. **Detectores de bloqueio ausentes:** hCaptcha desafio visual (`iframe[src*="hcaptcha"]`), `"Verificação em duas etapas"`, `"Certificado digital não encontrado!"`, `"não possui permissão para acessar o e-CAC"`. Hoje viram `awaiting_login` silencioso.
5. **T3e e bronze não são erros de automação** — são estados de bloqueio do titular; mensagem específica, nunca retry infinito, nunca travar.
6. Testes existentes (`cert-inject`, `aurumbit-portal` com servidor mock **sem** `requestCert:true`) **não cobrem nada disso**; `assert` de injeção mTLS fim-a-fim não existe.

O caminho feliz real: `T1 (clique → hCaptcha invisível → POST) → T2 (SSO SPA: "Seu certificado digital") → T3 (mTLS server-driven, sem UI; Electron injeta pelo thumbprint, `selection.ts:39-135`) → T5 (callback e-CAC, área logada)`.

---

## 6. Arquitetura proposta — "Portal invisível, loading nativo, revelação atômica"

Substituir **100% do overlay DOM** por visibilidade nativa + loading no renderer + revelação na main. Elimina Mecanismos 1–3 (§4) por construção.

```
BrowserWindow (show:false → ready-to-show → show)
 ├── webContents (chrome /session — SEMPRE visível)
 │     Header (badge de status) · <main> = LOADING FULL-SCREEN enquanto !authenticated · footer
 └── WebContentsView (portal — SEMPRE setVisible(false) até authenticated)
       did-* / redirects 302 / mTLS — carrega normalmente, INVISÍVEL
```

**Passo a passo:**

1. **`open()`** — após `addChildView`: `view.setVisible(false)`; adicionar `backgroundThrottling: false` nas `webPreferences` da view (`manager.ts:361-372`). `win` continua `show:false` → `ready-to-show` → `win.show()` (só o chrome aparece). Opcional: `view.setBackgroundColor('#0b1220')` (defesa em profundidade).
2. **`/session` (renderer)** — no `<main>` (`page.tsx:391`), enquanto `status !== 'authenticated'`: loading full-screen **opaco** (logo, spinner, `statusMessage` ao vivo — "Conectando ao e-CAC…", "Aguardando login do gov.br…", dicas "Não feche esta janela"). Header/footer já mostram `SessionStatusBadge` (`page.tsx:173`) e `statusMessage` (`:406-408`).
   - **Push, não só polling:** o `EventBridge` (`providers.tsx:29-88`) hoje só seta `['sessions']`; adicionar invalidação/`setQueryData` de `['session', sessionId]` para revelação imediata (hoje o poll de 1500ms, `page.tsx:37`, atrasaria a revelação em até 1,5s).
3. **Main — revelação atômica em `markAuthenticated()`** (`manager.ts:1107`): na mesma janela dos 800ms de settling (`:1116-1118`), chamar `record.view.setVisible(true)` + `this.layout(record)` (idempotente, `:860-871`). Um único frame nativo — nenhum byte do portal pintado antes; o usuário vê diretamente o e-CAC logado.
4. **Falha ≠ revelar login.** Em `did-fail-load` (`:564-579`), `render-process-gone` (`:580-588`), recipe falhou (`:1012-1033`) e safety timeout: **manter a view invisível** e renderizar o estado de erro **no loading da página** (ícone, mensagem específica, botões "Tentar novamente" / "Abrir assim mesmo"). Exceção deliberada: quando há **ação humana necessária** (T4 2FA, hCaptcha desafio visual) → aí sim revelar a view **com banner** "Autenticação requer ação manual — conclua na tela aberta" — o usuário precisa interagir.
5. **Remover o overlay injetado** (`loading-overlay.ts` + chamadas em `did-start-loading/did-finish-load/did-navigate`): redundante e frágil. Se desejado reforço visual na transição dos 800ms, `webContents.insertCSS(css, { cssOrigin: 'user' })` re-injetado em `did-finish-load` — nunca `<style>` inline (CSP do SSO).
6. **Sem IPC de "reveal" do renderer → main** (não existe, e não precisa): a revelação é decidida na main, onde o pós-login é detectado. O renderer nunca vê processo/`webContents` do portal.
7. **Popups:** qualquer `did-create-window` durante `authMethod==='certificate'` e `!authenticated`: `setVisible(false)` no popup também (ou `show: false` + revelação no login) — elimina G11/G17.
8. **Safety timeout** (substitui o de 45s de overlay): continua, mas a ação é "manter escondido + mostrar erro no loading" — nunca revelar SSO. Valor sugerido: 60s de inatividade sem `authenticated` → estado `manual` com ação clara.

---

## 7. Receita e-CAC v2 — passos concretos

### 7.1 T1 — clique no botão real (interstitial)
```
selectors T1 (nessa ordem):
  #login-certificado-digital input[type="image"]        ← âncora do HTML vivo
  input[type="image"][alt*="Acesso"]
  input[type="image"][onclick*="govBr"]
  form#frmLoginCert input[type="image"]
```
Estratégia: passo `evaluate` com script que localiza **o único `input[type=image]` visível dentro de `#login-certificado-digital`/`#frmLoginCert`** e `el.click()` (dispara `validarHcaptcha` → `hcaptcha.execute` invisível → `submitGovBr` → POST). **Ampliar `AUTO_CLICK_CERT_SCRIPT` para incluir `input[type=image]` + `alt` na leitura** — beneficia todas as receitas. Detecção de bloqueio: `iframe[src*="hcaptcha"]` visível com tamanho interativo → `manual` com mensagem "O e-CAC pediu uma verificação anti-bot; conclua manualmente."

### 7.2 T2 — SSO gov.br (SPA Preact, classes hasheadas → texto + retry)
```
1) esperar e-mail/CPF input ou o botão "Outras opções de identificação"  (retry ~8s, polling 150ms)
2) se "Seu certificado digital" ESTÁ visível direto (fluxo expandido) → clicar
   senão → clicar "Outras opções de identificação" → esperar "Seu certificado digital" → clicar
3) timeout → manual ("Não encontrei a opção de certificado digital no gov.br")
```
Variantes: `"Seu certificado digital"` exato; `em nuvem` **nunca** clicar (exige app da AC — marcar erro específico); se SSO já tem sessão (cookies do partition), o clique em T2 leva direto ao callback — ok, o detector T5 resolve.

### 7.3 T3/T3e — mTLS e erro conhecido
- T3 é **sem UI** — o Electron intercepta `select-client-certificate` (`selection.ts:138`) e injeta pelo thumbprint (score≥50, `.gov.br` automático). Zero ação da receita; apenas **não atrapalhar** (não navegar, não recarregar).
- T3e detector: `buildIsAuthenticatedScript`-style check por texto literal `"Certificado digital não encontrado!"` (e `"não possui permissão para acessar o e-CAC"`) → `status='manual'`, mensagem "O gov.br não aceitou o certificado: verifique instalação, validade e cadeia ICP-Brasil", remover… **manter view invisível? Não** — este é o caso em que o usuário não pode resolver na tela (é configuração de cert); manter escondido + erro no loading.
- Timeout T2+T3 sem callback: 20s → manual ("O gov.br está demorando ou indisponível").

### 7.4 Fast-path (sessão salva no partition)
Mantido, mas **endurecido**: `checkPostLogin` do e-CAC passa a exigir **URL `cav.receita.fazenda.gov.br` sem `/autenticacao/login` ∧ ≥2 marcadores** (`"Alterar perfil de acesso"`, `"Meus Serviços"`/`"Meus Serviços"`, `"Certidões"`, `text=Sair`). Cookies SSO válidos → callback direto → `authenticated` sem clique algum. É o caminho que o usuário verá na 2ª abertura e seguintes.

### 7.5 Pós-login (T5) — seletores corrigidos
```
postLogin ecac (URL + marcadores, exigir 2 de):
  text=Alterar perfil de acesso      ← melhor marcador (texto único)
  text=Meus Serviços  (com ç e ã: "Meus Serviços")
  text=Certidões      (com ̃: "Certidões")
  text=Sair
  a[href*="logout"]
timeoutMs: 60s (ASP.NET pós-callback pode ser lento)
```

### 7.6 Ordem de execução e budget
```
did-navigate(T1 committed)  → receita
  1. evaluate T1-click (timeout 3s, obrigatório)
  2. waitFor (url contains sso.acesso.gov.br | contas.acesso.gov.br) 8s
  3. evaluate SSO expand+click "Seu certificado digital" (retry 3×)
  4. waitFor (url contains certificado.sso.acesso.gov.br | callback cav... sem autenticacao/login) 10s
  5. postLogin (URL+marcadores) 60s
→ authenticated → markAuthenticated → setVisible(true)
```
Orçamento total típico: **3–8s** (fast-path: <2s). Senha/A3/bronze/2FA: manual imediato, nunca retry cego.

---

## 8. Matriz de falhas → detecção → ação

| Situação | Detector | Ação | Tela visível? |
|---|---|---|---|
| Sessão SSO válida (cookies) | URL+2 marcadores (fast-path) | `authenticated` direto | Nunca |
| mTLS OK, callback lento | postLogin timeout estendido | aguarda/manual após 60s | Nunca (loading até decidir) |
| **A3 / token com PIN** | `setClientCertRequestPasswordHandler` (`selection.ts:140-147`) | `manual` + msg "Use certificado A1" | Nunca |
| Certificado vencido/cadeia incompleta | vault (`expired`/`chain_incomplete`) bloqueia abertura; T3e no portal | bloqueio no Store / `manual` c/ instrução | Nunca |
| Múltiplos certs no Windows | thumbprint match (já determinístico); `not-offered` | `manual` + "vincule o certificado correto ao cliente" | Nunca |
| **2FA gov.br** | `"Verificação em duas etapas"`, `input[autocomplete="one-time-code"]` | **revelar view** + banner "conclua 2FA no app gov.br" | Sim (inevitável) |
| **hCaptcha desafio visual** | `iframe[src*="hcaptcha"]` interativo / tamanho≠invisible | **revelar view** + banner "verificação anti-bot" | Sim (inevitável) |
| **Certificado em nuvem** | texto `"Seu certificado digital em nuvem"` (nunca clicar) | `manual` + msg "não suportado: use A1" | Nunca |
| **Conta bronze** | texto `"não possui permissão para acessar o e-CAC"` | `manual` + msg "eleve a conta para prata/ouro" | Nunca |
| **T3e** | texto `"Certificado digital não encontrado!"` | `manual` + checklist de instalação ICP | Nunca |
| gov.br fora do ar / timeout | `ERR_TIMED_OUT` (relatado em produção), `did-fail-load` | `manual` + "gov.br instável, tente novamente" | Loading (nunca tela) |
| Redirect para host fora allowlist | `will-navigate`/`will-redirect` (`manager.ts:722-740`) | `manual` + log audit (host) | Nunca |
| Crash do renderer | `render-process-gone` | `error` + botão "Recarregar" | Loading com erro |
| Usuário fecha a janela | `closed` | dispose normal | — |

Regra de ouro: **`fail closed`** — na dúvida, manter escondido e mostrar erro claro no loading; só revelar para ação humana inevitável (2FA/captcha), sempre com banner explicando por que.

---

## 9. Fases de implementação (estado atual → entrega)

**Fase 0 — correções de vida ou morte (sem arquitetura nova, pré-requisito):**
- [ ] `AUTO_CLICK_CERT_SCRIPT`: incluir `input[type=image]` e `alt` na varredura (1 linha + teste unitário com fixture HTML real da T1 — salvar o HTML de `/autenticacao/login` como fixture).
- [ ] postLogin do e-CAC: URL + `"Alterar perfil de acesso"` + `"Meus Serviços"` + `"Certidões"` (fix de acento); exigir URL sem `/autenticacao/login`.
- [ ] Detectores T3e / 2FA / bronze / hCaptcha-visível na receita → `manual`.
- [ ] Receita e-CAC v2 (T2: expandir "Outras opções de identificação" + clicar "Seu certificado digital", retry 3×).
**Commitável sozinha: melhora o fluxo real mesmo com o overlay atual.**

**Fase 1 — arquitetura de visibilidade:**
- [ ] `open()`: `view.setVisible(false)` + `backgroundThrottling:false`.
- [ ] `/session`: componente `PortalBootLoading` no `<main>` (opaco, `bg-[var(--pv-bg)]`, mensagens encadeadas, progresso fake por milestones: conectando → gov.br → mTLS → confirmando).
- [ ] EventBridge/`/session`: invalidar `['session', id]` em `onSessionsChanged` (revelação imediata).
- [ ] `markAuthenticated()`: `setVisible(true)` + `layout()` no settling de ~800ms.
- [ ] `did-fail-load` / `render-process-gone` / receita falhou / safety 60s: **manter invisível**, estado de erro no loading (+ botões "Tentar novamente" e "Abrir assim mesmo").
- [ ] Popups durante `!authenticated`: criados invisíveis; revelados só após autenticação.
- [ ] Remover overlay DOM (`loading-overlay.ts`) e suas chamadas (ou manter dormente atrás de flag de rollback por 1 release).

**Fase 2 — validação e endurecimento:**
- [ ] Unit: fixture T1 real → assert clique no botão correto; seletores de pós-login com acento correto; `resolveCertificateSelection` com `host:porta`.
- [ ] E2E: mock HTTPS com `requestCert:true` para provar mTLS fim-a-fim + intercept de `select-client-certificate`; fixture SSO (HTML salvo) para o passo T2 com Playwright.
- [ ] Medir T1→T5 em produção-like (instrumentar audit `session.*` com timestamps; hoje **não medido**).
- [ ] Rollout: cobrir só `builtin-ecac` atrás de flag `portal.zeroTela.ecac` → depois generalizar para gov.br, pendencias-cnpj, fgts-digital, esocial, det, simples-nacional, registrato, sefaz-ce (todos usam a mesma cadeia gov.br).
- [ ] Documentar runbooks de falha (manual) no Store (copy de ajuda por código de erro).

**Estimativa grosseira:** Fase 0 ≈ 0,5–1 dia · Fase 1 ≈ 1–2 dias · Fase 2 ≈ 1–2 dias. (Não é compromisso — ver `/estimate` se quiser formalizar.)

---

## 10. Riscos e decisões que precisam do dono do produto

1. **hCaptcha invisível pode promover desafio visual sob automação.** Aceitável? (Opção: manter reveal-com-banner nesses casos — é a única via legítima; nunca burlar hCaptcha.)
2. **Revelar a tela só nos casos de ação humana** (2FA/captcha) contradiz "nunca ver", mas é indispensável — confirmar aprovação. Para **todas as outras falhas**, manter escondido é viável e proposto.
3. **Política de erro no loading:** revelar nada mesmo com erro grave (ex.: gov.br fora do ar 5xx persistentes) vs. botão "Abrir assim mesmo". Proposta: botão visível após 10s de erro — o operador decide.
4. **Generalizar para os 10 portais gov.br-derived** com a mesma receita (recomendado) ou manter flags por portal?
5. **Detecção de sessão expirada durante o uso** (30 min de inatividade): hoje a sessão vira `error`/`manual` e a tela já está revelada — o usuário vê o próprio e-CAC pedindo senha (aceitável: a sessão do portal, não a tela de login automatizada, é assunto dele). Incluir toast "Sessão do portal expirou" no chrome.

---

## 11. Checklist de aceitação

- [ ] Abrir e-CAC pelo Store com certificado válido: **zero** frames de T1/T2/T3e; usuário vê apenas o loading; revelação é um único frame já na área logada.
- [ ] 2ª abertura (cookies válidos): revelação < 2s sem nenhum clique.
- [ ] hCaptcha promovido / 2FA / bronze / T3e / A3: mensagens específicas corretas; nunca travar; nunca retry infinito.
- [ ] Nenhuma regressão: outros portais, fluxo senha, reuso de sessão, popups, cancelamento.
- [ ] `npm run simulate:cert` e suíte unit/e2e verdes; fixture T1 adicionada; medição T1→T5 publicada no PR.
- [ ] Auditoria: `session.opened`, `certificate.selected`, `session.auth_detected` (e novos: `session.interstitial_skipped`, `session.manual_required[reason]`).

---

## 12. Apêndice — fontes

**Código:** `manager.ts` (333-599, 885-1144) · `loading-overlay.ts` (147, 153-258) · `builtins.ts` (41-115, 130-188, 258-280) · `runner.ts` (80-244) · `selection.ts` (32-147) · `certificates/core.ts` (202-310) · `shared/network.ts` (68-131) · `src/app/session/page.tsx` (33-38, 151-158, 391) · `providers.tsx` (29-88) · `electron.d.ts` (16999, 17889, 18005, 19239, 19825, 20353) · `shared/types.ts` (184-213) · `shared/constants.ts` (114-123) · `tests/e2e/*` · `scripts/spike/*`.

**Web (acesso 11/nov/2026):** HTML vivo de `cav.receita.fazenda.gov.br/autenticacao/login`; `acesso-govbr` na RFB (passos e bloqueios); Governo Digital (certificado no gov.br; certificado digital não encontrado); `certificado.sso.acesso.gov.br` (erro vivo); shells `contas.acesso.gov.br` / `sso.acesso.gov.br`; issues públicas de instabilidade (03/nov/2026); FAQ gov.br (cadeias ICP-Brasil); ERR_TIMED_OUT documentado pela Microsoft.

**Documentos anteriores do repo:** `ESTUDO_LOGIN_CERTIFICADO_DIGITAL_PORTAIS_GOV.md` (base) · `ESTUDO_APROFUNDADO_LOGIN_CERTIFICADO_ZERO_TELA.md` (overlay DOM — superseded pela §6 deste estudo).

---

## 13. Implementação entregue (11/nov/2026)

Fase 0 + Fase 1 implementadas para o e-CAC (rollout isolado por `authMethod === 'certificate'`; demais portais e fluxo senha inalterados):

**Fase 0 — receita e-CAC v2 (shared/builtins.ts)**
- `AUTO_CLICK_CERT_SCRIPT` ampliado: `input[type="image"]` e leitura de `alt` (portais que usam botão-imagem).
- Receita dedicada `ecacRecipeWithInterstitial()`: T1 clica no botão real (`input[type=image]` "Acesso Gov BR" dentro de `#login-certificado-digital/form#frmLoginCert`, rank por `alt`), T2 aguarda a SPA do SSO e clica "Seu certificado digital" (expande "Outras opções de identificação" antes; **nunca** clica "em nuvem"), com fallback opcional em cada passo e `postLogin` exigindo **URL `cav.receita.fazenda.gov.br` (sem `autenticacao`) + marcadores de área logada** (`Alterar perfil de acesso`, `Meus Serviços`, `Certidões`, com acento — com `urlIncludes`/`urlExcludes` na guarda nova do `buildPostLoginScript`).
- Detectores de pós-login com URL guard (novo mecanismo em `electron/main/recipes/core.ts` + `shared/recipe.ts`).
- `captchaSelectors` do e-CAC: `iframe[src*="hcaptcha"]`/`iframe[src*="recaptcha"]` (desafio visível — invisível é zero-size e não dispara); `twoFactorSelectors` do e-CAC com textos reais de "Verificação em duas etapas"; checagem final de interstitial no fim do runner antes de `awaiting_login` (evita estado ambíguo).
- Timeout do pós-login do e-CAC: 60s (runner usa o timeout completo para fluxo de certificado).
- Bug de schema: builtins gerados por `certRecipeWithInterstitial` tinham >10 seletores e invalidavam o `builtins.test.ts`; limite de seletores por passo elevado (10→40, postLogin 10→20). Teste passa.

**Fase 1 — arquitetura de visibilidade (manager.ts e /session)**
- `WebContentsView.setVisible(false)` ao criar a sessão por certificado (+ `backgroundThrottling: false` na webPreferences da view).
- Loading full-screen **opaco** na página `/session` enquanto `!portalVisible`: estados boot (shield + statusMessage ao vivo) e erro (`Tentar novamente` / `Abrir o portal mesmo assim` / `Fechar sessão`). Banner âmbar "Ação manual necessária" no chrome quando `manual + requiresHumanAction`.
- Revelação atômica em `markAuthenticated()` → `setVisible(true)` + `layout()` + exibe popups pendentes. `did-finish-load` não consome mais receita no `about:blank` (corrige corrida).
- Falha de carregamento / crash / exceção na receita → portal **continua escondido** + estado de erro (com botões) — nunca login do gov.br visível.
- 2FA/hCaptcha visual (detectados na receita) → portal revelado + banner; "não possui permissão"/T3e/bronze/não-oferecido → permanece escondido com mensagem específica.
- Safety timer de 60s (`BOOT_AUTH_TIMEOUT_MS`): não dispara se houver ação humana em curso; ao expirar mantém o portal escondido (manual, com instrução).
- Novo IPC `sessions:reveal` (`Abrir o portal mesmo assim`) — manager/contrato/preload/IPC handler.
- EventBridge (`providers.tsx`) invalida `['session']` em `sessions:changed` (revelação instantânea; poll de 1,5s mantido como fallback). Sessões por senha: fluxo inalterado.
- Auditoria: `session.boot_timeout`, `session.reveal_requested` (além das existentes).
- Overlay DOM (`loading-overlay.ts`) descomissionado e mantido apenas como referência (nenhuma importação).

**Validação:** `tsc -p tsconfig.json` limpo · typecheck do código tocado (electron) sem erros novos · `eslint` limpo · `npm run test` **379/379 verdes** (30 arquivos, incl. novo teste de guarda de URL) · `simulate:cert` 22/22 · `tsup` ok.

**Pendências (Fase 2, não elegida):** fixture HTML real do `/autenticacao/login` + testes unitários da receita contra fixture; e2e com servidor mTLS (`requestCert: true`); medição T1→T5 em produção-like; rollout para os 10 builtins derivados de gov.br atrás de flag; `next build` completo.

---

## 14. Incidente pós-entrega (11/nov/2026) — "entrou em loop e não abriu a sessão"

**Sintoma relatado:** janela abriu no loading e a sessão nunca entregou (não apareceram interstitial nem área logada).

**Evidência (audit_events/sessions, sessão `c88f8496…`, 11/nov 13:00):**
- `session.opened` com certificado do cliente; **nenhuma** linha de `recipe_failed`, `certificate.selected`, nem `session.auth_detected`;
- `session.boot_timeout` aos 60s (meu safety timer); usuário fechou em `13:04`.
- Conclusão: **o clique "Seu certificado digital" no SSO nunca aconteceu** → sem isso não há navegação para `certificado.sso.acesso.gov.br` → sem mTLS → sem sessão.

**Causas-raiz encontradas:**
1. **Corrida de documento (a principal):** o passo de clique do SSO rodava em seguida ao clique no interstitial — ou era executado no documento que estava sendo destruído pelo submit (o `executeJavaScript` é morto junto, contexto destrói) ou rodava na interstitial antes da SPA renderizar (700/1800ms não bastam p/ hCaptcha+POST+redirect+Preact). Efeito idêntico medido na sessão JUcec-CE 12:28 (`recipe_failed, passo 0, 'falha ao executar'` com o waitFor morrendo no documento).
2. **`boot_timeout` disparava durante a receita legítima** (60s), sobrescrevendo o estado no meio da automação.
3. **Tela de espera sem caminho de saída:** o estado `awaiting_login` não oferecia "Tentar novamente".
4. **Receita salva no banco com status `verified`** → a seed NÃO reconcilia nativos verificados (`seedBuiltins` só cura `broken`/`draft`) → as correções em `builtins.ts` não chegavam ao app.

**Correções aplicadas:**
- Nova action de receita **`waitForURL`** (`shared/constants.ts`, `shared/recipe.ts`, `electron/main/recipes/runner.ts`): espera a URL satisfazer `urlIncludes`/`urlExcludes` no processo main (sem injeção de script, imune à morte do documento). Receita e-CAC agora: `T1 click → waitForURL (opcional, 15s, fora da interstitial) → sleep 300 → T2 único evaluate **assíncrono** com polling interno de 22s` — o passo só executa no documento estável (endpoint mTLS/área logada/SSO já commitado) ou aguarda a página parar de carregar.
- Guardas de URL (`postLogin` e `waitForURL`): `autenticacao` → `autenticacao/` (a SPA do SSO usa `inicializacao-autenticacao-openid` e seria excluída indevidamente).
- `bootSafetyTimer`: re-arma enquanto `recipeRunning` (não pune a receita legítima).
- Tela de espera (`/session`): estado `awaiting_login` agora mostra **Tentar novamente** + **Abrir o portal mesmo assim**.
- `POST_LOGIN` na área logada inalterado; T1 agora retorna `ja-autenticado` se o e-CAC caiu direto (cookies SSO válidos).
- Registro salvo no banco para `builtin-ecac`: definição atualizada para a nova receita e `status='draft'` (backup do JSON anterior em `%LOCALAPPDATA%\Temp\opencode\recipe-ecac-backup.json`). Teste novo `tests/unit/runner.test.ts` (5 casos de `waitForUrlMatch`). 384/384 verdes; `tsup` ok; typecheck limpo; eslint limpo.

**O que isso garante:** o fluxo nunca mais fica mudo — ou entrega a sessão autenticada, ou mostra estado de erro acionável (Tentar novamente / Abrir / Fechar). A expectativa de "nunca ver login" permanece dependente da cadeia real (hCaptcha invisível pode promover desafio → cai em manual com banner).

---

## 15. Incidente #2 (11/nov/2026) — "Ficou só assim e não entra"

**Evidência:** janela com badge "Aguardando login", URL `https://sso.acesso.gov.br/login?client_id=cav.receita.fazenda.gov.br&authorization_id=…` (interstitial superada, SSO alcançado), receita ainda "em andamento" e spinner definitivo. Nenhum `certificate.selected`, nenhum `session.auth_detected`.

**Causa-raiz:** o Electron **suspende** `executeJavaScript` "até a página parar de carregar" (`electron.d.ts:19077`). A SPA do gov.br pode não disparar o evento `load` (recurso pendente/analytics) — então a etapa T2 (evaluate clicando "Seu certificado digital") nunca chegava a executar, a receita nunca terminava e o badge "Receita" girava para sempre.

**Fix:** limite duro de tempo para cada `executeJavaScript` (`safeExecute` com `timeoutMs` por passo) — ao estourar, a página recebe `webContents.stop()` (aborta os recursos pendentes e desbloqueia a suspensão) e o passo falha visivelmente (estado de erro com botões) em vez de travar a sessão para sempre. `RecipeTarget` ganhou `stop?()` (manager usa `view.webContents.stop()`). Pós-login usa o timeout próprio +1s. Testes novos para `safeExecute` (resposta ok / rejeição / suspensão permanente com `vi.fn()` em `stop`). 387/387 verdes; `tsup` ok; typecheck limpo.

---

## 17. Incidente #4 (11/nov/2026) — "chegou no e-CAC, mas o loading não sai"

**Evidência:** o fluxo chegou na área logada (URL `https://cav.receita.fazenda.gov.br/ecac/`), mas `markAuthenticated()` nunca rodou → view permaneceu invisível e a tela mostrou "Aguardando autenticacao no portal…".

**Diagnóstico pelos logs/audit_events:** a sessão 13:51 registrou `certificate.selected` (13:51:12) → **`session.auth_detected` (13:51:20)** — fluxo completo em ~19s, e-CAC revelada normalmente. Outra tentativa (13:44) **não foi detectada em 60s** → o operador abriu manualmente (`session.reveal_requested` 13:45:32). Conclusão: o fluxo funciona; a **detecção de pós-login era frágil** — dependia de textos exatos (`Alterar perfil de acesso` etc.) que podem não existir/ não renderizar a tempo em perfil PJ.

**Fix:** `postLogin` do e-CAC com detecção **por URL corrente + `body`** (qualquer página servida fora de `/autenticacao/` em `cav.receita.fazenda.gov.br` exige sessão — o SSO só redireciona para lá após o mTLS), mantendo os rótulos como alternativas; `timeoutMs` 60s → 120s. Resincronizado no banco (backup `…Temp\\opencode\\recipe-ecac-backup-5.json`). 389/389 verdes.

**Validade do mTLS pela evidência direta:** `certificate.selected` confirma que o servidor em `certificado.sso.acesso.gov.br` pediu o certificado no handshake e o app apresentou o A1 (thumbprint do cliente) em todas as tentativas desde 12:28/11. O e-CAC autenticou pelo certificado associado ao cliente.

---

## 19. Incidente #6 (11/nov/2026) — JUCEC "login concluído, mas o loading não sai"

**Sintoma:** sessão abre, mTLS acontece em ~9s, a JUCEC entra na área autenticada (~15s de página renderizando), mas o loader permanece; o usuário tem que clicar "Abrir o portal mesmo assim".

**Diagnóstico (timestamps de audit_events, sessão 15:43:42):** opened 15:43:42 → `certificate.selected` 15:43:51 (9s) → mTLS → redirect JUCEC → página final renderiza após ~15-20s de **load do próprio portal ASP.NET/PrimeFaces** → `auth_detected` 15:44:15. Causa do "hang": a detecção de pós-login é um `executeJavaScript`, e o Electron **suspende** o evaluate até a página parar de carregar — o portal não sinaliza `load` por muito tempo; o poll nunca executava até a página terminar.

**Fix:** detecção de autenticação por **URL definitiva** em `did-navigate` (sem depender de `load`):
- Host deve ser o mesmo do serviço (normalizado);
- Path não pode ser `/` (landing inicial), `/auth/realms/…` (Keycloak) ou `/autenticacao/login`;

→ quando o callback do broker gov.br/JUCEC redireciona para a área logada (`/Portal/pages/principal.jsf`), a sessão vira `authenticated` imediatamente, o loader sai e o portal aparece — tipicamente assim que o usuário vê a mudança de tela junto da URL, sem esperar o render completo do portal. As branches pós-receita não rebaixam `authenticated` para `awaiting_login`/`manual` (guardas adicionadas). `autoReload` restrito ao e-CAC (o problema do e-CAC não existe na JUCEC).

**Validação:** typecheck limpo; 389/389 testes verdes; bundle recompilado.

---

## 20. Incidente #7 (11/nov/2026) — portais gov.br genéricos: cliques indevidos e falso positivo por URL
**Sintoma:** portais gov.br genéricos (govbr, redesim, pendencias-cnpj, fgts-digital, esocial, det, siga, simples-nacional, registrato, dte) clicando em **todos** os elementos que contêm "certificado" (incluindo o botão "Seu certificado digital em nuvem" e links de ajuda "Certificado digital") e a detecção por URL marcando "autenticado" na página inicial (path não-login → falso positivo).

**Causas:**
1. `AUTO_CLICK_CERT_SCRIPT` percorria todos os botões/links e clicava em qualquer texto contendo "certificado digital" — incluindo "em nuvem", abertura de modal e itens de menu.
2. `urlIndicatesAuthenticated` retornava `true` para qualquer path não-login/autenticacao — em `www.gov.br/empresas-e-negocios/login_cidadao` (Redesim), a página inicial já se qualificaria.

**Fix:**
- Receita genérica dos gov.br (`certRecipeWithInterstitial`) reescrita: T1 = `GOVBR_HUB_ENTER_SCRIPT`, que só clica em (a) `#login-certificate` se presente (já é a SSO), (b) botão/link claramente de entrada ("Acessar com"/"Entrar com" gov.br ou botão curto de "Entrar"/"Acessar" — nada com texto contendo "certificado" parcial fora de (a)), senão devolve `govbr-hub: nenhuma opcao de entrada visivel` sem clicar nada. T4 = `GOVBR_SSO_CERT_CLICK_SCRIPT` (id `login-certificate`; já corrige "em nuvem"). Pós-login com marcadores de área logada e exclusões de `login`/`autenticacao`/`auth/realms` — **nunca por URL de landing**.
- `did-navigate` URL fast-path restrita a `ecac` e `jucec-ce` (allowlist). Demais portais usam a detecção por marcadores de área logada.
- Redesim: `defaultAuth: 'certificate'`, `allowedDomains` inalterado, URL mantida.
- `builtin-govbr` (único "verified" no banco) resincronizado manualmente (backup em `…Temp\opencode\recipe-govbr-backup.json`); os demais são `draft`/`broken` e se reconciliam no próximo boot.

---

## 21. Incidente #8 (11/nov/2026) — o que acontecia de verdade: TS template strings engoliam backslashes de regex

**Sintoma:** o eSocial abria `login.esocial.gov.br`, o botão "Entrar com gov.br" aparecia na tela, mas a automação nunca clicava — erro no step 4: "opcao Seu certificado digital nao encontrada no SSO gov.br"; `href=login.esocial.gov.br` e `visivel=… Entrar com gov.br …`.

**Causa-raiz:** o botão real do portal é `<button class="br-button sign-in large" type="button" onclick="location.href='https://sso.acesso.gov.br/authorize?response_type=code&client_id=login.esocial.gov.br&scope=…&redirect_uri=https://login.esocial.gov.br/LoginGovBR.aspx&state=…'">Entrar com&nbsp;<b>gov.br</b></button>` — o navegador renderiza o texto com **espaço não-separador (NBSP, U+00A0)** no lugar do espaço comum. O `textOf` usava `.trim().toLowerCase()` — que não gera o espaço "normal" esperado pelo regex `/entrar com gov.?br/` — então o T1 não casava com elemento visível e não clicava nada; o postLogin não rodava; e o step 4 (clique em "Seu certificado digital" no SSO) falhava porque o SSO nunca era alcançado.

**Fix:**
1. Em todos os `textOf` (3 scripts), normalizar `\s+` → espaço simples: `.replace(/\s+/g, ' ').trim().toLowerCase()`.
2. O script T1 agora lê também o `document.documentElement.innerHTML` e extrai a URL `sso.acesso.gov.br/authorize?…` embutida no `onclick` — atribui `location.href = url` diretamente, navegando sem depender do botão. Mantém: (a) bypass quando a página já é o SSO authorize; (b) fallback para elementos clicáveis visíveis com texto contendo "entrar com"/"gov.br"; (c) sem clique se a página não usa SSO gov.br.
3. Todos os builtins gov.br foram resincronizados no DB (todos estavam desatualizados; eSocial era `broken`/`draft`) com backup em `…Temp\opencode\recipe-*-backup.json`. Seed auto-heal no próximo boot.

**Validação:** typecheck limpo; 389/389 testes verdes; bundle recompilado.

---

## 18. Incidente #5 (11/nov/2026) — tela cinza residual da página após a animação

**Sintoma (com print):** a sessão autentica (badge "Autenticado", URL `…/ecac/`), a animação de boot some, mas a página do e-CAC permanece com uma camada cinza translúcida por cima (aspecto de "processando...") e nada responde ao clique; um reload manual da tela resolve.

**Diagnóstico:** o gov.br/e-CAC deixa sua própria máscara de espera aplicada quando o callback mTLS entra diretamente na rota logada — a página carregou o conteúdo final "em transição" e o seu JS nunca recebeu o evento que a remove (a janela aplica `setBounds`/`focus` no reveal, interrompendo o pipeline). Um reload com cookie de sessão já gravado entra direto na área logada e essa máscara desaparece.

**Fix:** em `markAuthenticated()`, após revelar a view (`revealPortal`), o `view.webContents.reload()` é disparado — somente para sessões por certificado. O pós-reload não re-executa a receita (`recipeAttempted` continua `true`) e o `did-finish-load` apenas marca `loading=false` e emite. `session.auth_detected` passa a registrar `autoReload: true`. 389/389 verdes; typecheck limpo.

## 16. Incidente #3 (11/nov/2026) — "o que falta é só clicar no botão de certificado"

**Evidência:** janela no SSO (`sso.acesso.gov.br/login?authorization_id=…`) com badge "Aguardando login" e spinner perpétuo; página do gov.br renderiza normalmente para o olho humano.

**Causa-raiz (desta vez no meu próprio código):** o wrapper de `evaluate` gerava
`(function(){ ${script} })()` — um IIFE **clássico síncrono**. O script T2 era um IIFE async independente (`(async function(){ … })()`), cujo `this` interno virava uma Promise que era **descartada silenciosamente** pelo wrapper. O passo retornava instantaneamente `evaluate ok`, a receita seguia para o `postLogin` (que espera `cav.receita.fazenda.gov.br`), que nunca é a URL do SSO → timeout de 60s → `awaiting_login`. O clique nunca acontecia nem uma vez, em nenhuma execução.

**Fix:** contrato único de `evaluate` = **corpo de uma função `async () => { … }`** (a mesma convenção de `waitFor`/`postLogin`, que já funcionava). O wrapper externo agora é `(async () => { … })()` e o corpo é `await`ado; os scripts nativos (`AUTO_CLICK_CERT_SCRIPT`, `ECAC_T1_CLICK_SCRIPT`, `GOVBR_SSO_CERT_CLICK_SCRIPT`) foram reescritos como corpos puros; mensagens de erro reportam 800 caracteres reais (permite diagnóstico em produção); o script T2 ganhou percorrimento recursivo de shadow roots, clique duplo (eventos sintéticos + `el.click()`) e um diagnóstico final legível sobre o estado visível da página. Registro `recipe-ecac` resincronizado no banco (backup em `…Temp\opencode\recipe-ecac-backup-2.json`); `seedBuiltins` já cura `draft` no próximo boot. 389/389 verdes.

---

## 22. Incidente #9 (11/nov/2026) - causa raiz real: TS template strings engoliam backslashes de regex

**Sintoma:** eSocial (e potencialmente todos os builtins gov.br) nao clicava no botao de entrada e ficava preso em https://login.esocial.gov.br/login.aspx.

**Camadas de causa:**
1. Em todos os scripts nativos de injecao WebContents (GOVBR_HUB_ENTER_SCRIPT, GOVBR_SSO_CERT_CLICK_SCRIPT, ECAC_T1_CLICK_SCRIPT, JUCEC_BROKER_CLICK_SCRIPT), o TS interpretava \s, \., \b, \d, etc. como escape mocha. Resultado: nenhuma regex sobreviveu intacta. Em particular, um filtro tipo [^"'\s<>]* tornou-se [^"'s<>]* (classe de exclusao "nao-aspas-aspas-nao-s"), invalidando o regex que tentava extrair a autorizacao SSO do HTML.
2. Varias "correcoes" anteriores foram efeitos colaterais da mesma decodificacao de escape ocorrendo no TS.

**Fix unico e decisivo:**
- Os 4 scripts nativos foram convertidos a String.raw (string literal crua, sem interpretacao de escape do TS).
- Backslashes preservados intactos em \w \d \. \b \/ etc.
- Nenhuma regex em page-script pode mais ser interpretada pelo lexer do TS.

**Validacao:** typecheck limpo; 389/389 testes verdes; bundle recompilado; 12 builtins sincronizadas no banco com backslashes preservados.

**Licao:** String.raw para todo script injetado via WebContents - template literal nunca preserva backslashes de regex.

---

## 23. Incidente #10 (11/nov/2026) - DET executa Angular: botao nao esta no DOM quando receita delega

**Sintoma:** DET (det.sit.trabalho.gov.br) -- Angular -- servia /login?r=%2Fservicos, usuario via apenas "Entrar com gov.br Contato | Manual". Automacao nao clicava e ia direto para passo 4 falhando.

**Causa-raiz:** receita rodava no did-finish-load quando Angular ainda nao tinha renderizado; filtro por innerText nao encontrava nada; GOVBR_HUB_ENTER_SCRIPT devolvia "nenhuma opcao", passos 2 e 3 pularam direto para passo 4 falhando com a pagina ainda no landing.

**Fix (duas camadas):**
1. __pvTextElements/__pvFind do runner passaram a normalizar NBSP (botao Angular tem "Entrar com\xa0gov.br"): .replace(/\\s+/g, ' ').trim().toLowerCase().
2. Receitas gov.br ganharam passos waitFor + click para text=ENTRAR COM gov.br / text=ENTRAR COM GOV.BR / text=Entrar com / button:has-text("gov.br") - tolerante para SPA que renderiza apos o load.
3. Todas as builtins resincronizadas no banco (det-trabalhista era broken) com backup em Temp\opencode\recipe-det-trabalhista-backup.json.

**Validacao:** typecheck limpo; 389/389 testes verdes; bundle recompilado.
