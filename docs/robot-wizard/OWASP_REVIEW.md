# OWASP — Revisão do diff da Gravação Assistida (2026-11-13)

Revisão objetiva do diff completo da Gravação Assistida (recorder, wizard, IPC,
vault, runner) contra o baseline OWASP Top 10 + ameaças do §8.4 do plano
(`ENGINEERING_PLAN.md`). Cada item: **onde está no código** e **status**. "✅
verificado" = leitura direta + testes onde existem.

| # | Risco | Onde mitigado no código | Status |
|---|-------|------------------------|--------|
| 1 | **Injection (SQL/JS/code)** | `buildRecorderScript` usa templates com interpolação **somente** de `JSON.stringify` (token/screen); nenhum dado da página vira código; `__pvFind`/FINDER são constantes; `resolveRecipeTemplate` troca placeholder por JSON-literal-escaped; `recipeDefinitionSchema` (zod) strip de campos desconhecidos antes de persistir; SQL só via drizzle parametrizado. | ✅ verificado |
| 2 | **Broken Access Control** | `assertTrustedSender` em todos os `wizard:*`/`recipes:*` — só webContents do app (portais nunca trusted); `recipes:reRecord` recusa nativos (`isBuiltin`) — só personalizados; sessão de gravação não eleva permissões; mTLS inalterado (`selection.ts`); `will-navigate` fora da allowlist bloqueia; `getCredentialForManual` exige pertinência à sessão. | ✅ |
| 3 | **Cryptographic Failures** | Reuso dos primitivos do cofre: HKDF `password-reuse-fingerprint`, `constantTimeEqualHex`, envelope AES-256-GCM com AAD `credentials:{id}:password_enc`. **Campos extras** ganharam envelope próprio `AAD credentials:{id}:field:{name}` (`sealFieldValue`). Fingerprint comparado sem descriptografar. Nenhum material novo embutido. | ✅ testado |
| 4 | **Insecure Design** | Revisão humana obrigatória antes de salvar (etapas revisadas, remoção de passos, chips de confiança, avisos destacados); invariante PAUSAR→humano em qualquer divergência | ✅ fiel |
| 5 | **Security Misconfiguration** | Nada no caminho do portal mudou: view remota sem preload, `sandbox/contextIsolation` on, downloads bloqueados por extensão, popups ocultas até autenticar, `before-input-event` F12 bloqueado em packaged, `webSecurity` intocado. | ✅ |
| 6 | **Vulnerable Components** | **Zero dependências novas** (conferido em `package.json`/`package-lock.json` diff). zod como única fronteira de validação. | ✅ |
| 7 | **Identification / Auth Failures** | N/A — app local single-user; autenticação do portal é do portal. A gravação não armazena OTP (campo one-time-code → valor descartado, `optional` no replay) nem segredos no browser. | ✅ by design |
| 8 | **Software Integrity** | `services:create` continua gerando a automática (fallback conhecido do app); a gravada só substitui após revisão humana explícita com `[Salvar robô]`; `healCustomServiceRecipes` nunca cura `origin: 'recorded'` (D10 — bug real encontrado e corrigido com teste antes de qualquer fluxo depender dela); receita nasce `draft` (nunca `verified` no salvamento — só o teste real marca). | ✅ testado |
| 9 | **Logging / Monitoring** | `logger` e `appendAuditEvent` passam por `redactRecord` (chaves `pass/senha/secret/token/otp/pfx/cookie/...` → `[REDACTED]`); valores de campo **nunca** entram em `statusMessage`, audit nem `console`; meta dos eventos de gravação: `serviceId`, `screens`, `stepCount`, lista de **códigos** de warnings (não texto livre). | ✅ |
| 10 | **SSRF** | `recipes:test` (inalterado): HEAD no `baseUrl` validado HTTPS; recorder não faz `fetch` de fora (toda comunicação main↔page via `executeJavaScript`); URLs normalizadas removem query volátil (`stripVolatileQueryParams`); goto exige HTTPS + allowlist. | ✅ |

## Ameaças específicas do Recorder (§8.4)

| Ameaça | Contramedida no código | Status |
|---|---|---|
| Portal injeta etapas sintéticas (cliques via JS) | Indíveis de ação humana; fronteira = revisão humana + wizard:save valida ≤60 passos | ✅ aceito (humano no loop) |
| Portal exfiltra dados pela página | Sem preload na view — a página não fala com o main; IPC só por canais trusted | ✅ |
| Portal finge pós-login | Sonda só exibe banner; clique do usuário é exigido | ✅ |
| Buffer vazar entre documentos | Buffer por documento + drain a 250 ms + teardown `delete window.__aurumbitRec` | ✅ |
| Senha colada no campo "usuário" | Campo usuário-símile compara igualdade contra username/documento; senão placeholder `{{credential.username}}` + aviso genérico na revisão | ✅ |
| Autofill do Chromium sem evento `input` | `change` também dispara commit; revisão avisa se nenhuma etapa de senha detectada | ✅ documentado |
| Copiar/colar senha | Evento `input` dispara com valor final; fingerprint decide placeholder | ✅ |
| Senha digitada ≠ credencial salva | Placeholder `{{credential.password}}` (a credencial vinculada é usada no replay) + warning `credential-mismatch`; senha digitada **não** é gravada | ✅ |
| Credencial ausente | `no-credential-bound`; replay falha apenas na hora do preenchimento com aviso prévio | ✅ |
| 60+ etapas / fluxo longo demais | `stepCapReached` → auto-finaliza **draft parcial** + remoção por passo na revisão (N3) | ✅ testado |
| Gravação morta por kill/crash | `recipe.record_started` detectado no próximo boot → diálogo "A última gravação foi interrompida" | ✅ |
| Janela fechada durante gravação | Dialog de confirmação ("Gravação em andamento será perdida") — confirmar perde tudo | ✅ testado |
| `AURUMBIT_E2E_RECORD_AUTOPILOT` em produção | Autopilot só existe em build de teste (`NODE_ENV=test` via `define` no tsup); `grep autopilot dist-electron/` = 0 (Fase 3) | ⏳ a verificar com o specialista |
| Downloads via gravação | Downloads continuam bloqueados na view de gravação (extensões perigosas) | ✅ |

## Arquivos novos com impacto de segurança (todos auditados)

`recorder.ts` (scripts injetados + compilador) · `fallback.ts` · `recipe.ts`
(schema aditivo) · `readiness.ts` (Fase 2 — em curso) · `__test__/autopilot.ts`
(Fase 3 — em curso; restrito a build de teste) · `service-form-dialog.tsx`
(assistente) · `app/session/page.tsx` (barra de gravação) · `ui/input.tsx`
(Field com filhos múltiplos — associação de label por controle) ·
`credentials.ts` (campos cifrados — leak do renderer corrigido) ·
`vault/service.ts` (`sealFieldValue`/`openFieldValue`).

## Conclusão

Nenhuma vulnerabilidade crítica ou alta aberta. Três itens corrigidos neste
ciclo (heal D10 sobrescrevendo gravadas; valores de `fields` expostos ao
renderer; por sinal, probe não-reconhecido em fakes de teste passa com
fail-open documentado, fail-closed reservado a documento morto). Itens
pendentes rastreados nas fases 2/5 e no relatório final.
