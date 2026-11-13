# AurumBit Portal — Plano de Engenharia: Gravação Assistida do Robô de Login

> **Status:** PLANO REVISADO 2026-11-13 (nada implementado). Nenhum arquivo de código foi alterado por este documento.
> **Revisão do dono do produto (2026-11-13):** arquitetura **aprovada** (D1–D14) com **8 correções bloqueantes** (C1–C8), **4 ajustes de escopo** (E1–E4) e **4 adições obrigatórias** (N1–N4) — todos aplicados neste documento nesta data. §14 foi **fechada** com os defaults do produto (A–F). Fora de escopo e critérios de aceitação: §10 e Anexo B.
> **Ordem de execução aprovada:** (1) aplicar C1–C8 neste documento; (2) fechar §14; (3) **hotfix `healCustomServiceRecipes` (D10) ANTES de qualquer código de produção** — o dano é silencioso e contínuo se ignorado; (4) Fase 1 — MVP defensável, sem readiness e sem shadow DOM, `expectedAfter` simples; (5) coleta de telemetria (E2) e só então readiness (Fase 2); (6) reRecord + verificação ritual + e2e completo (Fase 3); (7) shadow DOM/`pierce:` somente se E3 confirmar (Fase 4); (8) polimento + portais reais + OWASP (Fase 5).
> **Decisões de produto já fechadas pelo dono do produto (não reabrir):** ver §1.1 (direção) e §14 (fechamento de 2026-11-13).

Este documento é auto-contido: quem lê amanhã entende o que fazer sem ver o chat. Cada afirmação sobre o código atual traz o caminho e a linha aproximada do arquivo verificado em 2026-11-13. Quando o código mudar, os números de linha mudam — os nomes de arquivo e função são o contrato.

---

## Sumário

1. Contexto e fatos verificados do código atual
2. Decisões de arquitetura (D1–D14)
3. Mecanismo de gravação (recorder) — módulo, injeção, seletores, coalescing, drenagem, placeholders
4. Modelo de etapas gravadas → `RecipeDefinition` — extensão aditiva do schema, origem, ciclo draft→verified
5. Motor de prontidão de página (`readiness`) — sinais, regras por passo, integração (**Fase 2, pós-telemetria E2; não no MVP**)
6. Superfície IPC / preload / contratos — channels, schemas zod, permissões, auditoria
7. Fluxo de criação ("Novo acesso") e "Reconfigurar robô" — wizard dentro do modal, fallback, migração
8. Segurança — zero segredo literal, AAD, allowlist, OWASP básico, limitações honestas
9. Testes — unit, integração, e2e com fixtures
10. Fases de implementação — arquivos tocados por fase, esforço, verificação
11. Riscos top-5 + mitigações (+ riscos secundários)
12. Limitações conhecidas (o que este plano NÃO resolve)
13. Glossário de arquivos
14. **Decisões de produto — FECHADAS (2026-11-13)** (A–F com os defaults do dono do produto)

---

## 1. Contexto e fatos verificados do código atual

### 1.1 Decisões do dono do produto (fechadas — não reabrir)

1. **Ensino do fluxo por gravação assistida:** o app abre o portal, o usuário faz o login uma vez, e o app grava cliques/preenchimentos como etapas do robô **daquele serviço**.
2. As etapas acontecem **dentro do modal "Novo acesso"** (assistente em etapas).
3. O robô dirigido/gravado tem **PRIORIDADE** sobre o agente inteligente atual (`runAgenticLogin`); o agente passa a ser **fallback**.
4. Vale para **cadastros novos** + botão **"Reconfigurar robô"** para acessos existentes.
5. Se a página nunca estabilizar / passar de loading / seletor não achado: **PAUSAR e devolver para o humano** — nunca chutar/clicar errado.

### 1.2 Arquitetura atual (fatos lidos no código, 2026-11-13)

**Stack:** Electron 45 + Next.js 16 (static export em `out/`), local-only; drizzle-orm + better-sqlite3 (`electron/main/db/schema.ts`); React 19 + Tailwind + Radix; zod em `shared/`. **Sem Playwright no robô** — a automação real é `webContents.executeJavaScript()` com timeout rígido + uma `WebContentsView` por sessão de portal. Playwright existe apenas para e2e.

**Tipos de receita** — `shared/recipe.ts`:

- `recipeStepSchema` (:4): `action`, `selectors?` (≤40, cada ≤500 chars), `value?` (≤4000), `key?`, `script?` (≤16 000), `url?`, `urlIncludes?`/`urlExcludes?`, `timeoutMs?` (100–120 000), `optional?`. Geração zod **stripa chaves desconhecidas** — qualquer campo novo DEVE ser declarado no schema para sobreviver ao round-trip salvar→ler.
- `postLoginSchema` (:20): `selectors` (1–20), `timeoutMs` (default 45 000), guardas `urlIncludes`/`urlExcludes`.
- `recipeDefinitionSchema` (:35): `{ version: 1, service, auth, steps: ≤60, postLogin, autoSubmit (default false), onFailure: 'manual'|'abort' (default 'manual'), captchaSelectors?, twoFactorSelectors? }`.
- `RECIPE_PLACEHOLDERS` (:49): `{{credential.username}}`, `{{credential.password}}`, `{{client.document}}`, `{{client.name}}`; `resolveRecipeTemplate` (:56) substitui. A receita **nunca guarda segredo literal** — o render nunca recebe segredo; o main resolve placeholders na memória no momento da execução.
- `RECIPE_ACTIONS` (`shared/constants.ts:136`): `goto | waitFor | waitForURL | click | fill | press | evaluate | assert | sleep`.

**Engine**:

- `electron/main/recipes/runner.ts`: `runRecipe` (:149) itera `recipe.steps`; `safeExecute` (:57) corre `executeJavaScript` contra um timeout (30 s default) e, se o evaluate ficar suspenso (o Electron suspende evaluate até a página "terminar de carregar"), chama `target.stop()` e devolve `null` (passo falha em vez de travar para sempre). `waitForUrlMatch` (:122) faz poll no **processo main** (100 ms) — imune à destruição do contexto da página. `detectInterstitial` (:103) roda antes de CADA passo (captcha/2FA → `status: 'manual'`). `checkPostLogin` (:342) é usado no fast-path e no watcher. Falha de passo ⇒ `status: 'manual'` + `failedStep: index` (a menos que `step.optional`).
- `electron/main/recipes/core.ts`: `FINDER` (String.raw, :25) — `__pvVisible` (computed style + rect), `__pvTextElements` (texto visível exato, depois `a,button,[role=button],input[type=submit]` com `includes`), `__pvFind` (suporta `text=`, `:has-text(...)`, CSS; primeiro match visível vence — `selectors` são tentados em ordem), `__pvSetValue` (proto setter + eventos `input`/`change`). `buildActionScript` (:108) por action; `buildPostLoginScript` (:210); `buildAutoSubmitScript` (:242); `isSensitiveStep` (:275, para filtragem por método); `recipeValues` (:257).
- `electron/main/recipes/agent.ts`: `runAgenticLogin` (:185) — ciclo OBSERVE (`OBSERVE_SCRIPT` :48: readyState implícito via seletores, `userPresent/passPresent/userFilled/passFilled/buttons[]/captcha/twoFactor/loggedIn`) → DECIDE → ACT, máx. **24 iterações**. **Hoje**, em sessões de **SENHA com credencial**, o agente é usado (manager.ts:1004–1027) e **os passos da receita são ignorados** (só `definition.autoSubmit` importa para o agente). Em sessões de **certificado** (ou senha sem credencial) roda `runRecipe`.
- `electron/main/sessions/manager.ts` (`SessionManager`):
  - `open()` (:170): valida serviço/limite; cria `BrowserWindow` (chrome, `SESSION_CHROME_HEIGHT=96`) + `WebContentsView` com `sandbox:true, contextIsolation:true, nodeIntegration:false`, **sem preload**; partição por cliente+certificado; `configureRemoteContents` (:689) trava `will-navigate`/`will-redirect` fora da allowlist e `did-create-window` oculta popups até autenticar.
  - `did-finish-load` (:481): marca `recipeAttempted` e chama `startRecipe` uma vez por sessão.
  - `targetForRecorder()` (:891): adapta a view para `RecipeTarget` (nome histórico; **reaproveitável para o recorder**).
  - `startRecipe()` (:904): fast-path `checkPostLogin` (sessão salva) → executa receita/agente → marca `authenticated` ou `manual`; falhas com captcha/2FA revelam o portal (`revealPortal` :1224); demais falham mantendo oculto. `BOOT_AUTH_TIMEOUT_MS = 60_000` (:66) + `bootSafetyTimer`.
  - `recipeForSession()` (:1123): remove passos que carregam credenciais em sessões de certificado; filtra passos "certificado" em sessões de senha; `autoSubmit:false` para certificado.
  - `startWatcher()`/`watchPostLogin()` (:1164/:1172): poll de pós-login a cada **5 s**, por **10 min**; usa `checkPostLogin`; ao detectar, `markAuthenticated()` (:1194) → `revealPortal()` atômico + (ecac) reload.
  - Sessão de senha interativa (receita com passos que carregam credenciais + `autoSubmit`) ⇒ portal nasce **oculto 0×0** (zero tela) até autenticar ou precisar de humano.
- **DB** (`electron/main/db/schema.ts`): `services` (:99), `credentials` (:125 — `username` **plaintext**, `password_enc` AES-256-GCM com AAD `credentials:{id}:password` via `vault/service.ts`, e **`password_fingerprint`** :139 — HMAC-SHA256 sobre a senha com chave derivada HKDF de propósito `'password-reuse-fingerprint'`, `vault/crypto.ts:97`; comparação timing-safe `constantTimeEqualHex` :101; `wipeBuffer` :110), `recipes` (:154 — `serviceId` unique, `definition_json`, `autoSubmit`, `status draft|verified|broken|disabled`, `lastVerifiedAt`), `sessions` (:174).
- **Repositórios**: `saveRecipe` (`db/repositories/recipes.ts:28`) — parse zod, `status:'draft'`, `version+1` se já existe, preserva `autoSubmit` do definition; `resetRecipe` (:74) — builtins voltam ao seed, custom recebem `buildAutoRecipe` (preservando `autoSubmit`); `recordRecipeOutcome` (:93) — `verified|broken`; `seedBuiltins` + **`healCustomServiceRecipes`** (`db/seed.ts:169`) — roda a cada boot e **reescreve qualquer receita custom cuja definição difira da gerada automaticamente**, pulando apenas `status === 'verified'` (JSON.stringify comparison). **Isto destruiria silenciosamente uma receita gravada** — ver §4.5.
- **IPC** (`electron/main/ipc/index.ts`): padrão `handle(channel, schema, fn)` (:299) — `assertTrustedSender` (só webContents do próprio app; portais nunca são trusted, `ipc/trusted.ts`) + parse zod + `{ ok, value }`. `services:create` (:850) cria o serviço e **gera a receita automática** via `buildAutoRecipe` (`shared/custom-service.ts:240`) salva com `saveRecipe`. `recipes:save` (:944) salva definição arbitrária (validada por zod); `recipes:reset` (:950); `recipes:test` (:956) — só HEAD no baseUrl ("Portal alcançável"), não prova login.
- **Modal** (`src/components/services/service-form-dialog.tsx`, "Novo acesso"): título :302; "Como você entra" radiogroup :357; "Entrar sozinho" switch :247–272 (dentro da seção avançada, só em edição); bloco "Automação deste acesso" :491–562 (Testar lado do site / Regenerar automação / Buscar logomarca / Editor de receita JSON); submit :184–230; footer Cancelar/Salvar :575; hoje **não existe** fluxo de gravação.
- **Testes**: unit em `tests/unit/*.test.ts` (vitest, environment `node`, alias `@shared`), e2e Playwright com portal HTTPS local (`tests/e2e/helpers/https-server.ts` — login com form `#user/#pass`, `TEST_USER/TEST_PASSWORD`, `/painel` pós-login com cookie; `tests/e2e/helpers/app.ts` — `launchAurumBitPortal`, `seedDatabase`, `E2E_LOGIN_RECIPE` semeia receita `verified`). `npm test` = `vitest run`; `npm run test:e2e` = build + playwright. `jsdom` **está** no devDependencies (27.2.0) — usável para testar scripts injetados. `vitest.config.ts` tem thresholds de coverage (80/75) para `electron/main/recipes/core.ts` e `shared/*`.
- **Segurança/logs**: `logger` (`electron/main/logger.ts`) passa tudo por `redactRecord` (`security/redaction.ts`) — chaves `pass|senha|secret|token|pfx|cookie...` → `[REDACTED]`; `redactUrl` limpa query sensível e credenciais embutidas. Auditoria `appendAuditEvent` também redige. **Senha da credencial só é revelada no main** (`revealCredential`), vive em variáveis locais e é zerada (`username = ''` após uso em `startRecipe` :1039).

**Bug latente / armadilha verificada (ler com atenção):** `healCustomServiceRecipes()` (`electron/main/db/seed.ts:169`, chamado no boot em `electron/main/index.ts:189`) compara a definição armazenada com `buildAutoRecipe(...)` via `JSON.stringify` e **sobrescreve** receitas custom não-`verified` que diferem — o que inclui **qualquer** receita gravada. Sem correção, a receita gravada do usuário sumiria no próximo boot e o cadastro pareceria "regenerar sozinho". Este é um requisito de primeira ordem do plano (§4.5), não um detalhe.

### 1.3 O que se quer construir (resumo)

Um fluxo de **Gravação Assistida**: dentro do modal "Novo acesso", o usuário (1) preenche o básico, (2) opta por **Ensinar o login**; o app abre o portal em sessão real; o usuário faz o login **uma vez**; o app grava cliques/preenchimentos como etapas do robô **daquele serviço**; na revisão, o usuário salva a receita gravada (`origin: 'recorded'`), que passa a ter **prioridade** sobre o agente inteligente (que vira fallback); para acessos existentes, um botão **"Reconfigurar robô"** inicia a mesma gravação; se a página nunca estabilizar ou um seletor não for achado, o fluxo **PAUSA** e devolve para o humano — nunca chuta.

---

## 2. Decisões de arquitetura (D1–D14)

Formato: decisão — justificativa — alternativa rejeitada.

- **D1. A gravação é um modo de sessão, não um subsistema de BrowserWindow nova.** Reusa a máquina existente de `SessionManager.open()` (partição, allowlist, `configureRemoteContents`, popups ocultos, orçamento de sessão). A diferença é um flag interno `recording` no `ManagedSession` + injeção/drenagem de scripts. *Alternativa rejeitada:* janela de gravação separada com outra stack — duplicaria toda a camada de segurança que já existe (allowlist de navegação, downloads bloqueados, permissões negadas).
- **D2. O recorder vive DENTRO da `WebContentsView`, comunicando-se por `executeJavaScript` (o mesmo canal do runner).** O main injeta um script de captura com listeners em **fase de captura** (`addEventListener(..., true)`) e faz **drain** periódico (lê e esvazia um buffer `window.__aurumbitRec`). O portal **nunca** ganha `ipcRenderer`/preload — o `TrustedContentsRegistry` continua recusando qualquer IPC vinda dele. *Alternativa rejeitada:* Chrome DevTools Protocol (`webContents.debugger`) — attach de debugger no modo packaged traz banner/permissão extra e é frágil entre versões; e IPC direto do portal para o renderer — violaria o limite de confiança (o portal seria capaz de forjar "etapas" e injetar passos `evaluate` arbitrários no robô).
- **D3. Etapas gravadas viram `RecipeDefinition` estendido — `version` permanece `1`.** Todas as extensões são campos **opcionais** no schema zod (retrocompatível; receitas antigas e builtins continuam válidas e funcionando). Ver §4. *Alternativa rejeitada:* `version: 2` — invalidaria de graça as 22+ receitas builtin e o heal; o schema é um superconjunto, não uma ruptura.
- **D4. Segredos nunca são persistidos nem logados: campos de senha e usuário são gravados como placeholders `{{credential.password}}`/`{{credential.username}}`.** A decisão de COMO mapear o valor digitado → placeholder: **fingerprint HMAC-SHA256 da credencial candidata** para senha (a coluna `password_fingerprint` já existe; `vault.fingerprintPassword` re-deriva o HMAC do texto digitado em memória; comparação `constantTimeEqualHex`). Para usuário, **igualdade normalizada** (trim + colapso de espaços; CPF/CNPJ só dígitos; e-mail lowercase) contra os `username` armazenados (plaintext) e `{{client.document}}`. **Justificativa do fingerprint vs. igualdade crua:** (i) comparar com a senha revelada exigiria *descriptografar* a credencial só para gravar — o fingerprint funciona **sem abrir o cofre**; (ii) a comparação é timing-safe e não coloca o segredo em variável JS de vida longa no main; (iii) a infraestrutura (HKDF `'password-reuse-fingerprint'`, `constantTimeEqualHex`) já existe e já é auditada. Igualdade com a senha revelada funcionaria igualmente, mas é estritamente pior (AAD `credentials:{id}:password` precisa ser aberto; segredo existe em plaintext por janela maior). Se o fingerprint **não** bater (senha digitada ≠ credencial salva), a etapa ainda usa `{{credential.password}}` — o usuário está ensinando "o login DESTA credencial" — mas a revisão mostra aviso destacado ("a senha digitada não confere com a credencial salva; a etapa usará a credencial selecionada"). **Nunca** gravamos o valor literal de um campo de senha, mesmo que o fingerprint falhe.
- **D5. A gravação registra PASSOS POR "TELA" (T1, T2, …).** O main fecha a tela corrente em cada navegação (`did-navigate`/`did-finish-load`) e abre a próxima; o limite de 60 passos conta o total. Navegações que ocorrem ≤5 s após um clique gravado são absorvidas como **pós-condição** desse clique (`expectedAfter.urlIncludes` = host+path da URL de destino, sem query volátil); caso contrário viram passo `waitForURL` standalone. Ver §3.5 e §4.1.
- **D6. O robô gravado tem prioridade; o agente é fallback apenas PRÉ-EFEITO.** Em `startRecipe`, se existe receita com `origin === 'recorded'` e `steps.length > 0`, executa-se `runRecipe`; o `runAgenticLogin` só é chamado como fallback quando a receita falha **no passo 0** com **`failureCode === 'element-not-found'`** (**C7** — nada foi clicado/preenchido/submetido; o portal mudou desde a gravação; string-matching de mensagem é proibido). Em qualquer outro ponto de falha, ou com qualquer outro `failureCode`, PAUSAR → humano (regra 5 das decisões do dono). A decisão é extraída como função pura **`shouldFallbackToAgent(result: RunRecipeResult): boolean`** em **`electron/main/recipes/fallback.ts`** (aditivo, testável isolado; nunca dentro de `manager.ts`/`runner.ts`). *Alternativa rejeitada:* fallback total após qualquer falha — risco de double-submit (clicar "Entrar" 2×) e de o agente "consertar" uma gravação que estava em captcha/2FA.
- **D7. PAUSAR devolve para o humano com o MESMO protocolo do fluxo atual:** `status: 'manual'` (+ `requiresHumanAction` quando o portal precisa ser mostrado) → `revealPortal` → tela `/session` exibe `statusMessage` + botão "Abrir o portal mesmo assim". Não inventamos canal novo de erro. Ver §5.6.
- **D8. A prontidão de página é um NOVO módulo, `electron/main/recipes/readiness.ts`, e é ADITIVO ao runner.** Cada passo vira: esperar pronto → verificar pré-condição → agir → verificar pós-condição → ou PAUSAR. O `waitForUrlMatch` atual continua valendo para `waitForURL`. *Alternativa rejeitada:* embutir tudo dentro de `runner.ts` — infla um arquivo já crítico e impossibilita testes unitários de prontidão isolados.
- **D9. Medição de rede ociosa sem `webRequest` no hot path.** Sinal primário: sonda in-page (`readyState` + janela quieta de `PerformanceResourceTiming`, ver §5.2). `session.webRequest` só seria usado como corroborador **em sessões de gravação** (opcional, para feedback "página ainda carregando…"), nunca em todas as sessões — mudar o hot path de todas as 22+ receitas builtin por um sinal indireto seria risco desnecessário. *Alternativa rejeitada:* `webRequest` global — conflita com a evolução futura das sessões e não resolve SPAs com polling eterno melhor que a janela quieta.
- **D10. O heal só toca no que ele sempre tocou; receitas gravadas são intocáveis pelo boot.** `healCustomServiceRecipes` passa a pular definições com `origin === 'recorded'` (ou qualquer passo com `source: 'recorded'`). Test de regressão obrigatório. Ver §4.5. **Esta é a correção pré-Fase 1 (hotfix de boot, Parte 7 da revisão) — não espera fase.**
- **D11. Verificação é um RITUAL EXPLÍCITO, pós-salvamento:** gravar **não** prova que o login funciona. Após salvar, o wizard oferece **[Testar login de verdade]** — abre uma sessão real com a credencial escolhida; se autenticar, o código existente (`recordRecipeOutcome(…, 'verified')` em `startRecipe`) marca a receita como `verified`. Sem esse teste, a receita permanece `draft` (e continua executável — igual ao comportamento atual do `draft`). *Alternativa rejeitada:* marcar `verified` no salvamento — seria mentir ao usuário.
- **D12. Por padrão, MVP NÃO grava valores de campos não-credenciais.** Campo que não casa com credencial/cliente nem é senha ⇒ etapa registrada como clique/preenchimento de contexto, mas o valor literal é **descartado** com aviso na revisão ("campo 'conta' não foi gravado"). Opt-in "gravar este valor" é proposta V2; a decisão de produto está **FECHADA em §14-B: descartar valor + aviso** (única opção honesta). *Alternativa rejeitada:* cifra de valores não-credenciais na receita — violaria a regra de ouro do projeto (receita nunca carrega segredo) e criaria oráculo para CPF/contas bancárias de terceiros.
- **D13. Zero novas dependências para o MVP.** Tudo com Node/Electron/browser APIs existentes (`PerformanceResourceTiming`, `TreeWalker`, `crypto.createHmac` via vault já existente, zod, drizzle). `jsdom` (já em devDependencies) nos testes. Se algo faltar, só entra com justificativa escrita neste documento.
- **D14. A gravação cria o serviço ANTES de gravar (fluxo criar→gravar).** O wizard do modal "Novo acesso" salva o serviço primeiro (mesmo `services:create` de hoje, que deixa a receita **automática** no lugar), depois oferece a gravação como passo opcional que, ao salvar, **sobrescreve** a receita automática via `recipes.save` (que já existe). *Alternativa rejeitada:* gravar antes de criar — a credencial ainda não existe para casar fingerprint, e abortar a gravação deixaria serviço meio-criado; "criar primeiro, ensinar depois" também dá o botão [Pular por agora] de graça (= comportamento de hoje). Ver §7.

---

## 3. Mecanismo de gravação no `WebContentsView`

### 3.1 Visão geral e ciclo de vida

Novo módulo main-side: **`electron/main/recipes/recorder.ts`** (builders de script injetado + compilador de eventos→`RecipeDefinition` parcial) e estado de gravação no `SessionManager` (`recorder: RecorderState | null` dentro de `ManagedSession`, só preenchido quando a sessão nasce em modo gravação — §6.4 `openRecorder`).

Ciclo de vida (referência: decisões D1/D2):

```
armar (openRecorder)        → injetar em did-finish-load, escutar navegação, drenar a cada 250 ms
gravar (usuário age)        → eventos empilhados no buffer da página (window.__aurumbitRec)
concluir (wizard:finish)      → última drenagem → page buffer apagado → sessão descartada → compilar → revisão
cancelar/fechar/erro        → buffer apagado, listeners removidos (página destruída mesmo), nada persistido
```

Garantias de ciclo de vida:

- O recorder só é armado em sessão criada por `openRecorder` (§6.4). Em sessões normais, nada é injetado — **o recorder não existe no código quente do portal**.
- Ao destruir a sessão (Concluir, Cancelar, fechar janela, `render-process-gone`, `did-fail-load`), `disposeRecorder()` remove listeners injetados (via `executeJavaScript` com o token `window.__aurumbitRec`), zera o buffer e limpa os timers. Se a página já morreu, só os timers e o estado main são limpos.
- Enquanto grava, a sessão **nunca** roda `startRecipe` (guarda `recipeAttempted` é substituída pela guarda `recorder !== null` no handler de `did-finish-load`). O usuário não pode ser "atropelado" por cliques do robô.
- Uma gravação por vez por app (o botão "Ensinar o login"/"Reconfigurar robô" fica desabilitado no modal enquanto houver `wizardId` ativo; o `SessionManager` expõe `hasActiveRecorder()`).
- **Teto de duração da gravação (N1):** `RECORDING_MAX_DURATION_MS = 15 * 60_000` (exportado de `shared/constants.ts`). Aos **10 minutos**, o wizard mostra aviso **"a gravação será encerrada em 5 min"** (toast + banner na etapa "Gravando…"). No teto, a gravação **AUTO-FINALIZA como draft parcial** — mesma UX e mesmo caminho de C5 (usuário vai direto para a revisão com aviso destacado). Nunca perde trabalho silenciosamente. Custo ~10 linhas + 1 teste (`recording teto 15min auto-finaliza como draft parcial`).

### 3.2 Estratégia de injeção

O script do recorder (builder `buildRecorderScript({ token })`) é avaliado na página com `webContents.executeJavaScript(...)` dentro de `safeExecute` (limite rígido 5 s; em timeout, `target.stop()` como no runner — nunca travar).

**Listeners em fase de captura** (`useCapture = true`), no `document`:

| Evento | Fase | O que registra |
|---|---|---|
| `click` | captura | elemento clicado (via `event.target`), se interativo (§3.4) |
| `input` | captura | valor digitado em `input/textarea` (debounce por campo, §3.6) |
| `change` | captura | selects (valor escolhido), radio/checkbox (estado) — commit imediato |
| `keydown` | captura | apenas `Enter` (submit implícito) — demais teclas ignoradas |
| `blur` | captura (`focusout`) | commit do fill pendente do campo |
| `submit` | captura | marca o form enviado (contexto para compilar `press Enter → submit`) |

Por que captura: portais gov.br usam frameworks que fazem `stopPropagation` em bubble — captura no `document` garante observação sem que o portal perceba diferença. Nossos listeners **não** chamam `preventDefault`/`stopPropagation` nunca: a gravação é um observador passivo; o usuário usa o portal normalmente (digita a senha real, clica Entrar de verdade).

**Shadow DOM (open) — piercing [REVISADO — Fase 4, CONDICIONAL à E3]:** **Antes de implementar qualquer coisa desta subseção e o `pierce:`/`__pvFindDeep`**, verificar se ALGUM dos 3 portais-alvo (ISS Fortaleza, e-CAC, gov.br SSO) usa shadow DOM **aberto** no fluxo de login (checagem manual de 30 min por portal com DevTools). Se **nenhum** usar, **CORTAR `pierce:` do MVP inteiro** (economiza ~3 dias e 1 arquivo novo em `core.ts`) e **documentar a decisão neste documento** (editar esta seção e §4.3/§10/§13). Se ao menos um usar, implementar na **Fase 4** apenas — nada de shadow DOM na Fase 1. O texto abaixo descreve o mecanismo **caso a Fase 4 aconteça**:

1. No momento do evento, resolve o elemento de destino profundo com `deepActiveElement()`/`deepElementFromPoint(event.clientX, event.clientY)`: descida recursiva por `shadowRoot` abertos (`el.shadowRoot`), atravessando `slot`s, até a folha. `document.elementsFromPoint(x, y)` retorna o caminho em caso de sobreposição (o último é o mais profundo útil).
2. O seletor é gerado contra a cadeia profunda (§3.4) com **path through shadow** codificado como `host >>> shadowRoot >>> elemento` — representado no dado gravado como lista de "segmentos". Decisão: etapas em elementos dentro de shadow DOM aberto usam um seletor especial `pierce:hostSelector>>>innerSelector` (novo prefixo, resolvido por `__pvFindDeep` no `core.ts` — ver §4.3) em vez de CSS puro. Shadow **fechado** é inalcançável por qualquer script — limitação declarada (§12).
3. Sondas de estabilização e visibilidade usam o mesmo walker (`__pvDeepQueryAll(selector)` percorrendo a árvore + todos os `shadowRoot` abertos).

**Convivência com navegação durante a gravação (o problema central):** páginas que destroem o documento (full load, ASP.NET postback, `location.href=`) levam junto `window.__aurumbitRec`. Estratégia:

1. `did-finish-load` → main **re-injeta** o script e incrementa `screenId` (T1→T2→…). O `did-finish-load` já existe no `SessionManager` (manager.ts:481) — o branch de recorder entra ANTES do `startRecipe`.
2. Cada tela gravada herda o número da navegação: eventos drenados antes da navegação são carimbados com a tela antiga (o main registra "limite de tela" e injeta `expectedAfter` na última etapa, ou um `waitForURL` standalone se a navegação não seguiu clique — §3.5).
3. **Eventos podem ser perdidos** entre `unload` e a re-injeção (janela de milissegundos). Mitigações: (a) drain a cada **250 ms** (o usuário humano não clica 2× em 250 ms de modo que ambos se percam por navegação); (b) `pagehide`/`beforeunload` flush best-effort (drain síncrono no próprio handler — executado como último ato da página, ainda no contexto vivo); (c) a tela review mostra a contagem de etapas por tela — se o usuário navega e desconfia que "perdi uma tela", ele vê a contagem por tela e pode regravar. **Assumido e documentado** (§12): perda zero não é garantida em navegação full-load; é garantida em SPA/navegação in-page (`did-navigate-in-page`), onde nada é destruído.
4. `did-navigate-in-page` (SPA) também troca de tela (T→T+1) porque o *conteúdo* mudou — mas sem re-injeção obrigatória (o documento persiste); a re-injeção é idempotente (token existente ⇒ reinstala listeners, preserva buffer e `screenId` incrementado pelo main via `executeJavaScript('window.__aurumbitRec.screen = "T3"')`).
5. `did-fail-load` durante gravação ⇒ toast no modal + estado `error` do wizard, buffer preservado para revisão até o usuário decidir (nada perdido, nada salvo).

### 3.3 Buffer e drenagem (pull, nunca push)

- Buffer em página: `window.__aurumbitRec = { token, screen, seq, events: [], secrets: [] }`. Cada evento é JSON-pequeno (< 1 KB) e **nunca contém o valor digitado** — o valor (quando necessário ao fingerprint) vive transitoriamente em `secrets[n]` e o evento carrega só `valueRef: n` (ver §3.6/§3.7). Ambos os lados são zerados a cada drain.
- **Drain** (a cada 250 ms e forçado em `pagehide`/Concluir): main executa `buildDrainScript()` → recebe e zera `events` atomicamente (`const out = events.splice(0, events.length)`). Retorna `{ events, url, title, readyState }`.
- Drenagem passa por `safeExecute` (timeout 5 s). Em falha, um contador `drainFailures` incrementa; após 5 falhas consecutivas o wizard mostra "não estou conseguindo falar com a página — conclua ou cancele a gravação" (nunca silencioso).
- `seq` monotônico detecta buracos (`seq esperado ≠ recebido` ⇒ evento perdido por navegação) — o wizard registra `gaps: number` e avisa na revisão se > 0.

### 3.4 Geração de seletores ESTÁVEIS

Hierarquia de preferência (primeiro que existir **e** for único-visível vence; TODOS os candidatos viáveis são guardados no passo em `selectors[]`, ordenados — o runner já tenta em ordem e o primeiro match visível público ganha em `__pvFind`):

1. **`#id`** — somente se estável: regex `^[A-Za-z][A-Za-z0-9_:-]{1,63}$` **e não** casar "cara de dinâmico": rejeitar se contém ≥6 dígitos consecutivos, GUID (`[0-9a-f]{8}-[0-9a-f]{4}`), padrão `ember\d+`, `:r[0-9]+:`/`:R[0-9a-z]+:` (React useId), `ng-\d+`, sufixos `__\d{6,}`, hash hex ≥16, ou se `document.querySelectorAll('#'+id).length !== 1`.
2. **`[name="…"]`** — sempre estável quando único e visível (campos CPF/CNPJ, `username`, `password`, `otp`…). Escape de aspas no valor.
3. **`[data-testid]`, `[data-test]`, `[data-qa]`, `[data-cy]`, `[data-automation-id]`** — na ordem listada; gov.br usa testid com moderação, mas quando existe é o mais robusto.
4. **ARIA:** `[role="…"][aria-label="…"]` (role+label juntos), senão `[aria-label="…"]` sozinho, senão `input[placeholder]` como último ARIA (placeholder muda com idioma — usar só se nada mais restar).
5. **Texto visível** para elementos acionáveis: `text=Entrar` / `:has-text('Entrar')` (suporte já existe em `__pvFind`, String.raw, `core.ts:25`). Para botões/links/`input[type=submit]`, o texto exato visível (normalizado: `replace(/\s+/g,' ').trim()`), lowercase não — o `__pvFind` já normaliza case.
6. **Caminho CSS com índice** (fallback final): de `html` até o alvo com `nth-of-type` onde há irmãos, profundidade máxima 8, segmentos com `>` (ex.: `main > form:nth-of-type(2) > button:nth-of-type(1)`). Marcado `confidence: 'low'` (ver abaixo).
7. **Shadow path** (§3.2) quando aplicável: `pierce:host>>>inner`.

**Confiança** gravada por passo (`confidence: 'high'|'medium'|'low'` — vira `label`/nota na revisão, não bloqueia):

| Origem do seletor escolhido | Confiança |
|---|---|
| id/name/data-testid único | high |
| aria/role único | high |
| texto visível único | medium |
| caminho CSS com índice | low |
| qualquer um com múltiplos matches visíveis ao gravar | rebaixa 1 nível (high→medium, medium→low) |

**Validação ao gravar:** ao montar cada candidato, o script injetado conta matches visíveis *no momento do clique* e registra `matchCount`. Isso alimenta a revisão ("`#cpf` encontra 1 elemento ✓") e a rebaixa de confiança acima. Nenhum seletor identificado como `low` sozinho impede salvar — mas a revisão destaca ("este passo pode ser frágil; prefira regravar se o portal usa telas dinâmicas").

**Limites:** seletores ≤ 500 chars (já é o máx. do schema); candidatos por passo ≤ 6 (truncar os menos confiáveis); steps com zero candidatos válidos viram etapa `click` com `selectors: []` **rejeitada no finish** (o wizard exige ≥1 candidato ou descarta o evento com aviso — nunca salva etapa cega).

### 3.5 Telas e navegação: compilação clique → pós-condição

O main mantém `screens: ScreenRec[]` (`{ id: 'T1'…, urlAtEntry, urlAtExit }`). Ao detectar navegação (`did-navigate` / `did-navigate-in-page` / `did-finish-load` novo documento):

- Se a navegação ocorreu **≤ 5 s após** uma etapa gravada com `action in (click, press, fill+submit)`: funde — a etapa ganha `expectedAfter: { urlIncludes: [pathPrefix(urlDestino)] }` (path sem query; prefixo em vez de equality para absorver `;jsessionid` e afins; `stripVolatileQueryParams` para dropar `session_code`/`state`/`cid` etc. — reaproveitando `shared/custom-service.ts:181`). NENHUM passo `waitForURL` é criado (economizam-se etapas; ver limite 60).
- Caso contrário (redirect meta-refresh, JS post-login, SSO bounce): insere passo standalone `{ action: 'waitForURL', urlIncludes: [host+path], timeoutMs: 15000 }`.
- URLs gravadas NUNCA carregam query volátil (mesma doutrina de `normalizeBaseUrlInput`); URLs com query são recusadas como `goto` e convertidas em `waitForURL` (goto só para navegações "de verdade" disparadas pelo usuário fora de formulários, o que é raro no fluxo de login).
- `expectedAfter` é **opcional** e só o recorder preenche; receitas `auto` não têm (comportamento do runner inalterado — pós-condição só é checada quando presente, §5.4).

### 3.6 Coalescing, dedupe, limite

**Fills (campos de texto):**

1. Por campo, `input` reinicia um debounce de **400 ms**; o fill só é "commitado" no blur/`change`/Enter/navegação/finish. Isso evita gravar "52998" → "529982" → …
2. Commit = evento `fill` com valor (que será **descartado/trocado por placeholder** na drenagem, §3.7) + metadados do campo (`type/name/id/autocomplete/aria-label/placeholder/labelText` — label do `<label for>` ou texto do label pai).
3. Preencheu o mesmo campo duas vezes na gravação ⇒ só a última vale (replace in-place no buffer; o seq não muda).

**Clicks:** dedupe de cliques consecutivos no mesmo seletor-âncora dentro de **800 ms** (double-click humano vira 1 etapa). Clique em elemento não interativo (`div` decorativo) é descartado.

**Selects:** `change` commita imediatamente; valor escolhido → placeholder ou descarte com aviso (D12). **Checkboxes/radios:** `click` gravado como `click` (replay ree-clica; estado resultante é o mesmo que o usuário produziu).

**Enter:** `keydown Enter` commita fills pendentes e registra `press` somente se o foco está em campo de texto **ou** há `form` ancestral (submit implícito). Enter solto em lugar neutro do documento é descartado.

**Limite de 60 etapas (C5):** contagem contínua; ao atingir 60, o wizard entra em estado `stepCapReached` e **AUTO-FINALIZA como draft parcial** — o usuário é levado direto para a revisão com aviso destacado: *"a gravação excedeu 60 etapas; remova passos antes de testar"*. O trabalho **não** se perde: `wizard:save` valida `steps.length ≤ 60` no salvamento (o excedente é removido pelo usuário na revisão — ver **N3**) e a revisão mostra a lista completa com **remover etapa por passo** (N3). Testes: `stepCapReached auto-finaliza como draft parcial`. *Alternativa considerada e rejeitada:* subir o limite do schema de 60 para 80 e manter a pausa — preferimos a auto-finalização com remoção na revisão (não infla o contrato zod nem as receitas builtin). Na prática coalescing mantém fluxos de login reais (9–25 etapas) bem abaixo do teto.

**Dedupe global no finish:** passos `sleep` nunca são gravados (o readiness espera pela página de verdade); cliques consecutivos idênticos fundidos; `waitFor` redundante antes de `waitForURL` fundido.

### 3.7 O que cruza a página → main: placeholders, NUNCA literais

**No commit de cada fill, o script injetado NÃO guarda o valor no evento.** Em vez disso guarda `valueRef`: o índice de um side-buffer separado `window.__aurumbitRec.secrets[n] = valor`. A drenagem transporta ambos em memória (mesmo processo main; IPC interno do Electron, nunca rede). No main, para cada `fill` drenado:

1. Lê `secrets[valueRef]`; **zera imediatamente** `secrets[valueRef] = ''` (e o script zera o side-buffer a cada drain).
2. Classifica o campo (prioridade):
   a. `type=password` ou `autocomplete=current-password|new-password` ou name/id casa `/pass|senha|pwd/i` → **campo de senha**: `vault.fingerprintPassword(valor)` vs. `credentials.passwordFingerprint` da(s) credencial(is) vinculada(s) à sessão de gravação (D4). Iguais (constantTimeEqualHex) → `value: '{{credential.password}}'`, `match: 'fingerprint'`. Diferente → `value: '{{credential.password}}'` + `warning: 'credential-mismatch'` (placeholder mesmo assim, D4). **`credentialId` ausente (C2/N2)** — novo serviço sem credencial default para (cliente, serviço) — → `value: '{{credential.password}}'` + `warning: 'no-credential-bound'` e **fingerprint NÃO é executado** (não há contra o que comparar; comparar contra "a primeira do cliente" gera mismatch falso em todo serviço novo). A revisão mostra *"Vincule uma credencial a este acesso depois em Editar → Credenciais"* — sem bloquear o salvamento.
   b. Campo usuário-símile (`type=text|email|tel|number` com hint `user|login|cpf|cnpj|email|matrícula|inscrição|conta|documento|identi` — mesma heurística do agente, `agent.ts:62`) → `{{credential.username}}`; se normalizado == `client.document` (só dígitos) → `{{client.document}}`; se vazado/demais → `{{credential.username}}` + warning.
   c. `autocomplete=one-time-code` / name casa `/otp|codigo|2fa|token/i` → **descartar valor**, gravar só `fill` com `value: ''` + `warning: 'otp-not-recorded'` e na replay o passo vira `optional: true` (OTP é por definição não reproduzível; ver §12).
   d. Demais campos → **descartar valor**; etapa vira `click`-equivalente contextual? Não: vira `fill` com `value: ''` marcado `needsManualValue` na revisão ("preencha 'conta' manualmente ao logar — não gravamos este dado"), ou descartada por completo com aviso listado. Decisão MVP (**§14-B fechada: descartar**): **etapa `fill` com `value: ''` + `optional: true` + aviso na revisão**, para preservar a estrutura do fluxo sem inventar dado.
3. **Nada é logado**: `logger`/`audit` recebem apenas metadados (`match`, `warning`, nome do campo — nome de campo é benigno, ≤80 chars, sanitizado), nunca `valueRef` contents.

**A gravação NUNCA descriptografa a senha** (fingerprint usa só a coluna HMAC). O `{{credential.password}}` no replay é resolvido por `resolveRecipeTemplate` no momento da execução, como já acontece hoje — com `isSensitiveStep` seguindo válido.

### 3.8 Drenagem × navegação: flush forçado

Em todo `did-navigate`/`will-navigate` do recorder (main-side), o main dispara drain **síncrono imediato** antes de trocar a tela (o documento antigo ainda responde em `executeJavaScript` durante `will-navigate`? **Não garantido** — durante a transição o evaluate pode falhar com "context destroyed"). Por isso: (1) o flush de `pagehide` no próprio documento (§3.2, item 3b) é a garantia primária — o handler roda com o contexto ainda válido; (2) o drain do main é o caminho normal (250 ms); (3) `did-fail-load` não destrói o buffer do main (os eventos já drenados ficam na memória do wizard). Ordem no finish: drain final → apagar buffer da página (se viva) → descartar sessão → compilar do estado main.

---

## 4. Modelo de etapas gravadas → `RecipeDefinition`

### 4.1 Extensão ADITIVA e retrocompatível do schema (`shared/recipe.ts`)

`version` permanece **`1`**. Todos os campos novos são opcionais; gerações antigas de receitas (builtin, auto, editadas à mão no editor JSON) continuam parseando e rodando sem alteração.

```ts
// shared/recipe.ts — recipeStepSchema, campos NOVOS (opcionais)
export const recipeStepSchema = z.object({
  // ...campos existentes inalterados...
  /** Rótulo visível do alvo no momento da gravação ("Entrar", "Seu certificado digital"). Puramente cosmético (revisão/logs). */
  label: z.string().min(1).max(80).optional(),
  /** Origem da etapa. Só o recorder preenche. */
  source: z.enum(['recorded']).optional(),
  /** Tela (documento) em que a etapa foi gravada: 'T1', 'T2'… (máx. 60 telas). */
  screen: z.string().regex(/^T\d{1,2}$/).optional(),
  /** Confiança do seletor escolhido ao gravar. */
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  /** Pós-condição: o que DEVE ser verdade após a ação para seguir o fluxo. */
  expectedAfter: z
    .object({
      /** host+path (sem query volátil) que a URL deve passar a conter. */
      urlIncludes: z.array(z.string().min(1).max(500)).max(5).optional(),
      /** Marcador que deve existir/visível após a ação. */
      selectors: z.array(z.string().min(1).max(500)).max(10).optional(),
      /** Janela para a pós-condição se confirmar (default 8000). */
      timeoutMs: z.number().int().min(500).max(60_000).optional(),
    })
    .optional(),
  /** Por passo: espera de prontidão específica desta etapa (sobrepõe o default da receita). */
  readinessMs: z.number().int().min(0).max(60_000).optional(),
})

// recipeDefinitionSchema, campos NOVOS de topo (opcionais)
export const recipeDefinitionSchema = z.object({
  // ...inalterado...
  /** Origem da receita. 'auto' = buildAutoRecipe; 'recorded' = Gravação Assistida; builtins omitem. */
  origin: z.enum(['auto', 'recorded']).optional(),
  /** Metadados de gravação (auditoria/diagnóstico). Nunca valores. */
  recordedAt: z.string().datetime().optional(),
  recordedScreens: z.number().int().min(0).max(60).optional(),
})
```

Compatibilidade verificada:

- zod `.object()` **stripa** chaves desconhecidas — declarar os campos acima é o que permite o round-trip `saveRecipe → getRecipeByService`. Sem esse passo, o round-trip apagaria `label/source/screen/confidence/expectedAfter` silenciosamente (verificado: `saveRecipe` faz `recipeDefinitionSchema.parse` e persiste o resultado, `db/repositories/recipes.ts:33/45/58`).
- `isSensitiveStep` (`core.ts:275`) e `stepCarriesCredentials` (`custom-service.ts:214`) continuam corretos (placeholders são o que carregamos).
- `recipeForSession` (manager.ts:1123) filtra por placeholder — funciona para gravadas sem alteração.
- Limites mantidos: `steps ≤ 60`, seletores ≤500, `timeoutMs ≤ 120_000`.
- `RECIPE_ACTIONS` **não muda**: `goto | waitFor | waitForURL | click | fill | press | evaluate | assert | sleep` continuam suficientes (a gravação não precisa de ação nova; o prefixo de seletor `pierce:` vive em `selectors[]`, não em `action`).

**Exemplo completo de receita gravada** (portal gov.br com SSO, T1=página inicial, T2=SSO): ver Anexo A — inclui `origin: 'recorded'`, placeholders, `expectedAfter` no clique "Fazer login", `confidence` por passo, 4 etapas.

### 4.2 O que vira passo quê (compilação eventos → etapas)

| Evento drenado | Etapa(s) gerada(s) |
|---|---|
| `click` interativo | `click` com `selectors[]` ordenados por confiança, `label` ("Entrar"), `screen`, `confidence`, `source:'recorded'` + `expectedAfter` se houve navegação ≤5 s |
| `fill` (texto) | `fill` com `value: '{{credential.username}}'` / `{{credential.password}}` / `{{client.document}}` / `''` (caso descartado) |
| `change` em `<select>` | `fill` (value do select, via placeholders ou `''` + aviso) — o `__pvSetValue` do core já trata `HTMLSelectElement` por value/text |
| `click` em checkbox/radio | `click` (sem `value`) |
| `keydown Enter` submit | `press` com `key: 'Enter'` ancorada no campo (selectors = campo focado) — só se não seguido de `click` no botão de submit (auto-dedupe; se ambos, fica o clique) |
| navegação ≤5 s pós-clique | `expectedAfter` fundido no clique (não gera etapa) |
| navegação "solta" | `waitForURL` standalone (`urlIncludes: [host+path]`, sem query) com `timeoutMs: 15000` |
| `submit` de form | (contexto apenas; nada emitido) |
| evento em campo one-time-code | `fill` com `value: ''`, `optional: true`, aviso na revisão |

### 4.3 Seletor `pierce:` — onde vive e como o runner aprende

> **[E3 — CONDICIONAL]** Só implementar se a checagem da Fase 4 confirmar uso de shadow DOM aberto em ≥1 dos 3 portais-alvo. Caso contrário, **CORTAR `pierce:` do MVP** (~3 dias a menos, sem `core.ts` tocado no MVP) e marcar esta subseção como "não implementado — decisão E3 (2026-11-13), sem necessidade nos 3 portais-alvo".

O recorder pode emitir seletores `pierce:<host-css>>>><inner-css>` (§3.2). O executor (`core.ts`) ganha um resolvedor análogo a `__pvFind`: `__pvFindDeep(selectors)`:

- para seletores normais: comportamento idêntico ao atual (reaproveita `__pvFind`);
- para seletores com prefixo `pierce:`: divide no `>>>`, resolve o host com o FINDER normal, atravessa `shadowRoot` aberto recursivamente resolvendo o inner, aplica a mesma regra de "primeiro match visível".

`buildActionScript`, `buildWaitScript`, `buildPostLoginScript` e `buildDetectScript` passam a chamar `__pvFindDeep` — mudança estritamente interna ao `core.ts`, mesma assinatura, zero mudança para builtins. (Shadow DOM fechado: inalcançável — §12.)

### 4.4 Associação serviço ↔ receita gravada ("a receita DAQUELE serviço")

> **C1 — `wizard:save` REUTILIZA da receita existente; não recria do zero.** Para serviço **novo**, a receita automática acabou de ser salva por `services:create` (ipc/index.ts:850); para **re-record**, a receita corrente é a base. Em ambos os casos o `wizard:save` **substitui APENAS** `steps`, `origin`, `recordedAt`, `recordedScreens` e **REUTILIZA da receita anterior**:
> - `postLogin` (selectors, timeoutMs, urlIncludes, urlExcludes),
> - `captchaSelectors`,
> - `twoFactorSelectors`.
>
> Sem essa regra, o parse zod falha ou o pós-login nunca detecta sucesso (`checkPostLogin` morto) — o Anexo A mostra uma receita gravada **com** `postLogin`: é a exata origem desses três campos. O toggle "Entrar sozinho" da revisão controla apenas `autoSubmit`. **Teste obrigatório:** *"wizard:save preserva postLogin/captcha/2fa da receita anterior"* (unit; ver §9.1 e Anexo B).

- Receitas vivem na tabela `recipes` com `serviceId` UNIQUE (`schema.ts:171`) — a gravação **é** a receita do serviço, não um artefato separado. O review salva via `saveRecipe(db, serviceId, definition)` (existente) com `definition.origin: 'recorded'`.
- `saveRecipe` hoje força `status: 'draft'` — correto para gravada (nada provado ainda; §4.6) e reseta `lastVerifiedAt` — comportamento exatamente desejado; nenhuma mudança no repositório além de nada.
- **Deduplicação com o automático:** para serviço recém-criado, a receita automática acabou de ser salva por `services:create` (ipc/index.ts:850–874); o salvamento da gravada **substitui** (mesma unique key), com `version: existing.version + 1`, `autoSubmit` **preservado do toggle da revisão** (o usuário escolhe "Entrar sozinho?" na tela de review; o default é o do automático, que é `true` para custom via `buildAutoRecipe`).
- **Sessões abertas no momento do salvamento:** uma sessão já em `startRecipe` carregou a definição na memória — a gravada vale a partir da **próxima** abertura. (Sem invalidação em voo; documentar.)
- **Qual método (`auth`)?** Gravada herda o método escolhido no wizard (`password` ou `certificate`). Para `certificate`, `recipeForSession` já remove passos `{{credential.*}}` — e o wizard de certificado avisa que campos de usuário/senha não serão preenchidos nesse modo (o usuário gravou clicando "Seu certificado digital", que é o fluxo correto).
- **Auditoria:** `recipe.recorded` (novo tipo em `AUDIT_TYPES` + `audit('recipe.recorded', 'recipe', recipe.id, { serviceId, version, screens, warnings })`) — **sempre** sem valores; `warnings` é lista de códigos (`credential-mismatch`, …), não texto livre do portal.

### 4.5 O heal do boot e a receita gravada (correção obrigatória)

`healCustomServiceRecipes()` (`electron/main/db/seed.ts:169`) compara `existing.definition` com `buildAutoRecipe(...)` via `JSON.stringify` e **reescreve o que difere** (exceto `status === 'verified'`). Uma gravada difere sempre → sumiria no boot seguinte. Correção (**HOTFIX PRÉ-FASE 1 — Parte 7, item 3; bloqueante, não espera fase**):

```ts
// ANTES de calcular `expected`/comparar:
if (existing.definition.origin === 'recorded') continue        // gravadas nunca são "curadas"
// (defesa em profundidade) + se qualquer passo tiver source === 'recorded': também skip
```

- Verificação: teste unitário dedicado (`tests/unit/heal-recorded.test.ts`, **entregue junto com o hotfix**) semeando custom + gravação fake → `healCustomServiceRecipes` → assert definição intacta; `verified` continua intocado; automática divergente não-gravada continua sendo regenerada. E2E boot-roundtrip (abre e fecha o app) como prova de integração na Fase 3.
- O heal também é como o `resetRecipe` de **custom** se baseia em `buildAutoRecipe` — "Regenerar automação" continua sendo **voltar para o automático** (apaga a gravada, com `autoSubmit` preservado). "Reconfigurar robô" (§7.3) grava de novo. São ações irmãs, nomes distintos na UI — nenhum dos dois é ambíguo.
- **Builtins:** o heal atual nem toca builtins (`seedBuiltins` separado, e heal só itera custom). Gravada para builtin: **não permitida no MVP** (botão "Reconfigurar robô" só em serviços não-builtin; §7.3). Decisão de produto registrada em §14-A.

### 4.6 Ciclo `draft` → `verified`: gravar ≠ funcionar

Gravar prova apenas que o **humano** conseguiu entrar com o fluxo — não que o robô reproduz. Semântica mantida (igual ao automático de hoje):

```
gravar + salvar        → status 'draft', lastVerifiedAt null
[Testar login de verdade] (sessão real; receita executa; post-login detecta)
    sucesso            → recordRecipeOutcome('verified')  (código EXISTENTE em startRecipe)
    falha              → failedStep !== null → 'broken' (código existente) — o wizard então oferece:
                         [Regravar] [Manter mesmo assim (volta a draft via salvar de novo)] [Voltar ao automático]
```

Ritual na UI: tela "Verificação" (etapa 4 do wizard — entregue na **Fase 3**) com texto honesto: *"A gravação ensina o caminho. Ainda não testamos se o robô acerta sozinho. [Testar agora] abre o portal com a credencial escolhida — leva uns 20 s."* Botões: **[Testar agora]** (abre sessão `forceNew`) e **[Testar depois]** (fecha o wizard; a receita fica `draft` e funciona normalmente na próxima abertura). **Ao clicar em "Testar depois"**, mostrar um **toast informativo não bloqueante** (**§14-C fechada**): *"Recomendamos testar antes de confiar no robô — você pode testar depois abrindo o acesso."* **Nunca bloquear.**

O teste usa **o MESMO canal de abertura de sessão de sempre** (`sessions.open`) — nenhuma ferramenta paralela. O audit registra o evento existente `session.opened`/`credential` com **`origin: 'verify-test'` no metadata** do evento (**§14-F fechada**) — **nenhum tipo de auditoria novo** é criado.

`recipes.test` (IPC atual) **não** é suficiente e segue como está ("Portal alcançável") — usado só como sinal de reachability, nunca como verificação de login.

### 4.7 Origem, `autoSubmit` e interação com `stepCarriesCredentials`

- `origin` vive no JSON (sem migração de schema). Trade-off aceito: sem invariante de banco (ex.: duas receitas com origin arbitrário). Não é problema real — zod + `saveRecipe` são a única porta de escrita.
- Gravada com passos `fill` + `autoSubmit: true` ⇒ sessão de senha **oculta** (fluxo zero-tela atual se comporta igual para automático) — funciona porque `stepCarriesCredentials` casa o placeholder. Gravada **sem** nenhum passo com placeholder (ex.: só cliques) + `autoSubmit: true` ⇒ **não** esconde a tela (nenhum passo carrega credencial; e autoSubmit sem senha seria inútil) — comportamento coerente com a regra atual de ocultação.
- Sessão de **certificado** gravada: `recipeForSession` filtra passos com `{{credential.*}}` (nenhum existiria) e `autoSubmit` é forçado `false` — ok.

---

## 5. Motor de prontidão de página (`electron/main/recipes/readiness.ts`)

> **[REVISADO — E1/E2] `readiness.ts` NÃO entra na Fase 1.** O MVP (Fase 1) usa alternativa simples: `waitForUrlMatch` (atual) + `buildWaitScript` (pré-condição atual) + **`expectedAfter` simples** (checagem de URL com timeout curto). Isso já entrega valor (criar → gravar → salvar → reusar). `readiness.ts` entra na **Fase 2, DEPOIS de coleta de telemetria (E2)**: um **probe de MEDIÇÃO APENAS** (sem mudar comportamento) em **10 logins reais nos 3 portais-alvo** (ISS Fortaleza, e-CAC, gov.br SSO) coleta `waitedMs` / `readyState` / `pendingResources` / nomes de recursos. A heurística de §5.3 é **calibrada contra esses dados, não intuição**: mediana de `waitedMs` < 2 s ⇒ janela de 800 ms mantida; > 5 s ⇒ aumentar a janela; polling eterno real ⇒ a isenção usa os **nomes reais observados** (não a regex genérica). O restante desta seção descreve o motor **da Fase 2** e suas regras.

Regra de ouro (decisão fechada nº 5): **página estabilizou → agir; página nunca estabilizou → PAUSAR e devolver para o humano. Nunca chutar/clicar errado.**

### 5.1 O que "a página está pronta" significa neste app

Uma página é **pronta** para um passo quando, na avaliação da sonda:

1. `document.readyState === 'complete'` (não exigimos `'interactive'` — SPAs gov.br ficam em `interactive` por longos períodos com recursos pendentes);
2. **Nenhum "ocupador" visível**: não há match visível para `[aria-busy="true"], [role="progressbar"], [role="status"][aria-live], .spinner, .loading, .carregando, [data-loading="true"], progress` (visibilidade = mesma regra `__pvVisible` do core) e o `<body>` não tem `aria-busy="true"`;
3. **Janela quieta**: nenhum `PerformanceResourceTiming` com `startTime` nos últimos `quietMs` (default **800 ms**) — ou seja, nenhum recurso NOVO começou a carregar na janela; recursos em andamento podem existir (polling), desde que a janela esteja quieta. (`performance.getEntriesByType('resource')` filtrado por `entry.startTime > now - quietMs` — contar entradas com startTime recente é O(#recursos); em páginas pesadas (milhares de entries), usar `performance.setResourceTimingBufferSize(300)` no primeiro arm do recorder ou aceitar o custo — 1–2 ms, desprezível com 300 entradas.)
4. **URL estável** por `quietMs` (main-process: `target.getURL()` igual em 2 amostras consecutivas separadas por `quietMs/2`).

Sinais **não usados** (e por quê):

- `window.onload`: o Electron suspende `executeJavaScript` até a página "parar de carregar" — portais ASP.NET/PrimeFaces nunca disparam `load` de forma confiável (o código já documenta isso no `safeExecute`). Não dá para esperar `load`; por isso a janela quieta substitui.
- `session.webRequest` global: mudaria o hot path de todas as sessões e não distingue polling de carga real (D9).
- MutationObserver de "DOM assentou": frágil em SPAs que vibram o DOM eternamente; a janela quieta de rede + ausência de busy é o sinal operacional correto. (MutationObserver ainda é usado **localmente e barato**: para a pós-condição "DOM estabilizou" por X ms, opcional, como verificação pós-ação — ver §5.4.)

### 5.2 Implementação: `readiness.ts`

Novo arquivo. API mínima e testável (sem estado global):

```ts
export interface ReadinessOptions {
  /** Janela quieta em ms (default 800). */
  quietMs?: number
  /** Teto da espera inteira (default 12_000). */
  timeoutMs?: number
  /** Seletores de busy EXTRAS da receita (ex.: overlay específico do portal). */
  busySelectors?: string[]
  /** sleep injetável (testes). */
  sleep?: (ms: number) => Promise<void>
  /** now injetável (testes). */
  now?: () => number
}

export interface ReadinessReport {
  ready: boolean
  /** 'complete' | 'interactive' | 'loading' | 'unknown (probe falhou)' */
  readyState: string
  urlStable: boolean
  busyVisible: boolean
  pendingResources: number   // quantos começaram na janela (diagnóstico, "0" = quieta)
  waitedMs: number
  detail: string             // sempre PT-BR, sempre SEM valores da página
}

export async function waitForReady(
  target: RecipeTarget,
  opts?: ReadinessOptions,
): Promise<ReadinessReport>

/** Falha DURA = página destruída/probe impossível 2× consecutivas: lança ReadinessProbeError. */
export class ReadinessProbeError extends Error {}
```

Núcleo da sonda (`buildReadinessProbeScript`, executado via `safeExecute` com timeout 4 s): retorna `{ readyState, busyVisible, recentResourceCount, urlStable }`. Se `safeExecute` devolver `null` (página ocupada/destruída): **uma** nova tentativa após 400 ms; segunda falha ⇒ `ReadinessProbeError` (≠ "página não pronta"; é falha dura — impossível avaliar a página). Política de erro duro por contexto:

- **runner**: trata como falha do passo → PAUSAR (§5.4) — nunca segue no escuro;
- **recorder**: mantém gravação, marca a tela "não confiável" na revisão;
- **agent**: igual ao runner.

### 5.3 Heurística quieta com FALLBACK para SPAs de polling eterno (risco nº 2 — calibração pela telemetria E2)

> **[E2]** Os defaults abaixo são **hipóteses a validar**, não verdades: a janela de 800 ms e a lista de padrões de polling só são adotadas após a medição (10 logins, 3 portais). Resultados reais substituem esta subseção — editar este documento com os dados coletados é parte do entregável da Fase 2.

Problema real: portais com `setInterval`/long-poll/WebSocket revalidam a cada poucos segundos para sempre — `recentResourceCount` pode ser **sempre > 0** e a página "nunca" fica quieta por esse critério puro. Solução em camadas:

1. **Classificação do tráfego recente:** recursos com `initiatorType === 'xmlhttprequest'|'fetch'` cujo `name` casa `/poll|refresh|heartbeat|ping|status|events|notification/i` **ou** que repetem a mesma URL nas últimas 3 amostras contam como *ruído de polling* e são **isentos** da janela quieta. Recursos de documento (`initiatorType === 'navigation'`), scripts, styles, fontes, imagens, e XHR/fetch sem padrão de polling **contam**.
2. **Candidato a "pronto" mesmo com polling:** se `busyVisible === false` **e** `readyState === 'complete'` **e** URL estável por `quietMs` **e** zero recursos **não-isentos** na janela → pronto (o polling não impede).
3. **Janela quieta adaptativa:** se 2 amostras seguidas tiverem apenas ruído de polling, aceita-se pronto mesmo assim (item 2 cobre; isto é o racional dele, não regra extra).
4. **Fallback duro:** esgotado `timeoutMs` sem pronto → **PAUSAR** (§5.4), exceto passos `optional: true` (pula com log `readiness_skipped_optional`) e exceto `sleep`/`waitForURL` (que têm semântica própria). O portal **não** é chutado; o usuário entra na mão. Este é o comportamento exigido pela regra 5 das decisões fechadas — o fallback NÃO é "prosseguir assim mesmo".
5. O relatório (`waitedMs`, `busyVisible`, `pendingResources`) vai para `statusMessage` quando há pausa: *"A página não estabilizou (ex.: portal continua carregando um componente). O acesso foi pausado para você concluir manualmente."* — sem jargão, sem valores.

### 5.4 Regras de execução POR PASSO — o protocolo ESPERAR→CHECAR→AGIR→VERIFICAR

> **C7 — `failureCode` estruturado no retorno de `runRecipe`** (aditivo; não quebra nada existente). Enumeração: **`'element-not-found' | 'selector-not-found' | 'readiness-timeout' | 'post-condition-failed' | 'probe-error' | 'budget-exhausted'`**.
> - Pré-condição (item 4) não achada ⇒ `element-not-found`.
> - Prontidão estourada (item 3) ⇒ `readiness-timeout`.
> - Pós-condição (item 6) não confirmada ⇒ `post-condition-failed`.
> - Probe impossível 2× (§5.2) ⇒ `probe-error`.
> - Orçamento global esgotado ⇒ `budget-exhausted`.
> - `selector-not-found` fica **reservado** (ex.: etapa compilada sem nenhum candidato válido — hoje rejeitada no finish; enumerado para não reabrir o enum depois).
>
> O fallback do agente (D6/§2) testa **`result.failureCode === 'element-not-found' && result.failedStep === 0`** via `shouldFallbackToAgent()` (`electron/main/recipes/fallback.ts`, função pura). Nenhuma comparação por mensagem.

Novo wrapper interno ao `runRecipe` (o que cada pausa significa para o usuário está em §5.6):

```
para cada passo i:
  1. if target.isDestroyed() → error (como hoje)
  2. detectInterstitial (como hoje)
  3. (NOVO) espera de prontidão — exceto goto (loadURL é a espera) e sleep
        r = await waitForReady(target, { quietMs: step.readinessMs ?? 800, timeoutMs: min(12000, step.timeoutMs ?? 12000) })
        (busySelectors vem apenas dos defaults do módulo + overlays conhecidos do portal; captchas/2FA NUNCA contam como "busy" — são interação humana, não progresso de carregamento)
        se ReadinessProbeError → PAUSAR 'manual' (failedStep: i) · failureCode: 'probe-error'
        se !r.ready no timeout → PAUSAR 'manual' com mensagem §5.3.5 (ou skip se optional) · failureCode: 'readiness-timeout'
  4. PRÉ-CONDIÇÃO — element existe+visível+clicável (para click/fill/press/waitFor/assert):
        verificação barata via buildWaitScript(selectors, preGap=600ms) — se NÃO achar:
            re-espera prontidão UMA vez (busy tardio) com timeout restante do passo e tenta de novo
            se ainda não achar → PAUSAR 'manual' (comportamento atual de "elemento não encontrado", mensagem idêntica à de hoje) · failureCode: 'element-not-found'
        goto: validar allowlist (como hoje) ; waitForURL: waitForUrlMatch (como hoje)
  5. AGIR (buildActionScript, como hoje; safeExecute 30 s)
  6. (NOVO) PÓS-CONDIÇÃO — somente se o passo traz expectedAfter:
        aguardar até timeoutMs (default 8 s): URL contém urlIncludes  OU  marcador selectors existe
        confirmado → segue
        não confirmado → PAUSAR 'manual' com failedStep=i e failureCode: 'post-condition-failed' e mensagem:
            "Após '<label>' o portal não chegou a <host esperado>. Pausado para você."
        sem expectedAfter → sem checagem (receitas builtin/auto inalteradas no comportamento)
  7. navigate iniciado como side-effect de click/press (URL mudou no act) → opcional: aguardar ready 1ª tela (did-finish-load) antes do próximo passo — feito pelo passo seguinte de qualquer forma (item 3).
```

**Nenhuma pré/pós-condição nova é imposta a passos sem `expectedAfter`** — builtins e automáticas ficam byte-idênticas no caminho feliz, exceto pela espera de prontidão (item 3), que só TORNA O ROBÔ MAIS PACIENTE, nunca mais arriscado: o único efeito de falha extra possível é PAUSAR em vez de tentar um clique cego, exatamente o exigido.

**Timeouts e orçamento:**

- `quietMs` default 800; `timeoutMs` da prontidão por passo default 12 000 (cap 30 000);
- `expectedAfter.timeoutMs` default 8 000 (cap 60 000);
- `step.timeoutMs` continua 30 000 default (schema ≤120 000) e segue governando o `safeExecute` do act;
- **orçamento global do robô**: `RECIPE_GLOBAL_BUDGET_MS = 120_000` (env `AURUMBIT_RECIPE_BUDGET_MS` sobrepõe) — o loop soma `Date.now()` gasto; esgotado ⇒ PAUSAR com mensagem clara e **`failureCode: 'budget-exhausted'`** (hoje não existe teto global; uma receita com 60 passos × 30 s nunca terminaria — este teto é aditivo e seguro);
- o budget do **agente** (24 iterações) ganha o mesmo teto de parede por sessão de login (120 s) — impede laço eterno em portal patológico.

### 5.5 Integração nos três lugares

**a) `runner.ts` (`runRecipe`)** — o wrapper §5.4 envolve o loop atual. `safeExecute`, `waitForUrlMatch`, `detectInterstitial` permanecem com as mesmas assinaturas e semântica. Novo parâmetro opcional em `RunRecipeOptions`: `busySelectors?: string[]` (para portais com overlay pesado conhecidos; vem de `RecipeDefinition.captchaSelectors`? **Não** — campo próprio `readinessBusySelectors?` opcional seria extensão; MVP: só os seletores default + os de 2FA/captcha NUNCA são busy (são interação, não progresso)).

**b) `agent.ts` (`runAgenticLogin`)** — mesma regra 3 entre iterações: antes de cada OBSERVE, `waitForReady` com budget 4 s (barato: probe única, não loop longo — se não pronta, dorme 400 ms e re-observa; o loop já desiste sozinho em 24 iterações). Após cada ACT que provavelmente navega (CLICK_CTA/ADVANCE/SUBMIT), 800 ms + probe. Sem mudança no OBSERVE→DECIDE→ACT em si.

**c) Watcher de pós-login (`watchPostLogin`, manager.ts:1172)** — NÃO espera prontidão (o usuário pode estar SABIDAMENTE no meio de um diálogo de 2FA; 5 s/10 min poll está certo); apenas passa a respeitar o budget global do fluxo. Nenhuma mudança de comportamento. **Na sessão de GRAVAÇÃO este watcher NÃO roda (C3)** — a detecção "Parece que você entrou ✓" é uma sonda leve e separada do wizard (ver §6.4 e §7.1), que nunca chama `markAuthenticated`/`revealPortal`/reload.

### 5.6 O que o usuário vê (PT-BR) — mapeamento de falha → UX

| Situação | Status na `/session` | `statusMessage` (texto exato sugerido) | Portal |
|---|---|---|---|
| Esperando página ficar pronta (normal) | `awaiting_login` | "Aguardando o portal carregar…" | oculto (senha interativa) / visível |
| Prontidão estourou no passo N | `manual` + `requiresHumanAction: true` | "A página do portal não estabilizou. Pausamos aqui para você concluir com segurança." | **revelado** |
| Pré-condição (seletor) não achada após 1 re-espera | `manual` (+ `failedStep`) | "Não encontramos '<label ou seletor>' na página — o portal pode ter mudado. Pausamos para você." | revelado se captcha/2FA detectado; senão mantém estado e botão "Abrir o portal mesmo assim" (padrão atual) |
| Pós-condição (`expectedAfter`) não confirmada | `manual` (+ `failedStep`) | "Após '<label>' o portal não chegou onde esperávamos. Pausamos para você." | revelado |
| Budget global esgotado | `manual` | "O acesso demorou mais que o esperado. Pausamos para você concluir." | revelado |
| `ReadinessProbeError` (probe impossível/destruída) | `error` ou `manual` | "O portal não está respondendo à automação. Use o modo manual." | revelado |
| Robô caiu no passo 0 (fallback agente) | `awaiting_login` | "Automação reaprendendo a página…" | (o agente assume; ver D6) |
| Robô OK de verdade (pós-login detectado) | `authenticated` | "Login detectado automaticamente." | revelado (atômico) |

Todos os textos passam pelo `statusMessage` já renderizado em `src/app/session/page.tsx` (linhas ~447–518) — nenhuma tela nova para esse fluxo de erro. O robô gravado usa o MESMO canal. Internamente, toda falha carrega `failureCode` (C7, ver §5.4) — o fallback do agente (D6) consome apenas `element-not-found` no passo 0; as demais falhas pausam para o humano, sem ambiguidade.

### 5.7 Interação com o ciclo de vida da receita

- `startRecipe`: sem mudança na ordem geral; o `runRecipe` agora simplesmente falha mais cedo e com mensagem melhor. `failedStep` continua alimentando `recordRecipeOutcome(…, 'broken')`.
- `recipeForSession`: inalterado.
- **Verificação pós-gravação** (§4.6): usa a MESMA máquina (a receita gravada roda real; readiness protege; pós-login detecta; outcome vira `verified`). Nenhuma ferramenta de teste paralela — o teste É a abertura normal da sessão.

---

## 6. Superfície IPC / preload / contratos

### 6.1 Novos channels (`shared/contracts.ts`, bloco `wizard` + `recipes.reRecord`)

Todos os handlers seguem o padrão existente `handle(channel, zodSchema, fn)` (`ipc/index.ts:299`) — `assertTrustedSender` obrigatório (a porta não pode ser aberta pela página do portal, que **nunca** é trusted) + parse zod + `{ ok, value }`.

```ts
// shared/contracts.ts — IPC (const IPC)
wizard: {
  startRecord: 'wizard:startRecord',   // cria a sessão de gravação + devolve { wizardId, sessionId }
  state:       'wizard:state',         // poll do modal: progresso/etapas/avisos da gravação
  finish:      'wizard:finish',        // conclui a gravação ⇒ compila ⇒ devolve revisão
  cancel:      'wizard:cancel',        // descarta gravação (buffer apagado), sessão fechada
  save:        'wizard:save',          // salva a receita gravada na revisão (saveRecipe)
  discard:     'wizard:discard',       // mantém a receita automática (desfaz a gravada em memória)
},
recipes: {
  // ...existentes get/save/test/reset...
  reRecord: 'recipes:reRecord',        // "Reconfigurar robô": == wizard:startRecord com serviceId existente
},
events: {
  // ...existentes...
  wizardProgress: 'wizard:progress',   // **throttled 1/s** (ou a cada N eventos), com flush imediato em start/finish/cancel (C8 — nunca 4 msgs/s × 10 min)
},
```

Schemas zod (em `shared/contracts.ts`, junto aos demais):

```ts
export const wizardStartRecordSchema = z.object({
  serviceId: idSchema,
  clientId: idSchema,
  authMethod: authMethodSchema,                 // 'certificate' | 'password'
  /** **Opcional (C2).** Ausente ⇒ gravar com {{credential.*}} + warning 'no-credential-bound';
   *  fingerprint NÃO é executado (N2). Nunca bloqueia o salvamento. */
  credentialId: idSchema.nullish(),
})
export const wizardWizardIdSchema = z.object({ wizardId: idSchema })
export const wizardSaveSchema = z.object({
  wizardId: idSchema,
  autoSubmit: z.boolean(),                      // toggle "Entrar sozinho" da revisão
  /** N3: etapas removidas pelo usuário na revisão (índices 0-based). O servidor
   *  descarta e valida steps.length ≤ 60 (C5). */
  removedStepIndexes: z.array(z.number().int().min(0).max(59)).max(60).optional(),
})
export const recipeReRecordSchema = z.object({ serviceId: idSchema })
```

`wizard:save` (implementação): descarta `removedStepIndexes`, valida `steps.length ≤ 60` (C5 — se ainda exceder, erro claro em vez de salvar fluxo truncado), **REUTILIZA da receita corrente** `postLogin`/`captchaSelectors`/`twoFactorSelectors` e substitui apenas `steps`, `origin: 'recorded'`, `recordedAt`, `recordedScreens` (**C1** — ver §4.4).

`wizard:state` devolve:

```ts
{
  wizardId: string,
  status: 'recording' | 'finishing' | 'review' | 'saved' | 'error',
  stepCount: number,
  screenCount: number,
  gaps: number,                    // eventos perdidos por navegação (seq faltante)
  warnings: Array<{ code: 'credential-mismatch' | 'no-credential-bound'
                       | 'value-not-recorded' | 'otp-not-recorded'
                       | 'low-confidence' | 'seed-lost'
                       | 'step-cap-reached'        // C5: gravação atingiu 60 etapas; salva-se como draft parcial
                       | 'recording-max-duration';  // N1: teto de 15 min atingido; idem draft parcial
                       detail: string }>,
  /** Só em status 'review'/'saved': */
  definition?: RecipeDefinition,   // compilada, para o <details> "ver etapas" da revisão
}
```

`detail` é sempre texto de metadado (nome do campo, etc.) — **nunca** valor digitado.

### 6.2 Preload (`electron/preload/index.ts`) e renderer (`src/lib/api.ts`)

```ts
wizard: {
  startRecord: (input) => call('wizard:startRecord', input),
  state:       (wizardId) => call('wizard:state', { wizardId }),
  finish:      (wizardId) => call('wizard:finish', { wizardId }),
  cancel:      (wizardId) => call('wizard:cancel', { wizardId }),
  save:        (input) => call('wizard:save', input),
  discard:     (wizardId) => call('wizard:discard', { wizardId }),
},
recipes: { ...existentes, reRecord: (serviceId) => call('recipes:reRecord', { serviceId }) },
onWizardProgress: (callback) => subscribe('wizard:progress', callback),
```

O modal usa `onWizardProgress` para o contador ao vivo + `state()` a cada 1 s como fallback (a view do portal não pinga o renderer; quem puxa é o main).

### 6.3 Permissões e allowlist — mantidas integralmente

- **Nada novo é permitido ao portal.** O recorder não usa preload na view, não registra webContents como trusted, não abre canais IPC a partir da página. Toda comunicação é main→page (`executeJavaScript`) e page→main (retorno do evaluate, em memória).
- **Navegação continua sob `will-navigate`/`will-redirect`** (`manager.ts:692/700`) — durante a gravação, o usuário só chega a hosts gov/allowlist; URLs fora dela são bloqueadas (e a etapa que apontaria para lá é rejeitada no finish).
- **Downloads** seguem bloqueados por extensão (`.exe` etc., manager.ts:68) nas sessões de gravação.
- **Popups/OAuth** (gov.br abre popup às vezes): mesma regra de hoje — popup oculto até autenticar (`shouldHidePopupsNow`), registrado como `child` da sessão de gravação; cliques **no popup não são gravados** no MVP (seletor `pierce:` não cobre documento separado; ver §12). O fluxo gov.br típico desenha tudo na mesma página — ok.
- `before-input-event` F12 continua bloqueado em packaged; DevTools aberto na gravação continua possível em dev para diagnóstico (rec process segue vivo).
- `select-client-certificate` (mTLS) — inalterado (`sessions/selection.ts`); a sessão de gravação de certificado passa pelo mesmo allowlist de thumbprints; a gravação não altera o handling de certificado.
- **Auditoria (novos tipos em `shared/constants.ts` `AUDIT_TYPES`)**: `recipe.record_started`, `recipe.record_finished` (fields: `serviceId`, `screens`, `stepCount`, `warnings`), `recipe.record_discarded`, `recipe.recorded`, **`recipe.record_interrupted`** (C4 — gravação morta por kill/crash do app; detectada no próximo boot). Todas sem valores — seguem pelo mesmo `redactRecord` do `appendAuditEvent`. Nenhum tipo existente é alterado. O "Testar login de verdade" **não** cria tipo novo: o evento existente `session.opened`/`credential` carrega `origin: 'verify-test'` no metadata (§14-F).

### 6.4 Interno ao main: `openRecorder` no `SessionManager`

Não é IPC — é método do `SessionManager` chamado por `wizard:startRecord`:

```ts
async openRecorder(input: { serviceId, clientId, authMethod, credentialId? }): Promise<{ sessionId: string; wizardId: string }>
```

- Replica `open()` com `isRecording: true` em `ManagedSession` (refactor extraído: `createSessionView(service, client, …)` compartilhado entre `open()` e `openRecorder()` — o diff em `open()` é mínimo e mecânico).
- **Diferenças vs. sessão normal:** portal nasce **visível** (o usuário vai operar: sem zero-bounds, sem `hidePortal`); `did-finish-load` arma o recorder em vez de `startRecipe`; título "Gravação assistida — <serviço>"; `reuseKey` único não-reusável (`recording:<wizardId>`) para `open()` jamais devolver a sessão de gravação por engano; sessão de gravação não conta no limite de sessões simultâneas? **Conta** — usa a mesma cota (honestidade: 1 gravação + 19 sessões; evita cota zero-infinita).
- **C3 — a sessão de gravação NUNCA chama `startRecipe` nem `watchPostLogin`** (e portanto nunca `markAuthenticated` → `revealPortal` → reload — esse reload destruiria o buffer de eventos). O wizard roda sua **própria sonda leve** (`wizardProbe`: `checkPostLogin` contra a página aberta, **1× a cada 2 s**) que **APENAS** mostra o banner *"Parece que você entrou ✓ — [Concluir gravação]"*. A sonda **nunca age sozinha**: nunca conclui, nunca revela, nunca recarrega, nunca marca nada. Testes: `gravação com cookie de sessão válido não dispara markAuthenticated`.
- **C4 — fechar a janela do app / sair com gravação ativa:** `BrowserWindow.on('close')` e `app.on('before-quit')` verificam `hasActiveRecorder()`; se verdadeiro, **bloqueiam a saída** com dialog *"Gravação em andamento será perdida. Sair mesmo assim?"* (Confirmar → `disposeRecorder()` + sair; Cancelar → abortar saída). Também cobre `before-quit` disparado por menu Sair / tray / Cmd+Q. Em **crash/kill** (sem handler possível): o audit `recipe.record_interrupted` (§6.3) é escrito no `openRecorder` e limpo no fim normal (`finish`/`cancel`); no **próximo boot**, a ausência de `record_cleared` + presença de `record_interrupted` → toast *"A última gravação foi interrompida"*. Custo ~30 linhas + 1 teste.
- `disposeRecorder()` no caminho de fechar a sessão — idempotente; limpa buffer, timers, listeners (se a página ainda viver).
- Sem persistência do **progresso**: ao reabrir após crash, não há rascunho de etapas (o usuário recomeça; aceito, §12) — o que existe é só o aviso de interrupção (C4).

### 6.5 `recipes:reRecord` vs. `wizard:startRecord`

- `wizard:startRecord`: usado pelo modal no fluxo de CRIAÇÃO (após `services:create`, §7.2).
- `recipes:reRecord`: "Reconfigurar robô" para acessos EXISTENTES (§7.3) — valida não-builtin + serviço válido + método permitido; devolve `{ wizardId, sessionId }` idêntico. Mesma implementação, dois pontos de entrada com validações diferentes. Nunca toca a receita até `wizard:save` (o automático continua valendo enquanto a gravação está em curso).

---

## 7. Fluxo de criação e "Reconfigurar robô"

### 7.1 UX dentro do modal "Novo acesso" — assistente em etapas

Hoje: um único formulário (`service-form-dialog.tsx`, título "Novo acesso" :302). Passa a ter **3 etapas** (progress "1 de 3 · 2 de 3 · 3 de 3" no header do Dialog; etapas 2–3 só aparecem na criação, após salvar o básico):

**Etapa 1 — Dados básicos (inalterada no conteúdo).**
Nome, endereço, "Como você entra nesse site?" (certificado/senha/os dois). Botão do footer passa de "Adicionar site" para **"Salvar e continuar →"**. O submit mantém a semântica atual (`services.create` → `buildAutoRecipe` salva automático). Erro: fica na etapa 1.

**Etapa 2 — "Quer ensinar o login ao AurumBit?"**
Card com ilustração/ícone (`GraduationCap` ou `MousePointerClick` do lucide — sem assets novos) + texto honesto:

> "Em vez de adivinhar a tela de login de cada portal, você pode mostrar **uma vez** como entrar. O AurumBit observa os cliques e os campos (usuário e senha viram referência à credencial — **nunca gravamos o que você digitou**) e repete sozinho nas próximas vezes. Você confere tudo antes de salvar."

- Escolha de credencial (apenas `password` e **OPCIONAL — C2**): para serviço NOVO não existe credencial para (cliente, serviço) ainda (credenciais são por cliente+serviço). `credentialId` é **opcional** em `wizard:startRecord`; a regra é: **se ausente, fingerprint NÃO é executado** (N2) — sem "fallback para a primeira do cliente" (era a fonte do credential-mismatch falso em TODO serviço novo; eliminada). O wizard resolve assim:
  1. `Select` "Qual cliente usa este acesso?" lista os clientes — obrigatório para `password` (para `certificate` a gravação não depende de credencial — campo oculto). Credencial default do (cliente, serviço) é pré-selecionada **quando existir** (re-record); para serviço novo, normalmente vazia.
  2. Logo abaixo, bloco colapsável **"Cadastrar a credencial agora (recomendado, OPCIONAL)"** — a alternativa "mini-form inline" do C2: campos usuário + senha (`type=password`) → cria a credencial (cliente, serviço) via `credentials:create` existente, com `isDefault: true`. A senha **nunca** volta para o modal (o main cifra e devolve só id/label). Com a credencial criada NA HORA, o fingerprint (D4) funciona na gravação — a etapa de senha sai marcada `match: 'fingerprint'` automaticamente. **Ninguém é obrigado a cadastrar agora.**
  3. **Sem credencial vinculada** (usuário pulou, ou cliente sem credencial) → a gravação segue com placeholders por **papel do campo** (campo password ⇒ `{{credential.password}}`) + warning **`no-credential-bound`**; revisão mostra: *"Vincule uma credencial a este acesso depois em Editar → Credenciais"* — **sem bloquear o salvamento**. O replay só falha quando a credencial realmente não existir; o wizard já avisa. Nunca trava a gravação por falta de credencial.
  4. **Mismatch honesto** (re-record: a credencial salva mudou/é outra) → aviso `credential-mismatch` na revisão (D4) — a senha digitada nunca é gravada de qualquer forma.
- **[Ensinar agora]** (primário) → chama `wizard.startRecord` → abre a sessão de gravação (portal visível).
- **[Pular por agora]** (secondary) → fecha o wizard como hoje: `toast.success('Site adicionado. A automação de login foi configurada automaticamente.')` (comportamento byte-igual ao atual).

O modal **não pode ser fechado** durante a gravação (ESC/X/clique-fora suprimidos; única saída: Concluir/Cancelar) — e **C4**: fechar a **janela do app** (X / Cmd+W / Alt+F4 / tray / menu Sair / Cmd+Q) também é interceptado com dialog de confirmação (§6.4).

**Estado "Gravando…" (substituindo o conteúdo da etapa 2 enquanto a sessão está aberta):**

```
🔴 Gravando — faça o login no portal como você faz normalmente.
   Tela T2 · 9 etapas gravadas · portal.sefaz.gov.br
   Dica: clique em Entrar normalmente. Ao chegar na área logada, clique em "Concluir gravação".
   [Concluir gravação]   [Cancelar e descartar]
```

- Contador ao vivo via `onWizardProgress` — **throttled em 1/s** com flush imediato em start/finish/cancel (**C8**); `state()` a cada 1 s cobre o fallback.
- **C3:** se a sonda leve e separada do wizard (`wizardProbe`, `checkPostLogin` contra a página aberta, 1×/2 s) achar o portal logado — mostrar banner não-intrusivo *"Parece que você entrou ✓ — [Concluir gravação]"*. A sonda **nunca** chama `markAuthenticated`/`revealPortal`/reload, **nunca** conclui sozinha; o clique é do usuário. (É **separada** do `watchPostLogin` — §6.4.)
- **N1 — teto de 15 min:** aos **10 min**, aviso no banner: *"A gravação será encerrada em 5 min."*; no teto de `RECORDING_MAX_DURATION_MS`, **auto-finish como draft parcial** (mesma UX de C5) e o usuário vai para a revisão com aviso destacado.
- "Cancelar e descartar" pede confirmação in-modal ("Nada será salvo. A automação automática continua ativa.") → `wizard.cancel`.

**Etapa 3 — Revisão**
Lista compilada das etapas (ícone por ação, `label` visível, tela `T#`, chip de confiança high/medium/low) + avisos (`warnings`) em destaque:

> ⚠️ "A senha digitada não confere com a credencial salva — a gravação usará a credencial do cliente <X>." (`credential-mismatch`)
> ⚠️ "Nenhuma credencial vinculada — usuário e senha viraram referências; vincule uma credencial em Editar → Credenciais." (`no-credential-bound` — C2/N2)
> ⚠️ "O campo 'conta' não foi gravado (não é um dado que guardamos). Preencha-o manualmente ao entrar." (`value-not-recorded`)
> ⚠️ "Eventos possivelmente perdidos por navegação: 1 — confira se falta alguma etapa." (`gaps > 0`)
> ⚠️ **"A gravação excedeu 60 etapas — estas são etapas parciais: remova as que não pertencem ao fluxo antes de testar."** (`step-cap-reached` — **C5**)
> ⚠️ **"A gravação atingiu o limite de 15 minutos — estas são etapas parciais: remova o que não pertence ao fluxo antes de testar."** (`recording-max-duration` — **N1**)
> ⚠️ "Campo one-time-code / 2FA: valor não gravado; no replay este passo é opcional." (`otp-not-recorded`)

**Cada etapa tem um botão "remover" (lixeira, N3)** — indispensável para aparar o excedente de 60 (C5) e o de teto de 15 min (N1), e para descartar passos acidentais sem regravar tudo. Remover é **client-side**; no salvar, o wizard envia `removedStepIndexes` (§6.1) e o servidor descarta os índices antes de validar `steps.length ≤ 60`.

Toggle **"Entrar sozinho"** (mesma semântica do switch atual; default = valor do `service.recipe.autoSubmit` = o que a automática usaria, ou seja `true` para custom) e botões:

- **[Salvar robô]** → `wizard.save { autoSubmit, removedStepIndexes? }` → `saveRecipe` com `origin: 'recorded'`, **reutilizando `postLogin`/`captchaSelectors`/`twoFactorSelectors` da receita corrente** (C1 — §4.4), `status: 'draft'` → avança para verificação.
- **[Descartar gravação]** → `wizard.discard` → fecha; automática continua.
- **[Regravar]** (link discreto) → `wizard.cancel` + `wizard.startRecord` de novo.
- (Link avançado) "Ver como JSON" — `<details>` com a `RecipeDefinition` compilada (read-only; botão "Copiar") — transparência radical e depuração.

**Etapa 4 — Verificação (opcional, pulável)**

> "A gravação ensina o caminho. Ainda não testamos se o robô acerta sozinho. [Testar agora] abre o portal com a credencial do cliente <X> — leva uns 20 segundos."

- **[Testar agora]** → fecha o modal → `sessions.open({ serviceId, clientId, authMethod, credentialId, forceNew: true })`. Se autenticar, `startRecipe` já marca `verified` (código existente) — o modal, se reaberto, mostra "✓ Robô verificado". Se falhar, a sessão mostra o erro padrão + o acesso fica `broken` → o usuário volta ao acesso e clica **"Reconfigurar robô"**.
- **[Testar depois]** → **toast não bloqueante** (§14-C fechada): *"Recomendamos testar antes de confiar no robô — você pode testar depois abrindo o acesso."* — fecha; `draft` até a primeira abertura real. O teste ("[Testar agora]") abre a sessão pelo canal normal; o audit registra o evento existente com `origin: 'verify-test'` no metadata — **nenhum tipo de auditoria novo** (§14-F).

`onOpenChange(false)` no fim ⇒ `invalidate.services()` como hoje.

### 7.2 Serviços NOVOS — o que muda no `services:create`?

**Nada.** O IPC `services:create` (ipc/index.ts:850) continua criando o serviço + receita automática. A gravação acontece **depois**, dentro do mesmo wizard, e ao salvar chama `recipes.save` (já existente e zod-validado) para sobrescrever. Quem pular a gravação fica com o automático (status quo). Quem desistir no meio fica com o automático (criado na etapa 1) — nunca com serviço sem robô nem com robô meio-gravado (o `wizard.save` só acontece com revisão completa; o crash no meio descarta).

### 7.3 Serviços EXISTENTES — botão "Reconfigurar robô"

Na seção avançada do modal de edição, ao lado de **"Regenerar automação"** (`service-form-dialog.tsx:506–517`), entra **"Reconfigurar robô"** (ícone `Video`/`MousePointerClick`):

- Visível quando `service && !service.isBuiltin && service.recipe` (nativo fica fora do MVP — §14-A; sem recipe → desabilitado).
- Clique ⇒ `confirm` in-modal leve ("A automação atual será substituída pela sua gravação. O que está funcionando será preservado até você salvar.") ⇒ `recipes.reRecord` ⇒ mesma máquina do wizard (etapa 2: credencial default do `(clientId, serviceId)` **pré-selecionada quando existir**; o select permanece editável; se ausente, cai no caminho `no-credential-bound` de C2 — nunca mismatch falso).
- Enquanto a gravação roda, a receita antiga continua valendo para as sessões abertas (as sessões carregam a definição na memória). Ao salvar, nova `version`, `status: 'draft'`.
- **"Regenerar automação"** (existente) permanece como "voltar para o automático" — apaga a gravada, regenerando via `buildAutoRecipe` + `autoSubmit` preservado. Rótulos distintos eliminam ambiguidade.
- Para **nativos (builtin)**: "Regenerar automação" restaura o seed de fábrica (`resetRecipe` → `BUILTIN_SERVICES`) — intocado.

### 7.4 Migração e builtins intactos

| Item | Plano |
|---|---|
| Receitas builtin | **Intactos.** Nada no fluxo toca seeds; `resetRecipe` continua restaurando o seed; `seedBuiltins` (seed) inalterado |
| Receitas auto de custom | Intactas até o usuário gravar; `healCustomServiceRecipes` passa a pular `origin === 'recorded'` (§4.5) — resto inalterado |
| `definition_json` existentes | Todas válidas (novos campos opcionais) — sem migração de dados |
| `recipes.status` | Gravada nasce `draft`; `verified` só via teste real; `broken` via falha real (código existente) |
| `AUDIT_TYPES` | Tipos novos apenas **adicionados**; nenhum renomeado |
| `schema.ts` | **Zero alteração** (sem novas colunas/tabelas; `origin` vive no JSON) — sem `drizzle-kit generate` nesta fase |
| `HEAL` de URL volátil (`stripVolatileQueryParams` no heal) | Mantido; o recorder também aplica a mesma função em qualquer `waitForURL` compilado |
| `recipes.test`, editor JSON, "Entrar sozinho" | Inalterados |

### 7.5 Ordem de criação × gravação — por que "criar primeiro"

1. `services:create` já cria com automático → "Pular por agora" é trivial e idêntico ao hoje.
2. O serviço precisa existir para que a credencial (cliente, serviço) possa ser criada/vinculada na etapa 2 e para que o fingerprint (D4) tenha candidato — credenciais referenciam `serviceId` (`schema.ts:127-129`).
3. Fingerprint-match (D4) precisa da credencial-alvo: ela existe se o usuário cadastrar na etapa 2 (serviço novo) ou se já existir (re-record). Sem candidata, a gravação degrada para placeholders por papel do campo com aviso — nunca trava (§7.1, item 3).
4. Falha/cancelamento no meio da gravação → serviço permanece com o automático (estado conhecido e funcional), nunca "serviço sem robô".

Alternativa honestamente considerada e rejeitada (**§14-D fechada: "criar primeiro, gravar depois" = SIM**): gravar antes de salvar o serviço — exigiria serviço-em-memória, janela de gravação órfã se o usuário cancelar, e fingerprint sem credencial associada. UX e integridade perdem.

---

## 8. Segurança

### 8.1 Propriedades garantidas por construção

| Propriedade | Como |
|---|---|
| **Zero segredo literal na receita/logs/audit/review** | Fills de credencial viram placeholders (fingerprint HMAC-SHA256 / igualdade normalizada); valores descartáveis nunca são persistidos; `logger`/`audit` passam por `redactRecord` que mascara chaves `pass|senha|secret|token|otp|cookie|...`; `statusMessage` nunca inclui valores; Steps serializados no review só carregam placeholder + metadado de confiança |
| **Senha nunca é descriptografada para gravar** | Comparação via `credentials.passwordFingerprint` (HMAC HKDF `'password-reuse-fingerprint'`, `vault/crypto.ts:97`) com `constantTimeEqualHex` (:101). AAD `credentials:{id}:password` NÃO é aberto no fluxo de gravação (diferente do `startRecipe`, que precisa do plaintext para preencher) |
| **Texto de botão / rótulo é benigno; valor de input não** | `label` (≤80 chars, `trim`), `screen` (`T\d+`), nome de campo — permitidos. `value` de `input` — **nunca** persistido fora de placeholder; em log, jamais (chaves `value` arriscadas são poucas; mesmo assim nenhum `value` de campo entra em metadata — o review renderiza placeholders, não dados) |
| **Recorder só existe em sessão de gravação** | Armado exclusivamente por `openRecorder()` (§6.4); sessões normais e nativas **nunca** injetam o script; ao fechar/cancelar/concluir, `disposeRecorder()` apaga buffer e listeners; `did-finish-load` em sessão normal segue o caminho de sempre |
| **A página do portal não fala com o main** | Sem preload na view; `TrustedContentsRegistry` não a registra; os canais `wizard:*`/`recipes:*` validam `assertTrustedSender` — a view remota receberia `FORBIDDEN` mesmo se tentasse |
| **Allowlist de domínios ainda vale na gravação** | `will-navigate`/`will-redirect` intactos; navegação fora de gov/allowlist é bloqueada (e uma etapa apontando para lá é rejeitada no finish); downloads perigosos continuam cancelados; popups ocultos até autenticar |
| **Senha AAD** | `credentials:{id}:password` inalterado; zero uso novo de `revealCredential` fora do replay normal; `fingerprintPassword` não toca o envelope |
| **Constraint de 60 etapas e ≤500-char selectors** | Mantidos no schema zod — nenhuma ampliação de superfície de persistência |

### 8.2 O que atravessa a fronteira page→main (e o que não)

Atravessa (em memória, por retorno de `executeJavaScript`):

- Metadados do alvo: seletor-âncora (≤500 chars), rótulo visível (≤80), metadados do campo (`type/name/id/autocomplete/placeholder/aria-label/label` — strings pequenas, sem valor livre do usuário), match-count do seletor ao gravar, confiança, tela (`T#`), timestamp monotônico.
- **O valor digitado**, somente no canal do commit de fill, transitoriamente, para comparação de fingerprint/igualdad (§3.7) — zerado no main logo após a comparação (`secrets[n] = ''`); em JS a string é imutável (limitação honesta, §12), mas nunca sai do processo, nunca é logada, nunca chega ao disco.

Não atravessa: cookies, headers, corpo de POST, HTML da página, URLs completas (só host+path saneado nas etapas compiladas), chaves, certificado.

### 8.3 Revisão contra OWASP básico (checklist)

1. **Injection** — nenhum dado da página é interpolado em `executeJavaScript` sem `JSON.stringify` (o padrão do `core.ts`); seletores compilados são strings inertes; `pierce:` é parseado por split controlado. **Nenhum** `eval` de conteúdo da página.
2. **Broken Access Control** — todos os `wizard:*` exigem sender trusted; sessão de gravação não eleva permissões; `recipes:reRecord` valida `isBuiltin` (não-nativo) e sessão/estado.
3. **Cryptographic Failures** — sem novos primitivos; reuso do cofre/HKDF existentes; nenhum material novo de chave; nenhuma chave na receita.
4. **Insecure Design** — fluxo "PAUSAR → humano" como invariante (nunca chuta); gravação não substitui a credencial (o portal digita, mas só o app guarda); buffer apagado em todos os caminhos de saída (`finally`).
5. **Security Misconfiguration** — DevTools aberto no dev (como hoje); `before-input-event` F12 bloqueado em packaged (inalterado); navegação/downloads/popups mantidos; `webSecurity` intocado na view de gravação.
6. **Vulnerable Components** — **zero dependência nova** (D13); zod já valida todos os canais; drizzle/better-sqlite3 já existentes.
7. **Identification/Auth Failures** — N/A (sessão local, sem auth web); a gravação não introduz recuperação de senha/bypass — o portal autentica como sempre.
8. **Software Integrity** — `services:create` continua salvando a automática como fallback conhecido; a gravada só substitui após revisão humana explícita.
9. **Logging/Monitoring** — audit events novos sem valores; `logger.debug` para diagnóstico de prontidão só com metadados; nada com `value`.
10. **SSRF** — `recipes.test` inalterado (HEAD no próprio `baseUrl` do cadastro, já validado HTTPS por `normalizeBaseUrlInput`); o recorder nunca faz fetch a partir do main.

### 8.4 Específico do recorder — ameaças e contramedidas

| Ameaça | Contramedida |
|---|---|
| Portal malicioso tenta injetar etapas (ex.: forja clique via JS próprio, gera evento sintético) | Eventos têm origem no próprio portal — indistinguível de ação humana; mitigação: a **revisão humana** obrigatória (etapa 3) é a fronteira; etapas `low-confidence` destacadas; nada executa sem [Salvar robô] + (opcional) [Testar login] |
| Portal exfiltra dados via campos digitados (keylogger no próprio site) | Fora do escopo do app (o portal legítimo é o mesmo que o usuário usa sem o app); a gravação não amplia o que o site vê |
| Página tenta "fechar" a gravação fingindo pós-login | Auto-detecção só mostra banner; conclusão exige clique do usuário |
| Buffer do recorder vaza para outra página (navegação) | `window.__aurumbitRec` vive por documento; drenagem a 250 ms esvazia; token único por sessão impede re-arm por página errada |
| `executeJavaScript` com string montada com dados da página | Proibido no recorder: apenas templates com interpolação `JSON.stringify` (regra do core); payload de evento nunca volta montado em código |
| Senha colada no campo "usuário" | Campo usuário-símile compara igualdade contra `username`/`client.document`; se a string colada for a **senha** do próprio cliente, não casa com nada conhecido → aviso genérico "valor não gravado/não conferido" — o placeholder `{{credential.username}}` ainda é usado no replay (preencherá o username), e o mismatch aparece na revisão |
| Autocomplete do Chromium preenchendo sozinho durante a gravação (o evento `input` não dispara para preenchimento autofill!) | **Detalhe real:** valores de autofill do browser NÃO geram `input` em todos os casos → etapas de fill podem sumir. Mitigação: o recorder também ouve `change` (autofill costuma disparar change no commit) e o review exibe "nenhuma etapa de usuário/senha detectada" quando aplicável, sugerindo preencher manualmente (pular autofill) durante a gravação. Documentado como comportamento esperado do wizard ("Não use o preenchimento automático do Chrome durante a gravação") |
| Cópia/cola de senha (usuário cola com Ctrl+V) | Evento `input` dispara (valor final) — tratado como digitação normal (fingerprint decide placeholder) |

### 8.5 O que NÃO prometemos (honestidade)

- **Memória de processo:** JS strings são imutáveis — zeramos referências, não os bytes históricos no heap. Aceito nos mesmos termos do `revealCredential` atual (o app inteiro adota essa postura).
- **Timing do fingerprint entre gravação e portal:** comparar HMAC vaza igualdade (oráculo determinístico para senhas repetidas) — risco já presente no cofre (reuso de fingerprint indexado); a gravação não amplia isso.
- **Malware local com acesso à tela/memória** — fora do modelo de ameaças (local-only, single-user).
- **Portal que mude o DOM entre gravação e replay** — não é segurança, é manutenção de seletores: por isso confiança `low` é destacada, por isso o `Reconfigurar robô` existe, e por isso PAUSAR é o fracasso seguro.

---

## 9. Testes

Regra: **nenhum teste existente pode quebrar** (`npm test` verde em cada fase; `format:check` e `typecheck` também). Cobertura nova entra em `tests/unit` e `tests/e2e`, sem tocar fixtures legados.

### 9.1 Unit (vitest, environment `node`; `jsdom` já disponível para scripts injetados)

**`tests/unit/readiness.test.ts`** (novo — **Fase 2**, não no MVP) — `waitForReady` com `RecipeTarget` fake (mesmo padrão de `tests/unit/runner.test.ts:4`):

- readyState completo + sem busy + janela quieta → `ready: true`, `waitedMs` pequeno;
- `[aria-busy=true]` visível → não pronto; some no tick seguinte → pronto;
- spinner com classe `.carregando` injetado → não pronto;
- **poll eterno**: N recursos `fetch` para `/api/heartbeat` na janela → isentos → pronto (prova da heurística §5.3);
- recurso "de verdade" (`script`) na janela → não pronto até cessar;
- URL mudando entre amostras → `urlStable: false` → não pronto;
- `timeoutMs` esgotado → `ready: false`, `detail` não vazio, **sem** vazar valores;
- `safeExecute` devolvendo `null` 1× → retry; 2× → `ReadinessProbeError`;
- quieta→não quieta→quieta oscilando — convergência dentro do timeout (fake timers `vi.useFakeTimers()`);
- `sleep` injetado (sem timers reais).

**`tests/unit/recorder-core.test.ts`** (novo, environment `jsdom` via `// @vitest-environment jsdom` por arquivo — permitido pois o vitest já aceita override por arquivo) — testa os **script builders** do `recorder.ts` executando no DOM fake:

- geração de seletor: id estável (`#login-cpf`) → `#id`; id `ember123` / `:r3:` / guid → rejeitado → cai para `[name]`;
- `[name]` único vs duplicado (contagem de matches) → ordem de candidatos correta;
- `data-testid` vence aria; texto visível gera candidato `text=…`; caminho CSS com `nth-of-type` como último caso; limite de profundidade 8;
- **[Fase 4, somente se E3 confirmar pierce:]** elemento dentro de `attachShadow({mode:'open'})` → seletor `pierce:host>>>inner` montado; `__pvFindDeep` executado no jsdom resolve seletor `pierce:` de 2 níveis;
- *(Se E3 não confirmar: estas asserções não existem — pierce: cortado do MVP e documentado.)*
- visibilidade (`display:none`, `opacity:0`, dimensão 0) → candidato descartado;
- `__pvFindDeep` executado no jsdom resolve seletor `pierce:` de 2 níveis;
- coalescing: 3 `input` no mesmo campo em <400 ms → 1 fill commitado; blur commita;
- dedupe: 2 clicks idênticos em 300 ms → 1 etapa;
- `Enter` em campo de texto com `form` ancestral → `press`; Enter solto no body → descartado;
- interatividade: clique em `div` não interativo → nada gravado; clique em `button` → gravado;
- seq gap: após navegação simulada (jsdom re-arm com `screen='T2'`), eventos carimbados T2;
- drain: `buildDrainScript` zera buffer; segundo drain devolve vazio; seq monotônico detecta lacuna (`gaps: 1`);
- limite 60: simular 60 eventos → `stepCapReached`; o wizard **auto-finaliza como draft parcial** e leva o usuário à revisão com aviso `step-cap-reached` (**C5** — o 61º não é "rejeitado", o fluxo finaliza parcial e o usuário remove na revisão, N3);
- teto de gravação (**N1**): ao atingir `RECORDING_MAX_DURATION_MS` (15 min) → auto-finish como draft parcial com warning `recording-max-duration`; aos 10 min, sinal de aviso;

**`tests/unit/recorder-compile.test.ts`** (novo) — compilação main-side (função pura `compileRecording(events, context): RecipeDefinition`):

- map campo senha + fingerprint igual → `{{credential.password}}`, `match:'fingerprint'` (vault fake: `fingerprintPassword` stub);
- fingerprint diferente → placeholder + warning `credential-mismatch` (**valor literal NÃO aparece** em nenhum lugar do output — asserção explícita `JSON.stringify(def)` não contém a string da senha);
- campo one-time-code → `fill` com `value: ''`, `optional: true`, warning;
- campo "conta" desconhecido → `value: ''`, aviso `value-not-recorded`;
- navegação ≤5 s pós-clique funde `expectedAfter.urlIncludes = ['portal.sefaz.gov.br/area']` (sem query); navegação solta vira `waitForURL`;
- URL com `?session_code=…`/`cid` → query removida (stripVolatileQueryParams real de `shared/custom-service.ts`);
- ordenação/dedupe global, ≤60 passos, `origin: 'recorded'`, `source: 'recorded'` em todos, `recordedScreens`;
- `isSensitiveStep` funciona sobre as placeholders (integração com `core.ts`);
- **sem credencial vinculada (C2/N2)**: `credentialId` ausente ⇒ fingerprint **não invocado** e warning `no-credential-bound` emitido (asserção no stub: `fingerprintPassword` não chamado);
- **remoção na revisão (N3)**: compilação com `removedStepIndexes: [0, 2]` descarta os índices; salvar com >60 passos após remoção → erro claro (C5);
- **C1 save reuse**: salvar gravação sobre receita existente preserva `postLogin`/`captchaSelectors`/`twoFactorSelectors` e substitui `steps`/`origin`/`recordedAt`/`recordedScreens` — teste dedicado `wizard:save preserva postLogin/captcha/2fa da receita anterior`;
- **N1**: `now()` além de `RECORDING_MAX_DURATION_MS` → compila draft parcial com warning `recording-max-duration`.

**`tests/unit/heal-recorded.test.ts`** (novo — **entregue junto com o hotfix pré-Fase 1**) — `healCustomServiceRecipes` pula receita `origin: 'recorded'` (e pula se qualquer passo tem `source: 'recorded'`); continua regenerando automática divergente não-gravada; `verified` continua intocado.

**`tests/unit/wizard-probe.test.ts`** (novo) — sonda leve do wizard (`wizardProbe`, **C3**): com `checkPostLogin` positivo (cookie de sessão válido), a sonda **nunca** chama `markAuthenticated`/`revealPortal`/`reload`/`save` — apenas sinaliza `loggedIn: true` para o banner; teste de integração com mocks do SessionManager (métodos `vi.fn()` e asserção `not.toHaveBeenCalled()`).

**`tests/unit/recorder-close-guard.test.ts`** (novo) — **C4**: `hasActiveRecorder()` verdadeiro ⇒ `BrowserWindow.close`/`before-quit` pedem confirmação; usuário confirma ⇒ `disposeRecorder` é chamado e a saída prossegue; cancela ⇒ nada é destruído. (Sem app real — fakes do `BrowserWindow`/`app` via injeção.)

**`tests/unit/wizard-progress.test.ts`** (novo, fake timers) — **C8**: `wizard:progress` é throttled para 1/s; start/finish/cancel fazem flush imediato (assert de contagem de broadcasts);

**`tests/unit/fallback.test.ts`** (novo) — **C7**: `shouldFallbackToAgent(result)` puro — `failureCode === 'element-not-found' && failedStep === 0` ⇒ `true`; qualquer outro `failureCode`/`failedStep` ⇒ `false`.

**`tests/unit/runner.test.ts` / `recipe-core.test.ts`** — estender, não alterar: casos `expectedAfter` ok / não-confirmado → `status: 'manual'` + `failedStep` + `failureCode: 'post-condition-failed'`; readiness negativa no passo 2 → `failureCode: 'readiness-timeout'` (Fase 2); `optional` pula; fallback agente só no passo 0 (o teste de `startRecipe` exigiria mock pesado do SessionManager — por isso a decisão mora em `fallback.ts`, função pura testada direto).

### 9.2 Integração (runner + readiness, sem Electron)

**`tests/unit/runner-integration.test.ts`** (novo) — `runRecipe` completo com `fakeTarget` programável (fila de respostas por script): página "carregando" 2 s → pronta → clique → URL muda → pós-condição confirma → `authenticated`. Variante com pós-condição que nunca confirma → `manual` + `failedStep`. Variante com readiness eterna → `manual` e **nenhum clique despachado** (assert no `executeJavaScript` não chamado depois do passo).

### 9.3 E2E (Playwright + `_electron`, portal local)

Fixtures — **`tests/e2e/helpers/https-server.ts` ganha 2 rotas** (sem tocar as existentes):

- `GET /wizard-login` → página com form (`#wuser/#wpass`), senha E2E própria (`TEST_PASSWORD`), e **spinner falso** que só some após 1,2 s + `fetch('/heartbeat')` a cada 500 ms pós-load (simula portal lento com polling — casa com a heurística §5.3);
- `POST /wizard-login` → 302 → `/wizard-painel` (marca autenticado por cookie, igual ao fluxo atual).

Fluxo completo em **`tests/e2e/wizard-recording.spec.ts`** (novo):

1. semear `userData` via `seedDatabase` com um serviço custom (recipe automática seed — padrão `app.ts` mas `withRecipe: false` + `isBuiltin:false`);
2. abrir o app; na UI (Playwright no renderer): abrir modal "Novo acesso" **(fluxo edição)** → **Reconfigurar robô** → sessão de gravação abre;
3. **o Playwright NÃO consegue clicar dentro da `WebContentsView`** (limitação do driver — não é BrowserWindow). Por isso o app ganha um gancho de teste que **SÓ EXISTE em builds de teste (C6)**: arquivo separado **`electron/main/recipes/__test__/autopilot.ts`**, incluído **somente** quando `NODE_ENV === 'test'` no bundler de testes (dynamic import guardado), e **excluído do build de produção** — o código do autopilot **nem existe no binário empacotado** e a env var `AURUMBIT_E2E_RECORD_AUTOPILOT=1` não tem efeito em produção (mesma doutrina do `AURUMBIT_E2E_ALLOW_LOCAL_TLS`). O autopilot simula o usuário — preenche `#wuser/#wpass` com `TEST_USER/TEST_PASSWORD` (dispara `input` reais → o recorder grava placeholders), clica `#entrar` (navegação real → T2) — e então o próprio spec clica **"Concluir gravação"** no modal (renderer — clicável normalmente);
4. revisar a etapa 3: assertar que o review mostra as etapas esperadas (`fill`+`text=Entrar`/`#entrar`, `fill` senha → placeholder visível `{{credential.password}}`, **nenhuma** ocorrência de `SenhaE2E!2026` em lugar nenhum da UI);
5. **[Salvar robô]** → reabrir serviço (`recipes.get`) → assertar `definition.origin === 'recorded'`, todos os `fill` com placeholders;
6. fechar e reabrir o app (boot round-trip) → `recipes.get` de novo → **receita continua gravada** (guarda do heal — §4.5);
7. **[Testar login de verdade]** → o app abre nova sessão `forceNew`; desta vez sem autopilot: após o clique manual simulado… **não**: para não depender de timing humano, o autopilot também está disponível no teste; o que se DEVE provar é o efeito: `recipes.test`/watcher marcam `verified` ⇒ assert `recipe.status === 'verified'`;
8. variantes negativas: (a) gravar sem clicar Entrar → "Concluir" → salvar → testar → falha (`broken`) → botão de reconfigurar presente; (b) cancelar no meio → nada salvo (`recipes.get` inalterado); (c) gravação de página que nunca estabiliza (rota `/wizard-broken` com spinner eterno) → robô aparece `manual` na sessão, `requiresHumanAction` — o e2e assert que o portal é revelado.

Estabilidade do e2e: autopilot como injeção única pós-`did-finish-load` da sessão de gravação (mesma máquina de re-injeção do recorder — um caminho só); esperas por `wizard:state`/UI (polling de texto no renderer), nunca `sleep` fixo longo; porta efêmera (o servidor atual já usa `listen(0)`).

**Gate de release (N4):** `grep -ri autopilot` sobre o bundle de produção (`out/`, `dist-electron/`) deve retornar **0 ocorrências** — verificado na Fase 5 e no checklist de release.

### 9.4 O que medir (gates)

- `npm test` (vitest) — verde; `npm run test:coverage` — manter ≥80% linhas em `shared/**` e `electron/main/recipes/core.ts` (os novos `readiness.ts`/`recorder.ts` entram na `coverage.include`).
- `npm run test:e2e` — verde incluindo `wizard-recording.spec.ts`.
- `npm run typecheck` + `npm run lint` + `npm run format:check` — limpos.
- Testes manuais de sanidade (§10, Gate G3): gravar 3 portais gov.br reais (ISS Fortaleza, e-CAC, gov.br SSO) em modo staging — fora do CI.

---

## 10. Fases de implementação

Convenção: esforço em dias úteis de 1 engenheiro (sênior, contexto deste repo). Cada fase termina com suíte verde e commit próprio. **O hotfix D10 é pré-Fase 1 (Parte 7, item 3 da revisão).** Repartição aprovada pelo dono do produto (E1–E4): o MVP não depende de readiness nem de shadow DOM. **Total efetivo: Pré-F1/F1/F4/F5(docs) concluídas; F2/F3 em curso.**

> **Status real (2026-11-13):** Pré-Fase 1 e Fase 1 **CONCLUÍDAS** (commits `db5665f`…`85d5a2a`, `2e052fd`). Ensinar robô sem cliente (sessão descartável `recording:<wizardId>` sem linha em `sessions`), campos nomeados aprendidos automaticamente (`definition.fields`), receita em dois passes (certificado → senha, `certificateSteps`/`passwordSteps`), certificado gravado pelo mesmo fluxo (picker de A1 no assistente), barra "Concluir gravação" no chrome do portal, `expectedAfter` + `failureCode` no runner, fallback `shouldFallbackToAgent`, `sealFieldValue` AES-256-GCM por campo com AAD `credentials:{id}:field:{name}`. Telemetria browser-based concluída: **e-CAC 2,8 s / 23 recursos; gov.br SSO 1,7 s / 59 recursos; Redesim→gov.br 5,2 s / 34 recursos; `readyState: complete` nos três; 0 elementos `[aria-busy]/.spinner/.loading` visíveis em repouso; zero tráfego eterno detectado nas telas públicas de login**. Shadow DOM medido: apenas VLibras e toolbar gov.br — **fluxos de login são light DOM** ⇒ `pierce:` CORTADO do MVP (documentado em §4.3). **Fase 2 (readiness + integração) e Fase 3/Fase 5 (ver status abaixo) em execução.**

### Pré-Fase 1 — HOTFIX `healCustomServiceRecipes` (D10) — ✅ CONCLUÍDA
Guard `origin === 'recorded'` (ou qualquer passo com `source: 'recorded'`) no heal (`electron/main/db/seed.ts`) + `tests/unit/heal-recorded.test.ts`. Testes verdes; commit `db5665f`.

### Fase 1 — MVP defensável: criar → gravar → salvar → reusar — ✅ CONCLUÍDA
Escopo entregue (além do previsto): schema aditivo completo (`origin`/`recordedScreens`/`expectedAfter`/`fields`/`certificateSteps`/`passwordSteps`), recorder passivo com drain 250 ms e `seq/gaps`, sessão de gravação visível
(portais **nascem visíveis**, nunca rodam o robô), IPC `wizard:*` + guarda de fechamento + teto 15 min + `before-quit`, assistente no modal (etapas 1–4: dados → ensinar → gravar → revisão → salvo), chrome do portal com barra "Concluir gravação", "Reconfigurar robô" para acessos existentes, robô gravado tem prioridade sobre o agente (`fallback.ts` + `failureCode` no runner), IP-host fix na allowlist, `docs/robot-wizard/*`, e2e `wizard-recording.spec.ts`.
**Decisões de produto desta fase:** ensinar sem cliente permitido para senha; certificado exige cliente/A1 (o certificado é do cliente).

### Fase 2 — Telemetria (E2) → `readiness.ts` — ✅ TELEMETRIA COLETADA / IMPLEMENTAÇÃO EM CURSO
1. **Probe medição (feito via browser, páginas públicas)**: e-CAC / gov.br SSO / gov.br-empresas-e-negócios com `performance.getEntriesByType` — ver tabela acima. Isenção de polling mantida com nomes reais observados: `heartbeat|poll|refresh|ping|status|events|notification`; janelas: `readyState==='complete'` + janela quieta 800 ms + URL estável; `timeoutMs` 12 000 (cap 30 000); budget global 120 s; pausa→humano com `statusMessage` humano e portal revelado.
2. **Implementação**: `readiness.ts` (sonda in-page: readyState + busy + janela quieta com isenção + URL estável), integrado no `runner` (antes de cada passo, 1 re-espera), `agent.ts` (budget de parede 120 s), `expectedAfter` automatizado. Testes: `readiness.test.ts` + `runner-integration.test.ts`.
3. **Nota honesta (E2)**: medição pública coletada; **medição pós-autenticação exige credenciais de staging — operadores devem rodar** o probe nos 3 portais-alvo e substituir/calibrar `quietMs` se a mediana real > 5 s (regra no §5.3). Sem isso, a heurística é mantida como medida nos portais públicos.

### Fase 3 — "Reconfigurar robô" + ritual de verificação + e2e completo — PARCIALMENTE CONCLUÍDA → EM CONCLUSÃO
Entregue: `recipes:reRecord` (botão "Reconfigurar robô", apenas custom), ritual "Testar agora/depois" com nudge §14-C e auditoria `origin: 'verify-test'`, e2e `wizard-recording.spec.ts` (criar → ensinar → concluir no chrome → revisar → salvar → `origin: 'recorded'`).
Falta (em execução): **autopilot de e2e** (`electron/main/recipes/__test__/autopilot.ts` incluído **somente em build `NODE_ENV=test`**, `define` no `tsup.config.ts` elimina totalmente do bundle de produção), e2e de bota-roundtrip (receita gravada sobrevive ao boot), variante negativa `/wizard-broken` (spinner eterno → pausa → portal revelado), verificação `recipe.record_interrupted` no próximo boot, release check `grep -ri autopilot dist-electron/ = 0`.

### Fase 4 — Shadow DOM / `pierce:` — ✅ DECIDIDO: CORTAR (2026-11-13)
Checagem nos 3 portais-alvo via browser (ao vivo, 2026-11-13): e-CAC login → shadow roots só em `div#vlibras-access-wrapper` (VLibras); gov.br SSO → nenhum; Redesim → `barra-govbr#barraGovBr` + VLibras. **Nenhum dos fluxos de login usa light DOM + shadow aberto no próprio formulário** ⇒ `pierce:` e `__pvFindDeep` **CORTADOS do MVP**. `core.ts` permanece inalterado. Documentado aqui e em §3.2/§4.3.

### Fase 5 — Polimento e hardening — PENDENTE (em curso)
Checklist vivo: `docs/robot-wizard/RECORDING_GUIDE.md` ✅ · `docs/SECURITY.md` menciona a Gravação Assistida ✅ · release `grep autopilot` = 0 (a entregar com o autopilot) · OWASP review final do diff ✅ (rastreada no relatório) · `format`/`lint`/`typecheck`/`test`/`test:e2e` verdes (estado atual: 548 unit + 9 e2e) · portais reais em staging (operador) · changelog.

**Total investimento efetivo: etapas 0–3 ≈ implementadas; Fase 2/5 finalização em curso.**

### Gates

- **G1 (fim Fase 1):** ✅ `npm test` verde; criar → gravar → salvar → reusar funcional (e2e `wizard-recording.spec.ts` verde).
- **G2 (fim Fase 3):** e2e completo verde (`wizard-recording.spec.ts` ✅ + bota-roundtrip + variante negativa); heal provado ✅; `no-credential-bound` ✅ (unit C2/N2); sonda do wizard ✅ (§6.4, unit); fechar janela pede confirmação ✅; `stepCapReached`/`recording-max-duration` auto-finalizam ✅; `shouldFallbackToAgent` puro ✅.
- **G3 (fim Fase 5):** 3 portais-alvo medidos (browser público ✅) e autenticados em staging (operador); `SECURITY.md` ✅; **§14 fechada** ✅; **grep autopilot = 0** (a verificar com o autopilot de teste).

### Arquivos tocados — mapa completo (atualizado 2026-11-13)

Novos: `recorder.ts` (Fase 1 ✅), `fallback.ts` (Fase 1 ✅), `readiness.ts` (Fase 2 — em curso), `__test__/autopilot.ts` (Fase 3 — em curso), `src/components/services/wizard/*` → **entregue como 1 arquivo** `service-form-dialog.tsx` (o assistente vive dentro). Testes: `recorder-core.test.ts` ✅, `recorder-compile.test.ts` ✅, `heal-recorded.test.ts` ✅, `wizard-progress.test.ts` ✅, `fallback.test.ts` ✅, `runner-expected-after.test.ts` ✅, `readiness.test.ts` (Fase 2 — em curso), `tests/e2e/wizard-recording.spec.ts` ✅; pendente: bota-roundtrip + `/wizard-broken`.

Editados: `shared/recipe.ts` (campos + expectedAfter + certificateSteps/passwordSteps + fields ✅), `shared/constants.ts` (AUDIT_TYPES + RECORDING_MAX_DURATION_MS ✅), `shared/contracts.ts` (wizard channels + certificateId/optional clientId ✅ + domainSchema IP ✅), `shared/types.ts` (WizardState/SessionDetails.isRecording/SessionOpenRequest.origin ✅), `runner.ts` (failureCode + expectedAfter ✅; readiness F2), `agent.ts` (budget 120 s — F2), `core.ts` (RecipeValues.extraValues ✅), `manager.ts` (D6 + recorder + probe ✅ + session.opened origin ✅), `ipc/index.ts` (wizard handlers + reRecord ✅), `preload/index.ts` (wizard api ✅), `service-form-dialog.tsx` (assistente completo ✅), `app/session/page.tsx` (barra de gravação ✅), `db/seed.ts` (D10 ✅), `vault/service.ts` (seal/openFieldValue ✅), `db/repositories/credentials.ts` (campos cifrados + revealCredential extraValues ✅), `ui/input.tsx` (Field multi-filho ✅), `tsup.config.ts` (NODE_ENV define — F3).

**NÃO editados (mantido):** `electron/main/vault/crypto.ts` (envelope reusado), `certificates/*`, `schema.ts` (sem ALTER TABLE; `fields` JSON já existia), `migrations.ts`, `shared/builtins.ts`, `shared/custom-service.ts` (reuso), `package.json` dependencies.

### Fora de escopo — PROIBIDO (mantido)

- **NÃO implementar `pierce:` / shadow DOM** (corte E3 confirmado — light DOM nos fluxos de login).
- **NÃO entrar no login dos portais com credenciais que não as do operador** — medição pública feita; pós-auth é do operador.
- **NÃO gravar builtins** integrado (§14-A).
- **NÃO persistir valores não-credenciais** — mas o campo "extra" do portal É aprendido como spec (nome), valor cifrado do cliente (ver NAMED_FIELDS_SPEC.md). Isto REVOGA o default B anterior: a regra honesta que vale é "valor descartado; NOME aprendido; valor na credencial".
- **NÃO tocar** `vault/crypto.ts` (helpers reusados), `certificates/*`, `schema.ts`, `migrations.ts`, `builtins.ts`, `package.json` dependencies.
- **NÃO criar canal IPC novo para o portal**.
- **NÃO marcar receita como `verified` no salvamento** — só o teste real marca (D11).

---

## 11. Riscos top-5 (+ secundários)

| # | Risco | Prob. | Impacto | Mitigação concreta |
|---|---|---|---|---|
| **R1** | **Seletores instáveis em SPAs gov.br** (React `:r3:`, ids de sessão, markup regenerado a cada deploy) — o robô gravado quebra no mês seguinte | Alta | Alto | Hierarquia com **6 camadas** + coleta de candidatos ordenados (§3.4); `matchCount` no momento da gravação detecta ambiguidade; chips de confiança na revisão (`low` destacado); o passor dinâmico é inerente a qualquer recorder determinístico — aceito e comunicado; `Reconfigurar robô` é o remédio barato (regravar em 5 min vs. debugar seletor à mão); `expectedAfter` permite "sabe que ainda não chegou, espera mais"; seletores `text=` para CTAs de login (estáveis entre deploys de marcação) |
| **R2** | **Rede ociosa nunca alcançada** em portais com polling eterno / long-poll / WebSocket — readiness pausa tudo e o usuário culpa o app | Média/Alta | Alto (todos os fluxos) | Janela quieta **com isenção de tráfego de polling** por padrão de URL + ausência de busy + readyState complete + URL estável (§5.3); `quietMs` calibrado 800 ms (menor que o ciclo típico de poll de 1–5 s); pausa devolve o portal imediatamente (não é loop travado); métricas locais de `waitedMs` no decide de ajuste (Fase 2, pós-telemetria E2) |
| **R3** | **Perda de eventos entre `unload` e re-injeção** durante navegação full-load (postback ASP.NET) — etapas somem silenciosamente | Média | Médio/Alto | Flush primário no próprio documento via `pagehide`/`beforeunload` (contexto ainda vivo); drain a 250 ms + contador `seq` (lacunas detectadas e exibidas — `gaps > 0` avisa); revisão mostra etapas por tela → usuário percebe ausência óbvia; limites do aceitável declarados (§12) |
| **R4** | **`healCustomServiceRecipes` descarta a gravada no boot** (regressão funcional silenciosa — o dono do produto descobre robô "sumindo") | Certa se não corrigido | Alto | Guard `origin === 'recorded'` (§4.5) + teste unitário dedicado + e2e de boot-roundtrip assertando a receita intacta — **antes** de qualquer fluxo de usuário depender de gravada |
| **R5** | **Senha/valor digitado vaza** por caminho inesperado (log, review payload, erro, `console`) | Baixa (com design) | Crítico | Placeholder por fingerprint sem abrir o cofre; `secrets[]` zerado a cada drain; nenhum `value` de campo em `logger`/`audit`/`statusMessage`; asserção de teste `JSON.stringify(definition)` sem a senha; revisão OWASP como gate da Fase 5; buffer sempre apagado (`finally` em todos os caminhos de saída) |

**Secundários (documentados, aceitos):**

- **S1.** Portal com **closed shadow DOM** → sem seletores (`pierce:` exige `shadowRoot` aberto). Mitigação: cair para caminho CSS do host + `text=`; se nada restar, a etapa fica `low`/aviso. Esperado em **~0%** dos portais gov.br testados (todos light DOM).
- **S2.** **iframe cross-origin** no fluxo de login (raro; ex.: captcha embutido de terceiros) → eventos dentro do iframe não chegam (o `executeJavaScript` roda no frame principal; o portal já bloqueia `will-navigate` externo de qualquer forma). O login em si continua fora do iframe na esmagadora maioria.
- **S3.** **Captcha durante a gravação** — o usuário **precisa** resolver na mão (é o fluxo "gravação assistida" — o humano está presente!). O robô gravado **não** aprende a resolver captcha; no replay, `detectInterstitial` pausa para o humano como hoje. Correto por definição no produto.
- **S4.** **double-submit** no replay (clique gravado + `autoSubmit` → 2 envios): `buildAutoSubmitScript` só é chamado quando `autoSubmit` E a receita não terminou em sucesso de pós-condição; e o filled form foi justamente o clicado. Risco residual aceito; o `expectedAfter` reduz a vontade do motor de insistir.
- **S5.** **`draft` executável** — hoje `draft` já executa (o automático nasce draft). Mantemos: gravar→salvar não muda o comportamento para o usuário final além do esperado; o gate social é "Reconfigurar robô" existe e o botão de gravar é explícito.
- **S6.** **Duas gravações simultâneas** — impossível (`hasActiveRecorder()` + botões desabilitados); sessão de gravação conta na cota de sessões.
- **S7.** **Recorder interfere na página** (listeners capturam algo que o site usa): listeners são passivos, nunca `preventDefault`; `click` sintético do próprio portal dispara nossos listeners — indistinguível e inofensivo para o site (nenhum efeito colateral no site).

### Honestidade sobre complexidade

A parte difícil não é gravar cliques — é **decidir quando a página terminou** (R2) e **sobreviver a portais que recriam o documento** (R3). Tudo neste plano que parece exagero (janela quieta com isenção de polling, flush em `pagehide`, `seq` com `gaps`) está ali por causa de casos reais do gov.br medidos no código deste repo (`BOOT_AUTH_TIMEOUT_MS`, `recipeAttempted`, reload do e-CAC em `markAuthenticated` — sinais de que "página nunca termina de carregar" é o estado NORMAL, não o patológico).

---

## 12. Limitações conhecidas

1. **Passo a passo perfeito não existe** em navegação full-load com documentos recriados: eventos entre `unload` e re-injeção podem ser perdidos (mitigado, não eliminado). Formulação operacional: o wizard **sempre mostra quantos eventos/telas** foram capturados e o usuário revisa — o último humano no circuito é a rede de verdade.
2. **Valores de campos não-credenciais NÃO são gravados** (MVP, D12/§14-B) — ex.: conta/agência bancária, CPF do cliente no portal da Receita, código de loja. O replay **pula** esses campos (`optional: true`) com aviso na revisão; o usuário preenche ao entrar (que é o que acontece hoje sem robô). V2 pode gravar com consentimento explícito por campo.
3. **OTP/one-time-code nunca é gravado nem preenchido** (`optional: true`) — por definição muda a cada acesso; o fluxo pausa para o 2FA como hoje.
4. **Autofill do Chromium** pode submeter sem `input` (o campo aparece preenchido sem evento) → etapas de fill de usuário/senha podem faltar; a revisão avisa ("nenhuma etapa de senha detectada") e orienta digitar manualmente na gravação.
5. **Páginas com `<select>` cujo valor contém dado sensível** (ex.: código de loja) seguem a regra dos demais campos (descarte com aviso) — não há classificação perfeita.
6. **Shadow DOM fechado** — inalcançável, ponto final.
7. **Multi-abas/popups durante a gravação** (ex.: SSO abre popup) — cliques no popup **não** são gravados; fluxos que EXIGEM popup não são cobertos pela gravação (o automático/agente seguem como fallback).
8. **`text=` com texto ambíguo** ("Entrar" aparece como link e como botão) — o candidato fica `medium`; a revisão destaca; ordem de candidatos + contexto (`role=button`) desambigua no replay na maioria dos casos.
9. **Rodar o robô em página já logada** (cookie de sessão vivo) — `checkPostLogin` fast-path desvia antes dos passos (código atual preservado) — ok, esperado.
10. **Fingerprint mismatch** (usuário digitou senha ≠ credencial salva) — a etapa usa a credencial salva (D4) com aviso; se o usuário quis OUTRA senha, o replay preencherá a errada e o login falhará → pausará → ele corrige a credencial ou regrava. Sem mágica possível: o app não pode gravar o que não deve.
11. **`draft` gravado + `autoSubmit` ligado mapeia portal que muda o DOM a cada deploy** — replay pode falhar na 1ª etapa → pausa → usuário clica Reconfigurar robô. É o custo de robôs determinísticos em portais sem contratos de UI; comunicado no texto do wizard.
12. **Teto de duração da gravação (N1)** — `RECORDING_MAX_DURATION_MS = 15 min`: aos 10 min, o wizard avisa ("a gravação será encerrada em 5 min"); no teto, auto-finish como draft parcial (mesma UX de C5). Não há gravação "para sempre"; o que foi capturado até o aviso é preservado.
13. **Credencial ausente na gravação (C2/N2)** — o robô nasce com `{{credential.*}}` e `no-credential-bound`; funciona assim que o usuário vincular uma credencial no acesso. Isso **não** é um bug — é o comportamento contratado.

---

## 13. Glossário de arquivos e comandos de verificação

| Arquivo | Papel |
|---|---|
| `shared/recipe.ts` | Schema zod das receitas (extensão aditiva §4.1) |
| `shared/custom-service.ts` | `buildAutoRecipe` (fallback), `stripVolatileQueryParams`, `stepCarriesCredentials` (reuso) |
| `shared/contracts.ts` | IPC channels + schemas zod (§6.1) |
| `shared/constants.ts` | `RECIPE_ACTIONS`, `AUDIT_TYPES` (+ novos), `RECORDING_MAX_DURATION_MS` |
| `electron/main/recipes/recorder.ts` | **novo** — scripts injetados + compilador (§3–4) |
| `electron/main/recipes/fallback.ts` | **novo** — `shouldFallbackToAgent(result)` função pura (C7) |
| `electron/main/recipes/readiness.ts` | **novo — Fase 2** — espera de prontidão (§5; pós-telemetria E2) |
| `electron/main/recipes/__test__/autopilot.ts` | **novo — Fase 3** — autopilot e2e, **build de teste apenas** (C6/N4) |
| `electron/main/recipes/core.ts` | FINDER/`buildActionScript` — **inalterado no MVP**; `__pvFindDeep`/`pierce:` só na Fase 4 se E3 confirmar |
| `electron/main/recipes/runner.ts` | `runRecipe` com protocolo ESPERAR→CHECAR→AGIR→VERIFICAR (§5.4) |
| `electron/main/recipes/agent.ts` | fallback de 1º uso; budget de parede |
| `electron/main/sessions/manager.ts` | `openRecorder`, `disposeRecorder`, guarda de gravação no `did-finish-load` |
| `electron/main/db/seed.ts` | guard `origin === 'recorded'` no heal (§4.5) |
| `electron/main/ipc/index.ts` | handlers `wizard:*`, `recipes:reRecord` |
| `electron/preload/index.ts`, `src/lib/api.ts` | exposição ao renderer |
| `src/components/services/service-form-dialog.tsx` | modal "Novo acesso" em 2–4 etapas (§7.1) |
| `src/components/services/wizard/*` | componentes das etapas |
| `src/app/session/page.tsx` | banner passivo durante gravação |
| `tests/e2e/helpers/https-server.ts` | rotas `/wizard-*` (§9.3) |

**Comandos (por fase):**

```powershell
npm test                # vitest — sempre verde ao fim de cada fase
npm run test:e2e        # build + playwright (Fase 3 em diante)
npm run typecheck
npm run lint
npm run format:check
npm run test:coverage   # manter thresholds atuais do vitest.config.ts
```

---

## 14. Decisões de produto — FECHADAS (2026-11-13)

Fechadas pelo dono do produto na revisão de 2026-11-13. **Não reabrir sem nova decisão explícita.**

**A. Gravar robôs para serviços NATIVOS (builtin)?** → **NÃO no MVP.** "Reconfigurar robô" só em serviços personalizados; nativos mantêm "Regenerar automação" (restaura o seed).

**B. Campos não-credenciais durante a gravação (conta bancária, CPF do contribuinte, código de loja…)** → **Descartar o valor + aviso na revisão** (etapa opcional no replay). Única opção honesta — não há opt-in de "guardar este valor" no MVP.

**C. Verificação obrigatória ou opcional?** → **Opcional, MAS com nudge:** ao clicar "[Testar depois]", toast informativo não bloqueante: *"Recomendamos testar antes de confiar no robô — você pode testar depois abrindo o acesso."* Nunca bloquear.

**D. Fluxo "criar primeiro, gravar depois" (D14)** → **SIM** — o serviço é salvo na etapa 1 (receita automática no lugar) e a gravação é um passo opcional a seguir.

**E. Aviso de senha divergente bloqueia ou só avisa?** → **SÓ AVISA** na revisão ("a senha digitada não confere com a credencial salva; a etapa usará a credencial"); o robô é salvo mesmo assim. Bloquear irrita quem trocou a senha no portal.

**F. Teste real registra uso de credencial no audit?** → **Sim, com o mecanismo existente:** o evento existente `session.opened`/`credential` recebe **`origin: 'verify-test'` no metadata** — **nenhum tipo de auditoria novo**.

---

## Anexo A — Exemplo completo de `RecipeDefinition` gravada

```json
{
  "version": 1,
  "service": "iss-fortaleza",
  "auth": "password",
  "origin": "recorded",
  "recordedAt": "2026-11-13T18:20:11.000Z",
  "recordedScreens": 2,
  "steps": [
    {
      "action": "click",
      "selectors": ["#btn-fazer-login", "button:has-text('Fazer login')", "text=Fazer login"],
      "label": "Fazer login",
      "source": "recorded",
      "screen": "T1",
      "confidence": "high",
      "expectedAfter": { "urlIncludes": ["autenticacao.fortaleza.gov.br/login"], "timeoutMs": 8000 }
    },
    {
      "action": "fill",
      "selectors": ["[name=\"cpf\"]", "#cpf", "input[autocomplete=\"username\"]"],
      "value": "{{credential.username}}",
      "label": "Usuário",
      "source": "recorded",
      "screen": "T2",
      "confidence": "high"
    },
    {
      "action": "fill",
      "selectors": ["[name=\"password\"]", "#senha", "input[type=\"password\"]"],
      "value": "{{credential.password}}",
      "label": "Senha",
      "source": "recorded",
      "screen": "T2",
      "confidence": "high"
    },
    {
      "action": "click",
      "selectors": ["button[type=\"submit\"]:has-text('Entrar')", "text=Entrar"],
      "label": "Entrar",
      "source": "recorded",
      "screen": "T2",
      "confidence": "medium",
      "expectedAfter": { "urlIncludes": ["fortaleza.gov.br/contribuinte"], "timeoutMs": 10000 }
    }
  ],
  "postLogin": {
    "selectors": ["text=Sair", "a[href*=\"logout\"]", "[data-testid=\"logout\"]"],
    "timeoutMs": 45000,
    "urlIncludes": ["fortaleza.gov.br"],
    "urlExcludes": ["autenticacao"]
  },
  "autoSubmit": true,
  "onFailure": "manual",
  "captchaSelectors": ["iframe[src*='recaptcha']", ".g-recaptcha", "[class*='captcha' i]"],
  "twoFactorSelectors": ["input[autocomplete='one-time-code']", "input[name*='codigo' i]"]
}
```

> **Nota (C1):** em `wizard:save`, `postLogin`/`captchaSelectors`/`twoFactorSelectors` acima **vêm da receita corrente** (a automática recém-gerada para serviço novo, ou a de antes em re-record) — o wizard só substitui `steps`, `origin`, `recordedAt`, `recordedScreens`.

## Anexo B — Critérios de aceitação (o que "pronto" significa)

**Antes de qualquer merge para `main`, TODOS devem ser verdade:**

- [ ] `npm test` / `npm run typecheck` / `npm run lint` / `npm run format:check` — verdes
- [ ] `npm run test:e2e` verde, incluindo `wizard-recording.spec.ts`
- [ ] `grep` da senha E2E na definition salva = **0 ocorrências**
- [ ] `heal-recorded.test.ts` verde (receita `origin: 'recorded'` sobrevive ao boot)
- [ ] `wizard:save` preserva `postLogin`/`captchaSelectors`/`twoFactorSelectors` (teste **C1**)
- [ ] Gravação sem credencial produz warning `no-credential-bound` e fingerprint não é executado (testes **C2/N2**)
- [ ] Sonda do wizard durante gravação **NÃO** chama `markAuthenticated` (teste **C3**)
- [ ] Fechar janela/app durante gravação mostra dialog de confirmação (teste **C4**)
- [ ] `stepCapReached` (60) e teto de 15 min auto-finalizam como **draft parcial** (testes **C5/N1**)
- [ ] Bundle de produção **NÃO** contém `autopilot` — `grep -ri autopilot` em `out/`/`dist-electron/` = 0 (**C6/N4**)
- [ ] `shouldFallbackToAgent` testado como função pura (**C7**)
- [ ] 3 portais-alvo gravados e reexecutados com credencial de staging (manual — **Gate G3**)
- [ ] `SECURITY.md` atualizado mencionando a Gravação Assistida
