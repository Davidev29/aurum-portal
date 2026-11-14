# Entrega — Gravação Assistida do Robô de Login

> Data: 2026-11-13 · Branch: `main` (aurum-portal) · Escopo: todas as fases do
> plano `docs/robot-wizard/ENGINEERING_PLAN.md` (revisão aprovada do dono do
> produto), itens previamente replicados e os pendentes apontados nas
> conversações de 2026-11-13.
>
> **Relatório de entrega completo está na resposta de encerramento da sessão
> do agente** (incluindo métricas, decisões tomadas de forma autônoma, e o que
> exige a mão do operador). Este arquivo é o registro persistente.

## Escopo entregue vs. pedido original

Pedidos do dono do produto (2026-11-13): “o robô aprende os campos que o
portal vai fornecer; criar novo serviço não exige cliente; telas antes do
login ensináveis; funcionamento robusto e seguro; implementar todas as fases
que faltam; empurrar para o GitHub com relatório.”

### Entregue nesta data

- **Robô que aprende os campos do portal** (`definition.fields`,
  placeholders `{{credential.<key>}}`, valores só na credencial) — ✅
- **Criar serviço sem cliente** — ✅ (sessão de gravação descartável, sem
  linha em `sessions`, sem partição persistida; certificado continua exigindo
  cliente, pois o A1 tem dono)
- **Dois passes: certificado primeiro, depois senha** — ✅
  `certificateSteps`/`passwordSteps` + `recipeForSession` por método
- **Telas antes do login explícitas** (etapa gravadas com nome/tela/confiança) — ✅
- **Ensino pelo portal com botão de concluir no próprio portal** — ✅
- **Campos aprendidos cifrados na credencial; renderer nunca vê valores** — ✅
  (corrigiu também a exposição pré-existente dos valores legados)
- **Fase 1 (criar→gravar→salvar), Fase 3 (reRecord, verificação,
  autopilot e2e), Fase 4 (corte de pierce: — Light DOM nos fluxos de
  login), Fase 5 (docs/SECURITY/RELEASE_CHECKLIST/OWASP)** — ✅
- **Fase 2 (readiness.ts + runner/agent + testes)** — ✅ concluída em 2026-11-13
  (587/587 testes verdes; `readiness.ts` 98% linhas / 91% branches;
  decisão registrada: sonda não reconhecida (fake legado) = fail-open Fase 1,
  documento morto = `ReadinessProbeError` = PAUSE fail-closed)

## Documentos de referência

- `docs/robot-wizard/ENGINEERING_PLAN.md` — plano completo e estado das fases
- `docs/robot-wizard/NAMED_FIELDS_SPEC.md` — campos nomeados, ensino sem cliente, dois passes
- `docs/robot-wizard/RECORDING_GUIDE.md` — guia de suporte (operador)
- `docs/robot-wizard/OWASP_REVIEW.md` — revisão OWASP do diff desta entrega
- `docs/robot-wizard/RELEASE_CHECKLIST.md` — checklist de release (com itens do operador)
- `docs/SECURITY.md` — menciona a Gravação Assistida

## O que exige a mão do operador (não é código)

Ver `RELEASE_CHECKLIST.md` §"Operador". Resumo: staging nos 3 portais-alvo
(e-CAC, gov.br SSO, Redesim/SpeedGov) — gravar + reexecutar; telemetria
pós-auth para calibrar `quietMs`; e `node scripts/verify-release.mjs` após o
build de produção.

## Entrega final (2026-11-13)

**Fases entregues:** Pré-Fase 1 (D10) ✅ · Fase 1 (criar→gravar→salvar, assistente, Chrome HUD, IP-host, Field fix) ✅ · Fase 2 (readiness + integração) ✅ · Fase 3 (reRecord, verificação ritual, e2e completo com boot roundtrip e variante negativa, autopilot C6) ✅ · Fase 4 (corte de `pierce:` — medir ✅) ✅ · Fase 5 (OWASP, SECURITY, RELEASE_CHECKLIST, DELIVERY_REPORT, verify-release.mjs) ✅.

**Métricas finais (nesta máquina):**
- `npm test` — **595 / 595** (48 arquivos)
- `npm run test:e2e` — **9 passed, 1 skipped** (caso autopilot skipado no bundle de produção; verificado com `NODE_ENV=test build`: 2/2)
- `npm run typecheck` — verde (tsconfig.json + tsconfig.electron.json)
- `npm run lint` — **0 erros** (warnings pré-existentes ignorados)
- `node scripts/verify-release.mjs` → **0 ocorrências de "autopilot"**
- `npm run build` — verde; bundle de produção `dist-electron/main.cjs` 317 KB

**Bugs pré-existentes de produção corrigidos neste ciclo:** (1) heal `healCustomServiceRecipes` sobrescrevia receitas gravadas (D10) — corrigido com guarda + teste; (2) `Field` com filhos múltiplos nunca associava `htmlFor/id`; (3) portais por IP não cadastravam — `domainSchema` aceita IP literal e `deriveAllowedDomains` não expande domínios fantasma; (4) recorder **nunca armava** em sessão de gravação (`did-finish-load` ausente no `openRecorder`) — toda gravação produzia receita vazia; (5) `interruptedRecordingIds` invertia o significado e ressuscitava wizards fechados — modal bloqueante no boot; (6) valores de `fields` expostos em claro no renderer — corrigido para AES-256-GCM AAD por campo; (7) "Entrar sozinho" ignorado no merge de dois passes — corrigido.

**Limitações honestas (operador):** portais reais em staging não podem ser validados nesta máquina (sem credenciais); release ao público persiste como pendência do operador — ver `RELEASE_CHECKLIST.md`.
