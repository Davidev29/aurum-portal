# Avaliação — Build, Empacotamento e CI (AurumBit Portal 0.1.0)

**Data:** 2026-11-12 · **Escopo:** leitura estática de configs, scripts e artefatos (`dist-electron/`, `out/`); nenhum comando de build/empacotamento foi executado.
**Commit base:** `master` com modificações não commitadas no working tree (271 arquivos rastreados; artefatos de build não rastreados).

## Veredito: CONCERNS

Não há bloqueador absoluto nem vazamento de segredo, mas o empacotamento **nunca foi executado** neste workspace e o instalador sai incompleto para um release honesto: ícone ausente, binário não assinado, canal de updates apontando para placeholder e CI sem gate de empacotamento. Todos os problemas listados são corrigíveis antes de 0.1.0 ser distribuída; até lá, tratar a release como não verificada.

Legenda de severidade — **S1**: bloqueador de release / exposição de segurança no artefato final; **S2**: significativo, corrigir antes de distribuir; **S3**: corrigir em seguida; **S4**: nit / polimento.

## Pontos fortes (bullets)

- **Zero segredos vazados**: `git grep` por padrões (`PRIVATE KEY`, `AKIA…`, `ghp_…`, `xox…`, `sk_live_…`) só encontrou um fixture de teste de redaction (`tests/unit/security.test.ts:120`); não existem arquivos `.env*` no disco nem rastreados; URLs em configs são placeholders reservados (`.invalid`, RFC 2606) ou links de sponsor do lockfile.
- **Artefatos gerados não rastreados**: `.gitignore` cobre `out/`, `dist-electron/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`, `*.tsbuildinfo` (`.gitignore:3-20`); `git ls-files` e `git ls-tree -r HEAD` não contêm nenhum desses caminhos — working tree limpo nesse aspecto.
- **Higiene de repo madura**: `.gitattributes` normaliza LF e marca binários (`*.ico`, `*.pfx`, `*.node`…); `.prettierignore` e `eslint.config.mjs` ignoram todos os diretórios de build; `eslint.config.mjs` roda `js.recommended` + `tseslint.recommended` + `react-hooks`; Prettier verificado no CI.
- **Coerência de versão e produto**: `package.json:3` (0.1.0) == badge do README (linha 13) == versão do instalador (via `package.json` no electron-builder); a tela Sobre usa `app.getVersion()` via IPC (`electron/main/index.ts:202`, `electron/main/ipc/index.ts:1168`) — sem versão hardcoded no renderer. `engines.node >=22` (`package.json:116-118`) == `node-version: 22` no CI (`ci.yml:31`).
- **Configuração de empacotamento majoritariamente coerente**: NSIS per-user sem admin (`oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `electron-builder.yml:36-38`), consistente com o README; `npmRebuild: false` + `asarUnpack` só de `better-sqlite3` e `resources` (linhas 19-22) compatível com N-API prebuilds — e `scripts/postinstall.mjs` verifica exatamente o prebuild declarado (`node_modules/better-sqlite3/prebuilds/win32-x64.node`, conferido no disco); `deleteAppDataOnUninstall: false` protege os dados do cofre no uninstall.
- **CI enxuto e barato bem feito**: `permissions: contents: read`, `concurrency` com `cancel-in-progress`, `timeout-minutes: 25`, `npm ci`, cache do binário Electron chaveado no lockfile, typecheck cobrindo os dois tsconfigs (`ci.yml:9-59`, `package.json:20`); outputs de build (`out/`, `dist-electron/`) estão frescos (2026-11-12 19:33) comprovando que `npm run build` roda.
- **Honestidade documental incomum**: README documenta a ausência do ícone (linha 149), o placeholder de updates (linha 149, 357), e os scripts de spike são não invasivos por especificação (`scripts/spike/run-spike.ts:4-15`), com `.certs/` gitignored (linha 21 do `.gitignore`) e PFX de teste fora do pacote (`files` não inclui `scripts/`).

## Achados

### S2 — corrigir antes de distribuir

**P-1 — S2 — `electron-builder.yml:32` (e `:6`)** — Ícone do aplicativo inexistente. `win.icon: build/icon.ico` e `directories.buildResources: build`, mas o diretório `build/` não existe no repositório (verificado: `Test-Path build` → False; nenhum `.ico` em lugar algum fora de `node_modules`). O electron-builder não falha nesse caso: `platformPackager.js#getOrConvertIcon` cai para `getDefaultIcon`, que para Windows retorna `null` (`ElectronFramework.js` — "default icon is embedded into app skeleton"), gerando executável e instalador com o **ícone padrão do Electron** e warning no log. A própria documentação do README (linha 149, "o empacotamento pode falhar") está imprecisa — não falha, apenas sai não-branded.
*Impacto:* instalador e `AurumBit Portal.exe` indistinguíveis de um app Electron qualquer; erosão de confiança e linha vermelha para distribuição honesta (o usuário não consegue autenticar visualmente o que instalou).
*Recomendado:* gerar `build/icon.ico` (≥ 256×256, formato multi-resolução) e, idealmente, `build/icon.png` (512×512); ou remover `win.icon`/`buildResources` ciente do default — não recomendado. Validar com `npm run dist:dir`.

**P-2 — S2 — `electron-builder.yml:34` (e `ci.yml:55-59`)** — Nenhuma assinatura de código em lugar nenhum. `signAndEditExecutable: true` apenas edita metadados/ícone do EXE (via rcedit); não há `certificateFile`, `signtoolOptions`, `azureSignOptions`, nem passo de assinatura no CI. Resultado garantido: `AurumBit Portal-Setup-0.1.0-x64.exe` e o `.exe` principal **não assinados** → SmartScreen "O Windows protegeu o seu PC" em 100% das instalações novas, reputação inexistente, e NSIS unsigned é alvo clássico de heurísticas de antivírus (dropper-like).
*Impacto:* primeira instalação sempre com alerta de segurança; em ambiente corporativo/gov, o instalador será bloqueado por política. Não há como "avisar no README" um bloco visual desse tipo — a experiência contradiz toda a postura security-first do produto (cofre de certificados A1).
*Recomendado:* certificado OV (mínimo) ou Azure Trusted Signing (elimina necessidade de HSM físico); configurar `signtoolOptions`/`azureSignOptions` no electron-builder e secrets no CI; até lá, documentar explicitamente a limitação e não distribuir para terceiros.

**P-3 — S2 — `electron-builder.yml:44-47` (e `electron/main/ipc/index.ts:1215-1228`)** — Canal de updates é placeholder que não pode funcionar. `publish: generic, url: https://updates.aurumbit.invalid/stable` — domínio `.invalid` (RFC 2606) resolvido para lugar nenhum. O app empacotado gera `app-update.yml` com essa URL; toda verificação de atualização falhará com erro de rede (fail-closed, mas permanentemente quebrada), e o README admite que o servidor não existe (linhas 149, 357). Distribuir assim significa publicar um binário que se anuncia atualizável e nunca se atualiza — exatamente a assimetria que um release honesto evita.
*Impacto:* usuários ficam presos na 0.1.0 sem caminho de update; falso senso de mecanismo de atualização; suporte recebe falsos "bugs de update".
*Recomendado:* ou configurar um servidor genérico real (HTTPS + `latest.yml` + assinatura do artefato) antes de 0.1.0, ou remover o bloco `publish` e tratar updates como desabilitados nesta versão (fluxo já fail-closed em `ipc/index.ts:1201-1212` para `!app.isPackaged`); nunca shippar com `.invalid`. Substituir `.invalid` apenas como parte da entrega de infra.

**P-4 — S2 — `ci.yml:17-59` (e `package.json:34-35`)** — CI valida código mas nunca valida o artefato de release. O job termina em `npm run build` (linha 59); não há passo `npm run dist:dir` (ou `electron-builder --win dir`), não há upload de artefato, não há e2e nem stress. Consequência observada: `dist/` **não existe** neste workspace — `npm run dist` nunca foi executado, então a pipeline de empacotamento é não verificada: erros de `files`, `asarUnpack`, ícone ou `electron-builder.yml` só apareceriam no dia do release.
*Impacto:* release às cegas; descoberta tardia de empacotamento quebrado; regressões de empacotamento sem detecção em PR.
*Recomendado:* job `package` (windows-latest) rodando `npm run dist:dir` + upload de `dist/**` como artefato; manter sem assinatura até P-2 ser resolvida; idealmente `npm run test:e2e` no mesmo job ou em nightly.

**P-5 — S2 — `package.json:38-83` (e `electron-builder.yml:11`)** — Dependências de produção infladas; o empacotador as incluirá todas. electron-builder seleciona apenas `dependencies`/`optionalDependencies` (traversal automático, ignora devDeps) — mas praticamente tudo está em `dependencies`, incluindo o que o pacote nunca carrega em runtime (o main é bundle do tsup com `external: ['electron','better-sqlite3']`, `tsup.config.ts:23,41`, e o renderer é export estático em `out/`): `next` 183,5 MB, `pdfjs-dist` 35,9 MB, `lucide-react` 27,3 MB, `pdf-lib` 18,6 MB, `bwip-js` 12,3 MB, `drizzle-orm` 10 MB, `react(-dom)` 7,9 MB… medição no disco: **~360 MB** em deps de produção de nível superior; o runtime real precisa de `better-sqlite3` (26 MB, já unpacked) — e talvez `electron-updater` (ver P-6). Instalador resultante será várias vezes maior que o necessário (Electron x64 base ≈ 110 MB).
*Impacto:* instalador/download enormes, instalação lenta, maior superfície para varredura de AV, e exceções manuais de empacotamento permanentemente necessárias.
*Recomendado:* mover para `devDependencies` tudo que é build-time (`next`, `react`, `react-dom`, todo `@radix-ui/*`, `pdf-lib`, `pdfjs-dist`, `bwip-js`, `qrcode`, `lucide-react`, `drizzle-orm`, `zod`, `@tanstack/react-query`, `node-forge`, `pkijs`, `asn1js`, `hash-wasm`, `electron-log`, etc.); deixar `dependencies` = `better-sqlite3` (+ `electron-updater` se mantido externo). Repetir `npm run dist:dir` e conferir o tamanho do instalador.

### S3 — corrigir em seguida

**P-6 — S3 — `electron/main/ipc/index.ts:1215` (evidência: `dist-electron/main.cjs:11399`)** — `import("electron-updater")` sobrevive como *dynamic import bare specifier* no bundle CJS: não está em `external` do tsup (`tsup.config.ts:23,41`), não está em `asarUnpack` (`electron-builder.yml:20-22` — só better-sqlite3 e resources) nem foi inlined como gadget bundled. Ou seja, em runtime quem resolve "electron-updater" é o resolvedor ESM do Node apontando para um caminho dentro de `app.asar` — comportamento não verificado para essa combinação (CJS-em-CJS, import() de pacote CJS-puro do electron-builder, asar). O fluxo já é fail-closed (retorna `status: 'error'`), mas o botão "Verificar atualizações" provavelmente nunca funciona no app empacotado, mesmo com servidor real.
*Impacto:* falha silenciosa do único caminho de update; diagnóstico equivocado de infra de updates.
*Recomendado:* adicionar `electron-updater` a `external` no tsup (`require` via loader CJS, que entende asar) ou empacotá-lo de fato; validar "Verificar atualizações" num `dist:dir` real antes de declarar o canal de updates funcional.

**P-7 — S3 — `package.json:66`** — `graphify@^1.0.0` em `dependencies`: pacote de terceiros sem relação com o domínio ("RGG Random Graph Generator", `node_modules/graphify/package.json`), **nunca importado** em `electron/`, `src/`, `shared/`, `scripts/` ou `tests/` (grep por `graphify` só acha o próprio package.json). Num aplicativo de cofre de certificados digitais, dependência órfã de autoria obscura na árvore de produção é ruído de supply chain que vai parar no asar.
*Impacto:* superfície e auditoria desnecessárias; política de dependências enfraquecida.
*Recomendado:* remover (`npm pkg delete dependencies.graphify` + lockfile); adicionar `npm audit`/allowlist de licenças ao CI.

**P-8 — S3 — `scripts/spike/purge-new-builtins-full.ts:2,16-31`** — Script destrutivo commitado ao lado de diagnósticos "não invasivos". O arquivo faz `new Database(%APPDATA%\aurumbit-portal\aurumbit-portal.db)` (o caminho case-insensitive **é** `%APPDATA%\AurumBit Portal\aurumbit-portal.db` — o banco real do usuário) e executa `DELETE FROM audit_events …` e `DELETE FROM sessions …` sem flag de dry-run, sem backup, sem confirmação, sem transação explícita. Rastreado no git, não é script do `package.json` (invocação manual via `tsx`), não é empacotado — mas apaga **trilha de auditoria** (LGPD/compliance) por engano de quem roda "porque está na pasta de spike".
*Impacto:* destruição acidental do banco/auditoria de produção; contradiz a postura do `run-spike.ts`.
*Recomendado:* remover o arquivo (o purge já ocorreu) ou movê-lo para `scripts/maintenance/` com `--dry-run` default, backup obrigatório (`.bak` com timestamp), `--confirm` explícito e log de o que foi deletado; adicionar nota no README.

**P-9 — S3 — `ci.yml:55-56` (e `vitest.config.ts:31-36`, `package.json:25,28`)** — Quality gates definidos e nunca exercidos no CI. `npm test` roda unitários, mas (a) `test:coverage` — com thresholds 80/80/75/80 — não roda no CI, logo os thresholds são decorativos; (b) `test:stress` não roda no CI nem em nightly; (c) `test:e2e` (que compila o app e abre o Electron) não roda; (d) `playwright.config.ts`/browsers não são instalados no CI. Um PR que quebre isolamento de sessão ou geometria do carimbo passaria verde.
*Impacto:* regressões em comportamentos de segurança só descobertas manualmente.
*Recomendado:* job ou steps em `ci.yml`: `npm run test:coverage` (enforce thresholds), suite stress em schedule nightly, e2e em job separado com cache de browsers do Playwright.

**P-10 — S3 — `electron-builder.yml:11-17`** — `files` inclui `node_modules/**/*` com exclusões manuais por nome de pacote (`!node_modules/vitest/**` etc.) por cima do coletor automático de production deps. Como devDeps já são excluídos automaticamente pelo electron-builder, essas exclusões são inertes para devDeps e convivem com a dependência real de que a árvore de `dependencies` esteja correta (P-5) — ou seja, a configuração mistura dois mecanismos e dá falsa sensação de curadoria. Manter as exclusões também mascara futuros vazamentos (ex.: `electron-updater` não empacotado junto quando externo, P-6).
*Impacto:* configuração confusa; deriva silenciosa do conteúdo do asar.
*Recomendado:* confiar no coletor de production deps e usar `files` só para `dist-electron/`, `out/`, `package.json` (+ exceções conscientes); remover o bloco de exclusões ou comentá-lo explicando o mecanismo real.

**P-11 — S3 — `scripts/postinstall.mjs:9-14`** — Verificação de binário nativo é correta no alvo (win32-x64 confirmado no disco) mas (a) ignora win32-arm64/outras plataformas (falsos avisos), (b) é *warning-only*: instalação com binário quebrado termina com exit 0 — o primeiro sintoma será o app não abrir; (c) usa path relativo ao cwd. Adequado para "ajuda de diagnóstico", inadequado como gate.
*Impacto:* falhas nativas detectadas tarde; suporte reativo.
*Recomendado:* checar também o prebuild carregável de fato (ex.: `require('better-sqlite3')` opcional com catch) ou ao menos cobrir win32-arm64 com aviso correspondente; manter exit 0 por design, mas sugerir `npm run spike -- --check-only` no aviso.

### S4 — nit / polimento

**P-12 — S4 — `package.json:56`** — `@types/qrcode` (tipos TypeScript) está em `dependencies`; pertence a `devDependencies`. Tipos não têm papel em runtime e incham a árvore de produção (e asar) à toa.
*Recomendado:* mover para `devDependencies` junto com P-5.

**P-13 — S4 — `electron-builder.yml:33`** — `artifactName: ${productName}-${version}-${arch}.${ext}` com `productName` contendo espaço gera `AurumBit Portal-0.1.0-x64.exe` e `.blockmap`/`latest.yml` com espaços; quebra convenções de CLI/URLs e o consumo automatizado de artefatos (curl, scripts de release, buckets).
*Recomendado:* `artifactName: ${name}-${version}-${arch}.${ext}` (→ `aurumbit-portal-0.1.0-x64.exe`) ou hífens explícitos.

**P-14 — S4 — `electron-builder.yml:20-27` (uso em `electron/main/pdf/stamp-logo.ts:35`)** — `resources/` está duplamente previsto: `asarUnpack: resources/**/*` (vai para `app.asar.unpacked`) **e** `extraResources` (vai para `<install>/resources`). Hoje `resources/` contém só um `README.txt` de 42 bytes (o selo ITI usado no carimbo é servido de `out/`/`public/`), logo a duplicação é redundância de configuração, não de conteúdo — mas indica indefinição de onde mora o material externo do app.
*Recomendado:* escolher um dos dois mecanismos (preferir `extraResources` para assets externos com `process.resourcesPath`) e remover o outro.

**P-15 — S4 — `package.json:6-9`** — Metadados de publicação provisórios: `author.email: suporte@aurumbit.local` (domínio não roteável), sem `license` (esperado p/ privado, README declara "uso restrito" — ok), sem `repository`/`homepage`/`bugs`. O badge de CI do README (`README.md:12`) aponta para `github.com/Davidev29/aurum-portal` — handle pessoal do autor num produto privado; se o repo é privado, o badge nunca renderiza; se não é, confirmar que é intencional.
*Recomendado:* email real de suporte, remover ou corrigir badge, adicionar `license: "UNLICENSED"` e metadados mínimos.

**P-16 — S4 — `tsup.config.ts:19,38` (e `:20`)** — `sourcemap: true` nas duas configs ⇒ `dist-electron/*.cjs.map` com source embutido ou referências de path do repositório são empacotadas no asar; `clean: true` só na primeira config (a segunda preserva — correto, mas frágil se a ordem mudar). Sourcemaps no artefato facilitam engenharia reversa do renderer empacotado/assinante; menor, porém real, para um app que protege segredos.
*Recomendado:* `sourcemap: false` para a build de release (ou `sourcemap: 'hidden'`), manter mapas só em dev.

**P-17 — S4 — `electron-builder.yml:42`** — `deleteAppDataOnUninstall: false` preserva `vault.key` e dados no uninstall (excelente para não perder o cofre, péssimo para "instalação limpa" exigida por suporte). Essa decisão não está documentada em README/SUPPORT — o assistente de uninstall não pergunta nada e o usuário perde a noção do que ficou para trás (`%APPDATA%\AurumBit Portal`).
*Recomendado:* documentar em SUPPORT/README ("dados permanecem após desinstalar; para apagar, remova a pasta") ou oferecer `nsis.include` com checkbox de "remover dados".

## Limitações da avaliação

- **Read-only**: `npm run dist`, `npm run build`, `npm test` e `test:e2e` **não foram executados** nesta revisão; a coerência do empacotamento foi julgada estaticamente (configs + fontes do `app-builder-lib` + artefatos já existentes). `dist/` não existe — o instalador nunca foi produzido neste workspace.
- Comportamento de fallback de ícone foi confirmado lendo o código do `app-builder-lib@26.x` (`getOrConvertIcon` → `resolveIcon` → `framework.getDefaultIcon` retornando `null` no Windows), não por build real; tamanho do instalador é estimativa a partir dos bytes no disco, não medição de artefato.
- A resolução de `import("electron-updater")` dentro de `app.asar` (P-6) não foi testada empiricamente — a recomendação é validação em `dist:dir` real.
- Varredura de segredos limitada a `git grep` com padrões conhecidos e ausência de `.env*`; não houve análise de entropia nem varredura do histórico git completo (a baseline do repo e o estado atual do branch são o escopo).
- Coerência versão/licença baseada em leitura estática; não se verificou runtime (diálogos, Sobre) nem se o certificado de assinatura será emitido pela organização — P-2 assume o processo de emissão como inexistente hoje.
- Comportamento de antivírus/SmartScreen e do canal genérico de updates está fora de verificação sem infra de release real; tratar P-2/P-3 como riscos demonstrados por configuração, não por telemetria.
- `scripts/spike/purge-new-builtins-full.ts` foi apenas lido (não executado); sua natureza destrutiva foi inferida do SQL estático e do caminho alvo case-insensitive.
