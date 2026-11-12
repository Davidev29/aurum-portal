# Avaliação Completa — AurumBit Portal 0.1.0

**Data:** 2026-11-12 · **Escopo:** aplicação inteira (main process, renderer Next.js 16, build/empacotamento/CI, documentação, testes) + QA de stress pré-existente ([docs/qa/QA-STRESS-REPORT.md](QA-STRESS-REPORT.md), APPROVED).
**Método:** quatro revisões independentes somente-leitura por agentes especializados, cruzadas com o working tree de 2026-11-12 (build local presente em `out/`/`dist-electron/`). Branch `main`; `origin = github.com/Davidev29/aurum-portal` (**repositório público**, 3 commits).

---

## 1. Veredito consolidado

| Área | Laudo | Veredito | S1 | S2 | S3 |
|---|---|---|---|---|---|
| Segurança e arquitetura (main, vault, IPC, sessões, cofre) | [EVAL-security-architecture.md](EVAL-security-architecture.md) | **CONCERNS** | 0 | 7 | 9 |
| Renderer / UI (Next.js 16, React Query, a11y, páginas) | [EVAL-renderer-ui.md](EVAL-renderer-ui.md) | **CONCERNS** | 0 | 2 | — (ver laudo) |
| Build / empacotamento / CI / release | [EVAL-packaging-ci.md](EVAL-packaging-ci.md) | **CONCERNS** | 0 | 5 | 6 |
| Documentação / ADRs / cobertura de testes | [EVAL-docs-tests.md](EVAL-docs-tests.md) | **CONCERNS** | 0 | 10 | — (ver laudo) |
| QA de stress + E2E (avaliação anterior) | [QA-STRESS-REPORT.md](QA-STRESS-REPORT.md) | **APPROVED** | 0 | 0 (5 falhas corrigidas) | — |

**Não há nenhum S1** em nenhuma das quatro revisões. O app é tecnicamente confortável para
**uso interno controlado** (estação dedicada, sem acesso externo, certificado A1 próprio),
mas **NÃO está pronto para distribuição externa** como 0.1.0 (ver §4).

---

## 2. S2 — consolidado e deduplicado (25 achados; ação recomendada antes de distribuir)

### 2.1 Distribuição / release (P-1…P-5) — nada pode sair sem isto
- **P-1 · `electron-builder.yml:32`** — `build/icon.ico` inexistente; EXE/instalador sairão com ícone padrão do Electron.
- **P-2 · `electron-builder.yml:34`** — **zero assinatura de código** (EXE e NSIS): SmartScreen garantido, AV-heurística provável.
- **P-3 · `electron-builder.yml:44-47`** — canal de updates aponta para `updates.aurumbit.invalid` (TLD reservado); o build se anuncia atualizável e nunca se atualiza.
- **P-4 · `ci.yml:17-59`** — CI nunca empacota (`dist:dir`), nunca roda e2e/stress/coverage; `dist/` não existe; release é não verificado.
- **P-5 · `package.json` + `electron-builder.yml:11`** — ~360 MB de dependências de produção empacotados (`next` ~184 MB etc.); runtime real precisa de `better-sqlite3` (+`electron-updater` se mantido).

### 2.2 Segurança (SA-1…SA-7)
- **SA-1** — `npm audit`: `zod@3.25.76` (high, GHSA-mrhx-c7xc-m3w5) e `node-forge@1.4.2` (moderate, 4 advisories); fixes exigem bumps planejados.
- **SA-2** — CSP da UI com `script-src 'unsafe-inline'` (scripts inline do export); anula contenção same-origin de XSS.
- **SA-3** — janela de sessão e `WebContentsView` de portal remoto nascem com `devTools: true` e `plugins: true` (UI local tem `devTools: isDev`).
- **SA-4** — `icp-chain.ts` (download + instalação silenciosa de CA em `Cert:\CurrentUser\CA`) é **código morto**; perigoso se religado; contradiz "não instala raízes ICP-Brasil".
- **SA-5** — `certificateImportSchema` aceita `filePath` absoluto do renderer (varredura/exfiltração de PFX legível no perfil).
- **SA-6** — PFX gravado em `%TEMP%` com ACL padrão; senha do PFX em base64 dentro de `.ps1` (base64 ≠ criptografia). *(O `runPowerShell` já foi corrigido na rodada de QA para limpar de forma síncrona; a senha continua no arquivo durante a operação.)*
- **SA-7** — PII do escritório (nomes, CPF/CNPJ, e-mails, honorários, notas) em SQLite **sem criptografia**; só segredos (senhas/PFX) são selados — exposição LGPD em cópia do banco.

### 2.3 Renderer (R-1, R-2)
- **R-1** — `isError` do React Query ignorado em todas as páginas → falha de IPC/banco renderiza "cofre vazio"/0 sem aviso nem retry.
- **R-2** — ausência de `error.tsx` / `global-error.tsx` / `not-found.tsx` → exceção de render = janela branca sem recuperação (DevTools off em produção).

### 2.4 Documentação ↔ código (D-1…D-10)
- **D-1** — `docs/USER_GUIDE.md:46` documenta botão "Bloquear e fechar sessões" que **não existe** no shell (handler `app:lock` sem chamador).
- **D-2** — `docs/USER_GUIDE.md:242` manda abrir tela **"Acessos"** inexistente (sem rota, sem item de menu).
- **D-3** — Tabelas de portais embutidos omitiam os 10 portais SpeedGov e erravam categorias/métodos (§7 desta avaliação documenta a tabela corrigida).
- **D-4** — "Envio sempre manual"/"não envia o formulário" documentados, mas receitas geradas nascem com `autoSubmit: true` ("Entrar sozinho" — clica em Entrar de fato).
- **D-5** — TSA "trocável/testável em Configurações": a seção de TSA está **oculta** na UI (`settings/page.tsx`); ADR 0008 e SECURITY.md repetem a promessa.
- **D-6** — CI não roda `test:coverage` (thresholds decorativos), `test:stress` nem `test:e2e` — e2e de obrigações (visão do mês) não é gate de merge.
- **D-7** — **zero testes de IPC** (`registerIpcHandlers`, `assertTrustedSender`, throttles, `toErrorResponse`); frontend→main sem cobertura de unidade.
- **D-8** — `docs/PRIVACY.md` omite **3 fluxos externos**: BrasilAPI (opt-in), TSA DigiCert (hash vai a provedor dos EUA), favicon fetch (`services/logo.ts`).
- **D-9** — "497/497" contestado estaticamente (452 ocorrências) — **arbitrado pelo runner**: `vitest --reporter=json` confirma **497/497**; métrica mantida, com fonte.
- **D-10** — `icp-chain.ts` morto (mesmo módulo de SA-4); SECURITY.md alega "app não instala raízes ICP-Brasil" (verdadeiro só porque desconectado).

---

## 3. S3 — mapa (editar em seguida; não bloqueia)

- **Segurança:** limpeza de `SA-2/3` quick wins (devTools off remoto; `plugins` só se exigido), elevar limiar de seleção de certificado DN-only (SA-8), rate-limit no `getCredentialForManual` (SA-13), `before-quit` flush da auditoria (SA-14 — ver `isShuttingDown` já entregue como parcial de SA-14), HTTP-only bloqueado nas views remotas com exceção opt-in (SA-15), CSP `style-src` idem, HKDF salt não-vazio/derivação por propósito (SA-10), apagar módulo morto `loading-overlay.ts`/`decryptBackup` não usado ou ligá-los (SA-16).
- **Docs:** `COLOR_SYSTEM.md` documenta um tema azul inexistente — reescrever do `globals.css` real (D-11); CSP real documentada (D-12); DevTools off documentado (D-13); README "TSA opcional" (D-14 corrigido nesta rodada); categorias de portais (D-15 corrigido nesta rodada); e2e de obrigações só pré-release (D-16); testes do Windows store real (D-17).
- **Release:** `electron-updater` carregado por `dynamic import` no bundle CJS — validar em `dist:dir` real ou empacotar; `graphify` órfão removível (SA-11/P-7); `purge-new-builtins-full.ts` destrutivo vs. `%APPDATA%\AurumBit Portal\aurumbit-portal.db` — remover ou mover para manutenção com `--dry-run` (P-8); thresholds de coverage passam a ser gate quando CI rodar (D-6).
- **UI:** `isError` → `QueryErrorState` compartilhado; `error.tsx`/`not-found.tsx`; skip-link; ring de foco ≥3:1; `role="slider"` 2D → `role="application"` ou spinbuttons; `Toaster theme` real; `useSearchParams` no lugar de `useSearchParam`; dead deps (RHF/resolvers/next-themes); `useAudit({entityId})` em vez de filtro no renderer; `knowledge-graph/` morto (endpoint externo hardcoded) fora do bundle.

**Fortalezas que se confirmam em todas as revisões** (não regredir): cofre AES-256-GCM + DPAPI + HKDF + AAD por campo + modos `0600` + zero buffer wipe; isolamento de partições por cliente/certificado com pinning por thumbprint e allowlist `.gov.br`; redaction na fronteira de auditoria; documentação juridicamente honesta sobre o que não existe; ADRs 8/8 coerentes; stress + e2e executados e medidos; **zero S1**.

---

## 4. Go / No-Go para distribuir a 0.1.0 externamente

**No-Go (ainda).** Bloqueadores, em ordem:

1. **Assinar o executável e o instalador** (P-2) — adquirir OV ou Azure Trusted Signing.
2. **Ícone real** em `build/icon.ico` (P-1).
3. **Resolver o canal de update**: servidor real com HTTPS + `latest.yml` assinado, ou remover `publish`/`electron-updater` e o botão "Verificar atualizações" até existir publicação (P-3 / SA-12 / P-6).
4. **Gate de empacotamento no CI** (`dist:dir` + upload de artefato), mais jobs de `test:coverage` (thresholds enforce), `test:stress` nightly e `test:e2e` (P-4 / P-9 / D-6).
5. **Fechar a cadeia documental com o build**: USER_GUIDE (D-1, D-2, D-3, D-4, D-5), PRIVACY inventário completo (D-8), SECURITY/CSP reais (D-12/D-13), COLOR_SYSTEM reescrito (D-11).
6. **Decidir o destino dos dados pessoais** (SA-7): criptografar colunas (`document`, `email`, `phone`, `notes`, `honorarios`) ou documentar formalmente a limitação + exigir BitLocker no onboarding; e **sobe o nível mínimo** do tratamento LGPD no PRIVACY.
7. **SA-1**: mover `node-forge` para ≥1.4.3 (patch) e planejar `zod` ≥4.6.7 (ou confinar o parse crítico em worker com timeout — parcialmente já existe).
8. **SA-2/SA-3**: cortar `script-src 'unsafe-inline'` (nonces/hashes do export) e `devTools`/`plugins` nas superfícies remotas.

**Pode prosseguir agora**: uso interno controlado em estação dedicada com dados sintéticos/reais do próprio escritório, desde que sem PII de terceiros em produção sem as ações de SA-7 e com o README atual (corrigido) acompanhado desta lista.

---

## 5. O que já foi corrigido nesta rodada (a pedido de "avaliação completa")

Documentos/README reconciliados com o código:
- Tabela de portais embutidos → categorias reais (Governo Federal/Estadual/Prefeituras) + os 10 SpeedGov listados + métodos reais (todos certificado+senha com default certificado; SpeedGov senha com "Entrar sozinho").
- "Carimbo RFC 3161 opcional" → Federal **obrigatório (fail-closed)**.
- "TSA configurável em Configurações"/"Testar TSA" removidos das promessas (seção oculta na UI).
- "Envio sempre manual por padrão" → comportamento real (autoSubmit=true nos serviços de senha gerados; desligável por serviço; 2FA/captcha pausam e revelam).
- "497/497" mantido **com base na execução** (`vitest --reporter=json`: 497 passing, 0 failing); a discrepância estática de 452 é artefato de contagem por regex e fica registrada.
- Badge de CI no README mantido (repo é **público** — renderiza).

Note que os laudos registram também o README anterior (com as mesmas divergências); todas as seções citadas foram reescritas desta vez.

## 6. Limitações desta avaliação

- Nenhum item aqui executa o app; revisões somente-leitura exceto QA de stress (que foi executado separadamente com 7/7 E2E e 497/497 unit).
- Severidade atribuída por impacto+pré-condição, priorizando o cenário do app desktop single-user no Windows; distribuição externa muda o peso de P-2/P-3 condicionantes.
- `npm audit` cobriu dependências de produção apenas (`--omit=dev`); licença de deps não auditada.
- O working tree continha mudanças pendentes de features (obrigações/visão mensal, feriados, carimbo premium) avaliadas como contexto, não como defeitos de release.
- `test-results/`, `playwright-report/`, `coverage/` são artefatos gerados (não versionados).

## 7. Próximos passos sugeridos

1. Escolher o caminho de distribuição (interno vs externo) e abrir issues para os bloqueadores §4 em ordem.
2. Reduzir a árvore de produção (`moveAllToDevDependencies`-style) e medir o tamanho do instalador com `npm run dist:dir` (requer ícone, P-1).
3. Endurecer a CSP e `devTools`/`plugins` das superfícies remotas; substituir `pnpm set restrictive-libc`-equivalentes: remover `graphify`, RHF resolvers, `@types/qrcode` para devDeps (P-5/P-7/R-8/SA-11).
4. Fechar a malha de testes na fronteira de segurança (IPC + `sessions/manager.ts` + `windows-store.ts`) e torná-los gates de CI.
5. Atualizar USER_GUIDE/PRIVACY/COLOR_SYSTEM/ADRs para o estado real (com datas de revisão).
6. Manter `npm run test:stress` + `npx playwright test` como portão pré-release; publicar métricas no próximo tag.

## 8. Inventário dos laudos

| Arquivo | Escopo | Veredito |
|---|---|---|
| `docs/qa/EVAL-security-architecture.md` | Main, IPC, cofre, sessões, certificados, redaction, deps | CONCERNS |
| `docs/qa/EVAL-renderer-ui.md` | Next.js 16/React 19, páginas, componentes, a11y, React Query | CONCERNS |
| `docs/qa/EVAL-packaging-ci.md` | package.json, electron-builder.yml, CI, postinstall, lockfile | CONCERNS |
| `docs/qa/EVAL-docs-tests.md` | USER_GUIDE/SECURITY/PRIVACY/TERMS/SUPPORT/ADRs, cobertura | CONCERNS |
| `docs/qa/QA-STRESS-REPORT.md` | Stress + E2E volume (rodada anterior) | APPROVED |
| `docs/qa/QA-STRESS-AGENTIC-FLOW.md` | Metodologia | — |
