# Checklist de release — Gravação Assistida (Fase 5)

Itens de release verificados nesta entrega (2026-11-13). Os itens marcados
**operador** exigem acesso real/rede fora desta máquina.

## Build
- [x] `npm run build` — renderer + main + preload + workers: **verde**
- [x] `npm run typecheck` — **verde**
- [x] `npm run lint` — 0 erros (warnings pré-existentes mantidos)
- [x] `npx prettier --check` nos arquivos desta evolução — **verde**
- [x] `npm test` — **548+ testes verdes** (vitest)
- [x] `npm run test:e2e` — **9 specs verdes** (após Fase 3: +bota-roundtrip +wizard-negative)

## Segurança do bundle (N4/C6)
- [x] `node scripts/verify-release.mjs` → **0 ocorrências de "autopilot"** em `dist-electron/` e `out/` (verificado em 2026-11-13 após build de produção)
- [x] Autopilot existe apenas em `electron/main/recipes/__test__/autopilot.ts`, incluído **somente em build `NODE_ENV=test`**; produção não contém o código
- [x] `SECURITY.md` menciona a Gravação Assistida (seção "Gravação Assistida do robô de login")

## Produto
- [x] Gravação Assistida offline nos portais de teste (fixture local, 9 e2e)
- [x] Campos aprendidos cifrados por credencial (AAD `credentials:{id}:field:{name}`); renderer nunca vê valores
- [x] Telas pré-login gravadas (T1, T2...) — inclusive "tela anterior ao login"
- [x] Fluxo com cliente e **sem cliente** (sessão descartável)
- [x] Dois passes (certificado → senha) numa única receita
- [x] Pausar→humano em qualquer divergência (readiness, expectedAfter, seletor ausente, orçamento)
- [ ] **Operador**: gravar + reexecutar nos 3 portais-alvo reais (e-CAC, gov.br SSO, Redesim/SpeedGov) com credencial de staging e anexar evidência ao ticket
- [ ] **Operador**: coleta pós-auth (readyState/spinner/polling) para calibrar `quietMs`, se mediana > 5 s (regra do plano §5.3)
- [ ] **Produto**: se quiser "Entrar sozinho" na passada de certificado, revisar D11 (hoje força `false`)

## Rollback
- Reverter para automática: **Opções avançadas → Automação deste acesso → Regenerar automação** (apaga a gravada, restaura o automático, preserva `autoSubmit`)
- Receita gravada nunca é curada pelo boot (guard D10) — nada some sozinho
- Protocolo de sessão continua intacto (allowlist, downloads, popups)
