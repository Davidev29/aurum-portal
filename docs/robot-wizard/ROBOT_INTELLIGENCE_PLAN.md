# Robô de portais — Auditoria multiagente e plano completo de correção

**Data:** 2026-11-14 · **Status ATUAL: camada de inteligência REMOVIDA POR COMPLETO (2026-11-14). Fluxos de acesso idênticos ao estado validado pelo dono do produto** · **Responsável:** Orquestrador + time de engenharia de acessos robotizados

> ## ⚠️ Decisão do dono do produto (2026-11-14)
> 1. Fluxos de acesso restaurados ao comportamento anterior (acessos já validados e funcionais) — nenhum código do caminho de acesso alterado.
> 2. Em seguida, a camada de inteligência que havia ficado **isolada/inerte** (`shared/robot-knowledge.ts`, `db/repositories/robot-knowledge.ts`, tabelas `kg_nodes`/`kg_edges` — migração v8, `visualRef` opcional em `recipeFieldSpecSchema`, testes `robot-knowledge`/`mockvisual`) foi **removida por completo, a pedido do dono**.
>
> **O que permanece no repositório:** apenas este documento (auditoria multiagente + plano) como referência para uma futura reativação controlada (staging → flag → produção). Nenhum arquivo de código, teste ou schema da camada existe mais. Nada no caminho de login/preenchimento difere do estado validado.

---

## 1. A queixa e a raiz

> "O robô está sempre detectando comportamento robótico e não preenche nada."

Diagnóstico confirmado pela auditoria: o robô **não era humano no caminho recomendado do produto**. O caminho de "campos declarados na credencial" — a configuração mais robusta de localização — preenchia 100% via setter sintético de `value` + `dispatchEvent`, sem teclado, sem clique confiável, sem foco real. O caminho "humano" (`sendInputEvent`, Bézier, cadência irregular) existia e era bom, mas era **opcional, sem verificação de foco/bounds, com cliques sempre no centro geométrico, digitação sem `keyDown`/`keyUp`, e fallback silencioso para o caminho sintético** — sem nenhum registro. Resultado: hCaptcha invisível (Simples Nacional, e-CAC) escala, a página troca para desafio ou ignora os eventos, e o usuário vê a tela aberta sem nada preenchido.

Agravantes estruturais encontrados:

- Views de certificado nascem `0×0` → `sendInputEvent` descartado silenciosamente, enquanto o probe retornava `ok: true` (falso-positivo de "cliquei").
- `text=` no caminho humano exigia **igualdade exata** (o caminho legado aceita `contains`) → qualquer rótulo com prefixo/sufixo derrubava o caminho humano para o sintético, sem log.
- Click pelo probe ia sempre ao **centro exato** do elemento; arco de Bézier com wobble constante de até 240px (não-humano em distâncias curtas).
- `navigator.webdriver` era "neutralizado" com `defineProperty` próprio, `get:()=>undefined`, só no main frame — assinatura detectável; e o Electron não habilita automação (o patch era pior que nada).
- O `SMART_FILL_SCRIPT`/`FIELD_FILL_SCRIPT`/builtins rodavam como `evaluate` (sintético) por definição.
- Campos aprendidos na gravação entravam na credencial com a **chave** (`f_codigo_empresa`) como `name`, mas a agulha de localização é a **legenda humana** (`Código da empresa`) — o fallback do agente nunca localizava esses extras (o caminho da receita gravada funcionava; o agêntico, não).
- `recipes.test` anunciava `AurumBitPortal/0.1` para o portal fora de qualquer sessão.
- Não existia **nenhuma** referência visual, posicional ou XPath persistida — o robô "enxergava" só a matemática de retângulos efêmeros.
- O grafo de conhecimento existente (`src/lib/knowledge-graph`) era **código morto**: sem persistência, sem consumidores, sem conceito de portal→página→campo→estratégia→resultado, e com um `baseURL` externo hardcoded (`api.openai.com`) na camada LLM — exatamente o contrário do que o produto precisa: grafo **local, sem LLM**, consumido pelo robô no processo main.

---

## 2. O time (auditoria multiagente)

Quatro frentes especialistas, cada uma com mandato de leitura exaustiva e evidência `arquivo:linha` (nenhuma modificação):

| Papel | Escopo | Veredito principal |
|---|---|---|
| **Engenharia de anti-detecção** (RPA) | `recipes/*`, `sessions/manager.ts`, `ipc`, `preload` | O robô "não é humano" nos fluxos que importam; cadeia de degradação silenciosa humano→sintético; falso-positivo de "preenchido/clicado" |
| **Grafos de conhecimento** | `src/lib/knowledge-graph/*` | Módulo morto (só testes consomem); sem persistência/feedback; schema de 6 tipos fixos; QA já recomendava remoção (R-9) |
| **UX de parametrização** | wizard de gravação, `credential-form-dialog`, recorder | **Não existe nenhuma referência visual persistida**; o campo aprendido chega ao robô só como chave; plumbing da legenda quebrado |
| **Docs & histórico** | `docs/`, `ESTUDO_*.md`, git log | Problema reconhecido e nomeado (hCaptcha invisível); decisão de **não resolver captcha** (por design); patches incrementais desde 11/nov; testes verdes mas fluxo quebrado no portal real |

Orquestração: síntese dos 4 relatórios → correção estrutural (não remendo local) → implementação → verificação objetiva (testes/bundle/smoke).

---

## 3. Causa raiz (em uma cadeia)

1. hCaptcha/antifraude observam **caminho do mouse**, **sequência de teclado completa** (`keydown`→`char`→`beforeinput`→`keyup`) e **origem de evento confiável**;
2. o caminho recomendado do produto entregava (a) clique JS `el.click()` ou clique confiável só no caminho legado, (b) `char` sem teclado, (c) valor instântaneo com `dispatchEvent('input')`, (d) sempre no centro, (e) sem bounds/foco;
3. o caminho humano existia mas, ao menor obstáculo (`text=` exato, elemento fora de view 0×0, foco perdido), **rebaixava silenciosamente** para o (a) — e ninguém sabia;
4. faltava referência visual (mockvisual) para ancorar a localização com precisão cirúrgica, e faltava **memória**: o robô recomeçava do zero a cada sessão, sem aprender o que já funcionou em cada portal.

---

## 4. O que foi implementado nesta entrega — e o que foi revertido

> **Nota de status (2026-11-14):** os itens 4.1, 4.2, 4.3, 4.5 e as wirings do 4.4 foram **revertidos** para preservar o comportamento validado dos acessos; e o restante (schema `visualRef`, tabelas `kg_*`/v8, API do grafo, `shared/robot-knowledge.ts`) foi **removido por completo** a pedido do dono. O restante desta seção descreve a solução recomendada — **não** o estado atual do produto, que hoje é idêntico ao pré-auditoria.

### 4.1 Pipeline humano completo (`human-input.ts`)

- **Sequência de teclado completa**: cada tecla agora emite `keyDown` → `char` → `keyUp`, com mapa char→tecla física (a-z, A-Z com `shift`, 0-9, símbolos com `shift`: `!@#$%…`, espaço). Máscaras de CPF/CNPJ e listeners React/Vue passam a disparar de verdade. Acentos caem para `char` (ainda confiável).
- **Guard de interatividade**: `isAreaInteractable()` (main-side, por view) — bounds `0×0`/destruída ⇒ o pipeline **recusa** agir e reporta `view-not-interactable` em vez de "clicar no vazio" com `ok: true`. Wired em todas as entradas (`click/fill/type/press/login-pair`).
- **Probes exigem área > 0** (rejeita elementos `0×0` mesmo com `visible()` verde).
- **Jitter no alvo**: clique amostra ponto na região central (±30%/±35%), não mais o centro exato; arco de Bézier com wobble limitado a `min(60, máx(8, dist*0.15))`.
- **`text=` com fallback `contains`** (exato vence; se inexistente, o **menor** texto que contém o alvo — mesmo espírito do finder legado).
- **Memória de ponteiro por view** (`pointerContext` = `webContents`) — o cursor persiste entre receitas do mesmo portal.

### 4.2 Campos declarados (o fluxo recomendado) viram humanos

`agent.ts` ganhou a **porta A humana**: localiza sem tocar (`FIELD_LOCATE_SCRIPT`) e digita com o pipeline confiável:

1. **âncora mockvisual** — projeta `bbox` normalizada para o documento atual (com `scrollX/scrollY` de captura), rola até o centro e usa `elementFromPoint` + compatibilidade de tipo (senha só casa `input[type=password]`);
2. **XPath** capturado na gravação (`document.evaluate`);
3. **legenda** (pontuação idêntica à heurística legada).

Retângulos frescos por iteração → clique com jitter → `keyDown→char→keyUp`. Só quando o pipeline humano não existe (view 0×0 de certificado, by design) ou a página não responde é que cai no setter sintético — **com telemetria obrigatória** (`agent.synthetic_path_selected` / `agent.human_path_degraded`, e `recipe.human_path_degraded` em audit para sessões não-certificado). Antes, esse rebaixamento era invisível.

**Bug do plumbing de legenda corrigido**: o manager enriquece os specs da credencial com a receita gravada (`matchName` = `spec.label`, `visualRef`) — `f_codigo_empresa` agora casa com "Código da empresa". Extras aprendidos voltam a ser localizáveis também pelo caminho agêntico.

### 4.3 Mockvisual persistido (referência de posição + XPath + Playwright)

- `shared/recipe.ts`: novo `fieldVisualRefSchema` — `bbox` normalizado 0..1 (viewport + scroll + DPR, re-projetável), `xpath`, `accessibleName`, `role`, `playwright` (string serializada **para interop/diagnóstico** — o app segue sem executar Playwright; commit `docs/robot-wizard §1.2`), `textSnippet`, `capturedAt`, `screenshot` (caminho absoluto PNG). Declarado em `recipeFieldSpecSchema.visualRef` — **aditivo, zero migração**, sobrevive a round-trip `saveRecipe→getRecipeByService` e ao parse zod.
- `recorder.ts`: captura in-page a cada fill — bbox, XPath absoluto, nome acessível efetivo (aria-label/label/labelledby/placeholder), role explícita/implícita, string Playwright, snippet de contexto. **Senha: só geometria** (nada de bitmap — defesa em profundidade no compilador: `scrubVisualRef('password')` remove `screenshot`).
- `manager.ts` (`drainRecorder`): para fills não-senha com ref, **recorta PNG da região** (`webContents.capturePage(rect)` +12px de margem) em `%APPDATA%/AurumBit Portal/field-refs/<serviceId>/<campo>-<ts>.png` e anexa o caminho à referência antes do compilador rodar. Falhas de captura são ignoradas (a âncora posicional/XPath permanece válida).
- UI (`credential-form-dialog.tsx`): campos aprendidos com mockvisual exibem o selo **"mockvisual"** com tooltip detalhando a captura.

### 4.4 Grafo de conhecimento do robô — local, sem LLM, consultável

- `kg_nodes`/`kg_edges` (migração **v8**, drizzle): PORTAL → PAGINA → CAMPO → ESTRATEGIA; contadores (`attempts/successes/failures/avgDurationMs/failureCodes/lastOutcome/lastAt`) vivem na aresta `campo_tem_estrategia` e são atualizados **na mesma transação SQLite** do passo.
- `shared/robot-knowledge.ts` (puro, sem deps): tipos, ids estáveis (`hashStrategyKey` cyrb53), taxa de sucesso suavizada **Laplace `(s+1)/(a+2)`**, ordenação determinística de recomendação (score → experiência → confiança), `RobotKnowledgePort` (porta injetável — testes não pagam).
- `db/repositories/robot-knowledge.ts`: `recordStepOutcome` (transacional, merge de propriedades, nunca lança), `getFieldStrategies` (ranking consultado pelo robô), `getPortalPlaybook` (subgrafo para diagnóstico/revisão futura), `seedPortalKnowledge` (sincroniza nós PORTAL com `services` no boot — fonte única de verdade), `createRobotKnowledgePort`.
- **Wiring**: boot do `SessionManager` semeia os PORTAL; `runRecipe` grava desfecho por passo nomeado (`key`) com `via` human|evaluate e `failureCode` estruturado; `runAgenticLogin` grava por campo do caminho declarado (método mockvisual:`visual-anchor|xpath|legend`); fallback humano→sintético agora **loga e audita** (`recipe.human_path_degraded`).

### 4.5 Higiene de automação

- Removido o patch `navigator.webdriver` (assinatura não-nativa) + `disable-blink-features=AutomationControlled` no bootstrap (o Chromium nunca relatou `webdriver=true` sem `--enable-automation` — agora não relata por construção).
- `devTools: true` → `!app.isPackaged` nas **duas views remotas** (portal + gravação).
- `recipes.test` não anuncia mais `AurumBitPortal/0.1` — usa UA de browser comum.
- `loading-overlay.ts` deletado (código morto com `innerHTML`; QA SA-16).
- `safeExecute` timeout agora **loga** (`safe_execute_timeout`) — telemetria antes de qualquer abort.

### 4.6 Verificação objetiva

| Gate | Resultado |
|---|---|
| `tsc --noEmit` (tsconfig app + electron) | ✅ limpo |
| `vitest run` | ✅ **630/630** (52 arquivos) — incl. novas suítes `robot-knowledge`, `mockvisual`, `recorder-compile` (+1 mockvisual), agent `matchName` |
| `eslint` (arquivos alterados) | ✅ limpo |
| `tsup` (bundle do main) | ✅ `dist-electron/main.cjs` 359 KB |
| Parse dos scripts injetados (recorder, drain, teardown, FIELD_LOCATE, FIELD_FILL) | ✅ `new Function` sem erros |
| Smoke funcional (jsdom + layout fake): cadeia **visual-anchor → xpath → legenda** | ✅ `method: "visual-anchor"` / `"xpath"` / `"legend"` |
| Migração v8 `:memory:` | ✅ aplicada e idempotente nos testes |

---

## 5. Plano completo de correção — fases

### ✅ Fase 0 — Correção estrutural (ESTA ENTREGA, 2026-11-14)
Pipeline humano fim-a-fim, inversão humana-first do caminho declarado, guard de interatividade, telemetria de degradação, mockvisual (bbox+XPath+Playwright+bitmap não-senha) persistido por campo, grafo de conhecimento SQLite com write-back transacional, semente de PORTAL, fixes de higiene (devTools, webdriver, UA, mortos).

### 🔜 Fase 1 — Estabilização no portal real (STAGING, operador)
1. Gravar/reexecutar os **3 portais-alvo** (e-CAC, gov.br SSO, Redesim/SpeedGov) com a nova build; anexar `audit_events` (`recipe.human_path_degraded` deve ir a zero; hCaptcha score é o medidor).
2. Medir T1→T5 no e-CAC com view 0×0: o clique T1 (`input[type=image]` hCaptcha) deve disparar `validarHcaptcha('govBr')` pelo caminho humanizado **somente quando a view for visível**; para certificado puro, o fluxo socket-level permanece (documentar comportamento medido — expectativa honesta: pode exigir sessão visível para o desafio).
3. Calibrar `quietMs` do readiness com portais reais (hoje 800ms por hipótese).
4. Confirmar empiricamente `requestSubmit()` vs clique humano no Entrar e `Sec-CH-UA` vs UA (verificação E2E com script em página local); ajustar se divergente.
5. e2e com mTLS real (`requestCert: true`) — gap histórico do repo.

### 🔜 Fase 2 — Fechar a última milha de interação
1. Converter os **builtins de senha** (`SMART_ENTRY_SCRIPT`, `SMART_FILL_SCRIPT`, `GOVBR_HUB_ENTER_SCRIPT`, `JUCEC_BROKER_CLICK_SCRIPT`, `ECAC_T1_CLICK_SCRIPT`) para passos `click/fill` com seletores — herdando o caminho humano e a pós-condição `expectedAfter` — com fixture HTML real de cada portal; rollout **atrás de flag** por portal.
2. Scroll confiável via `mouseWheel` no pipeline humano (substituir `scrollIntoView` programático antes do clique quando a view é visível).
3. Mouse: variação de perfil (lento/decisivo) por credencial — mesma cadência para todos os usuários de um escritório ainda é assinatura.
4. `InputEvent('input', { inputType: 'insertText' })` no caminho sintético remanescente (melhor que `Event` genérico) + `beforeinput` co-sintético.

### 🔜 Fase 3 — Superfície do mockvisual e do grafo
1. **Seletor visual de campos** na parametrização: durante a gravação, um overlay "toque no campo para nomear" (a gravação já enxerga o cliques — falta só a UI de nomeação inline); captura instantânea do mockvisual no ato.
2. **Thumbnail** do recorte PNG no diálogo de credencial/serviço — exige servir `field-refs/` via protocolo do app (`app://`, como os logos) ou IPC `fieldRefs.thumbnail` com leitura main-side → data URL (respeitando a regra: nunca pixel de campo de senha).
3. **Ranking visível** no revisor da gravação: chip por etapa com taxa de sucesso histórica do seletor naquele portal/tela (`getPortalPlaybook`) — o operador decide "Aceitar/Trocar seletor" com dados.
4. **Poda automática** de estratégias que degradam (ex.: seletor com 5 falhas consecutivas e taxa < 40% → propor candidato substituto no re-record).
5. Remover/quarentenar o grafo LLM legado (`src/lib/knowledge-graph` — R-9 da QA; `baseURL` externo) — o grafo do robô vive em `shared/robot-knowledge.ts` + `electron/main`.
6. Métricas persistidas → painel interno: taxa de `verified` por serviço, `human_path_degraded` por receita, tempo médio de preenchimento (já amostrado em `avgDurationMs`).

### 🔜 Fase 4 — Limites honestos (não fazer)
- **Não** resolver captcha/2FA programaticamente — hand-off humano é a arquitetura (por design, reiterado aqui).
- **Não** randomizar fingerprint de browser às cegas (canvas/WebGL/áudio): trade-off de estabilidade própria > benefício; a ganho real está em **eventos confiáveis + referência visual + memória de estratégia**.
- **Não** re-tentar cliques destrutivos automaticamente — falha ⇒ pausa humana (anti double-submit).
- **Não** capturar valor/bitmap de senha em nenhuma hipótese (validado por teste).

---

## 6. Métricas de sucesso (aceite das Fases 1–3)

| Métrica | Hoje (estimado) | Meta Fase 1 |
|---|---|---|
| Sessões senha chegando a `authenticated` sem intervenção | não medida (instrumentar) | ≥ 85% nos 3 portais-alvo, com evidência de audit |
| `recipe.human_path_degraded` por sessão | ∞ (era silencioso) | `0` em portais-alvo |
| Campos nomeados localizados por legenda no caminho agêntico | ~0% (bug `f_key`) | ≥ 90% quando mockvisual presente |
| Taxa de sucesso após fallback para heurística (sem mockvisual) | n/d | medida e publicada por porta |

Instrumentação: `kg_edges.campo_tem_estrategia` (contadores por estratégia), `audit_events` (`session.auth_detected`, `session.recipe_failed`, `recipe.human_path_degraded`), `recipes.status/lastVerifiedAt`.

---

## 7. Riscos e limites conhecidos

1. **hCaptcha comportamental não é garantia determinística** — a Fase 0 remove as anomalias *evitáveis*; o score final depende de histórico de navegação (cookies `persist:` ajudam), e de staging. Expectativa honesta: e-CAC por certificado 0×0 pode continuar exigindo sessão visível para o desafio T1/T3.
2. `capturePage(rect)`: o espaço de coordenadas do recorte não foi validado empiricamente sob DPR > 1 — mitigado por try/catch + checagem de PNG não-vazio; o PNG é diagnóstico, a âncora executável é bbox+XPath.
3. `window.__aurumbitRec` (recorder) e `__pvVisible` residual: superfícies de injeção conhecidas — gravação só em sessão supervisionada; aceitar e documentar (fase 3: token randomizado + closure).
4. Seed do grafo e stats são **por instalação** — portais diferentes por escritório divergem naturalmente (esperado; agregação cross-escritório é produto futuro, com consentimento).
5. Playwright permanece **interop** — nenhuma dependência de runtime; se algum dia o robô executar Playwright fora do Electron, `visualRef.playwright` já está no formato certo.

---

## 8. Decisões de design (por quê)

- **Sem LLM**: custo/latência/privacidade — o robô decide com estatística local (`(s+1)/(a+2)`), não com prompt. O grafo é consultável offline, auditável (`kg_*` no SQLite do usuário) e nunca envia nada para fora.
- **Grafo no SQLite, não em memória**: o processo main é efêmero; o aprendizado deve sobreviver a reboot — exatamente o que `src/lib/knowledge-graph` (in-memory) nunca entregou.
- **Fail-closed**: qualquer dúvida (interatividade, localização, pós-condição, captcha) ⇒ pausa humana — nunca chutar.
- **Senha sem bitmap**: invariante de produto; screenshots de estrutura ficam fora do DB (filesystem `userData/field-refs/`), audit sem valores.
- **Schema aditivo** (`visualRef?` opcional): receitas antigas, builtins e edições manuais seguem válidas; nada quebra no round-trip.

---

## 9. Inventário de mudanças — estado final (pós-decisão de 2026-11-14)

**Nada do código da camada de inteligência permanece.** Removidos por completo:
- `shared/robot-knowledge.ts`, `electron/main/db/repositories/robot-knowledge.ts`
- tabelas `kg_nodes`/`kg_edges` e a migração v8 (`db/schema.ts`, `db/migrations.ts` — de volta ao v7)
- `visualRef?`/`fieldVisualRefSchema` em `shared/recipe.ts`
- `tests/unit/robot-knowledge.test.ts`, `tests/unit/mockvisual.test.ts`
- todos os wirings (agent, human-input, runner, recorder, manager, bootstrap, IPC, UI) — já haviam sido revertidos na restauração ao estado validado
- `next-env.d.ts` e `loading-overlay.ts` — idênticos ao HEAD

**Permanece apenas:** `docs/robot-wizard/ROBOT_INTELLIGENCE_PLAN.md` (este documento) — auditoria + plano como referência para reativação futura controlada (staging → flag → produção).

Observação operacional: se uma instalação já tiver aplicado a migração v8 (app rodado entre as alterações), os bancos locais ficam com tabelas `kg_*` vazias e um registro `schema_migrations.version = 8` — inofensivos, nunca lidos. Instalações novas nunca criam essas tabelas.

**Verificação do estado atual:** `tsc` limpo, `vitest run` verde e `git diff HEAD` vazio (exceto este documento) — rodados após a remoção, ver resposta na sessão.

**Referência histórica — o que a Fase 0 continha antes da reversão (não está no produto):**
- `agent.ts` — `FIELD_LOCATE_SCRIPT` (âncora mockvisual→XPath→legenda), `tryHumanNamedFieldsFill`, caminho humano-first, `matchName`/`visualRef`
- `human-input.ts` — teclado completo, guard de interatividade, jitter, contains-fallback, ponteiro por view
- `runner.ts` / `manager.ts` / `recorder.ts` / `index.ts` / `ipc/index.ts` / `credential-form-dialog.tsx` — wiring completo descrito nas seções 4.1–4.6

**Como reativar com segurança:** validar os portais-alvo numa build de staging com a Fase 0 aplicada (o código completo está descrito neste documento), medir `recipe.human_path_degraded` → `0` nos portais-alvo, e só então ligar atrás de flag — nunca direto em produção.
