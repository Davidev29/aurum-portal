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
- **Fase 2 (readiness.ts + runner/agent + testes)** — ✅ entregue nesta data

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
pós-auth para calibrar `quietMs`; e `node scripts/verify-release.cjs` após o
build de produção.
