# Auditoria de Ponta a Ponta — AurumBit Portal (pré-produção)

**Data:** 2026-11-15 · **Base:** working tree pós-auditoria · **Escopo:** remoção dos portais de prefeitura, fluxo de certificados A1, auditoria em 4 trilhas (processo principal, renderer, dados/cofre, build/CI), correções aplicadas.

> **Veredito:** o app está substancialmente mais próximo de um instalador interno estável.
> Gates verdes: typecheck, lint (0 erros), **618/618** unitários, **15/15** stress, build + `electron-builder --dir` (`app.asar` 541 MB → **~50 MB**), format:check.
> Risco residual e decisões de produto estão na seção 9 e devem ser lidos antes de distribuir.

---

## 1. O que foi feito (resumo executivo)

1. **Portais de prefeitura (SpeedGov) removidos** do código (`shared/builtins.ts`, `shared/constants.ts`, `electron/main/db/seed.ts`) e **do seu banco local** (migração v9): os 10 portais (Tianguá, Juazeiro do Norte, Tauá, Itarema, Pindoretama, Limoeiro do Norte, Sobral, Crateús, Icapuí, Paracuru), suas receitas e a credencial "ISS JUAZEIRO DO NORTE" e as 6 sessões históricas dessa credencial. **A ISS Fortaleza (serviço personalizado) não foi tocada.** README e guia do usuário atualizados (12 embutidos; prefeituras via "Novo site").
2. **Auditoria rigorosa em 4 frentes** com 4 revisores independentes (processo principal, renderer, dados/cofre/PDF, build/CI) + mergulho direto no fluxo de certificados. **30+ achados corrigidos** — todos os P1 (4), a maioria dos P2.
3. **Fluxo de certificados com visibilidade garantida** nas 3 telas que você indicou (Abrir sessão, Clientes, Assinaturas) — ver seção 3.
4. **Migrações v9/v10/v11** aplicadas ao banco vivo; integrity e FK checks OK.
5. **Produção:** asar enxugado, ícone gerado, publish placeholder removido, CI com job de empacotamento, zod 3→4, vitest 3→5, npm audit de 26 → 16 (todas de dev), postinstall que falha de verdade, DevTools remoto desativado.
6. **PAdES-B-T fail-closed**: sem TSA válida a assinatura é **cancelada** (os documentos prometiam isso; o código fazia o oposto). TSA agora é exigida por HTTPS, e o token é **verificado** (messageImprint SHA-256 + nonce RFC 3161) antes de anexar.

---

## 2. Banco de dados local (migrações)

Aplicadas ao `%APPDATA%\aurumbit-portal\aurumbit-portal.db` pelo caminho normal de boot (`createDatabase`, transacional):

| v | Nome | Efeito |
| --- | --- | --- |
| 9 | `remove_speedgov_builtin_services` | Apaga os 10 serviços SpeedGov + receitas (CASCADE) + credencial Juazeiro + 6 sessões (RESTRICT → delete explícito). Idempotente. |
| 10 | `remove_robot_knowledge_graph_tables` | `DROP TABLE kg_edges, kg_nodes` (feature removida a seu pedido; 25 linhas de `kg_nodes` apagadas). |
| 11 | `notifications_dedupe_unique` | Deduplica avisos (mantém o mais antigo) + `UNIQUE INDEX … WHERE obligation_id IS NOT NULL`. Agendador não gera mais duplicados; `insertNotificationIfAbsent` agora tolera corrida (`onConflictDoNothing`). |

**Integridade pós-migração:** `PRAGMA integrity_check` = ok; `foreign_key_check` = 0 violações; `services` 25→15; `recipes` 25→15; `credentials` 3→2; `sessions` 27→21; Fortaleza (`cdff…`, `is_builtin=0`) intocada; `schema_migrations` 1…11 (v8 `robot_knowledge_graph` legada mantida como registro histórico).

**Cofre:** novo marcador de integridade (`settings.vault.integrity`, selado com a master key) será criado no primeiro boot — comprovado que a `vault.key` atual (11/11 18:04) abre as 2 credenciais seladas (criadas depois dela). Sem esse marcador, perda da chave regenerava silenciosamente todos os segredos para lixo; agora o boot **falha fechado com orientação** (restaurar backup) em vez disso.

**Nota de arquitetura:** `schema_migrations` registrava v8 (`robot_knowledge_graph`) de uma migração que foi removida do código — suas tabelas `kg_*` ficaram órfãs até a v10. As migrações agora são aplicadas com `ORDER BY version` (defensivo).

**Base legada `portal-vault.db`** (`%APPDATA%\portal-vault\`): **não foi migrada nem apagada.** O código procura por `Portal Vault` (com espaço) mas o diretório real é `portal-vault` (hífen) — a migração automática nunca casou. Decisão sua: apagar quando não precisar; nada do app atual depende dela (63 clientes lá são de antes da renomeação).

---

## 3. Fluxo de certificados A1 — o que está garantido

### 3.1 O que já era (e se manteve) sólido

- Importação PFX/Windows com validação de senha, validade, titular, thumbprint; vínculo com consentimento; herança de vínculos na renovação (consentidos, sem recriar); instalação/remoção no `Cert:\CurrentUser\My`.
- Seleção mTLS no handshake (`select-client-certificate`): allowlist por serviço + gov.br SSO, certificado exato por thumbprint/DER/serial, tudo auditado (`certificate.selected`, `.not_offered`, `.cancelled`).
- Lote de assinatura com fila, nunca-sobrescrever, carimbo ITI, verificação pós-assinatura, PFX em worker isolado com wipe de buffers.
- Launch dialog: elegibilidade correta (vencidos/ausentes/cadeia incompleta fora), seletor de cliente/credencial, estados vazios explicados, retry visível. O processo main instala o A1 no Windows sob demanda ao abrir a sessão (`CERTIFICATE_NOT_INSTALLED` com mensagem clara se falhar).

### 3.2 O que mudou nesta revisão

**Visibilidade (as 3 telas que você indicou):**

| Tela | Mudança |
| --- | --- |
| **Abrir sessão** (`launch-dialog.tsx`) | Badge de validade urgente no cartão (`A vencer 12d` vermelho ≤7d / amarelo >7d; `Vence hoje`); nota "Este certificado está no cofre — ele será instalado no Windows ao abrir a sessão" quando `!installed`. |
| **Clientes — LISTA** (`clients/page.tsx`) | **Nova coluna “Certificado”** com o pior caso por cliente (`A vencer Nd`, `A1 ok`, `Cadeia incompleta`, `Ausente no Windows`, `A1 vencido`; `—` quando nenhum). Uma consulta extra, agrupada no renderer (padrão das outras telas). |
| **Clientes — Detalhe** | Já era completo (validade, instalação, renovação, histórico, desvinculação) — inalterado. |
| **Assinaturas** (`assinaturas/page.tsx`) | Botão **“Ver não elegíveis (N)”** com o motivo de cada um (Vencido / Sem PFX e fora do Windows / data); linha “Selecionado:” com **“vence em Nd”** em vermelho ≤7d; botões de cancelar limpam a frase-senha. |
| **Certificados** | Seus stat cards clicáveis preservados; adicionado tratamento de erro de carga (antes falha virava “estado vazio” silencioso) e try/catch no refreshAll. |

**Segurança (P1/P2) neste fluxo:**

1. **Seleção mTLS não aceita mais DN-only** (score 50 → mínimo 70: fingerprint/DER (85–100) ou serial+issuer (70)). Um certificado renovado com outra chave não passa mais como “o mesmo”.
2. **Injeção de A1 restrita** a hosts SSO gov.br (`sso|certificado.sso|contas.acesso.gov.br`, `acesso.gov.br`, `login.gov.br`) **+ allowlist do serviço** — antes, qualquer `.gov.br` (inclusive um portal comprometido) recebia o handshake mTLS. Landings gov.br deixam de injetar (nunca desafiavam mesmo). Testes de caos atualizados p/ esse contrato.
3. **Erros vindos da página são redactados** antes de virar `lastError`/auditoria/toast: substituições literais do usuário/senha/campos extras por `[REDACTED]` (uma página que ecoasse a senha não a espalha mais pelo log).
4. **Falhas do agente inteligente agora aparecem na auditoria** (`session.recipe_failed` com `agentic: true`) — antes, quando a receita gravada falhava via agente, nada era registrado; e a falha de gravação/agente não derruba mais o status preso.
5. **`drain-stuck`**: a condição nunca era verdadeira e o app fazia broadcast IPC a cada 250 ms para sempre; agora usa flag `drainStuck` com transição única e estado restaurável quando a página volta a responder.
6. **Clipboard**: senha/valores revelados **não** são mais escritos via `navigator.clipboard` sem limpeza. Novo IPC `credentials:copyPlain` — cópia no processo principal com limpeza automática (respeita `clipboardClearSeconds`) + auditoria. Toasts voltaram a ser verdadeiros.

### 3.3 O que falta no fluxo (decisões de produto, seção 9)

- `chain_incomplete` existe no modelo mas a cadeia ICP-Brasil não é verificada ativamente (a validação efetiva é no handshake — comportamento documentado).
- Sem certificado de código no instalador: o A1 funciona igual; o que muda é o SmartScreen/confiança do Windows no *instalador*.

---

## 4. Achados por severidade — status

### P1 (4) — corrigidos

| # | Achado | Correção |
| --- | --- | --- |
| 1 | `closeAll()` (quit/lock) descartava sessões com gravação ativa mas **deixava a janela órfã viva** (veto do diálogo ignorado; `view.webContents.close()` pulado quando `quitting`) e congelava o main process (`showMessageBoxSync`) | `win.destroy()` real, view sempre fechada, `IPC.app.lock` **recusa** com `CONFLICT` se houver gravação ativa (antes-de-quit já confirma; per-window dialog removido no caminho de quit) |
| 2 | `SafeStorageKeyStore.loadOrCreate()` criava master key nova silenciosamente se `vault.key` sumisse → todo `pfx_enc`/`password_enc` vira lixo sem aviso | Novo `vault/integrity.ts`: marcador selado em `settings`; boot **fail-closed** com orientação de restore; migração automática para bases existentes (probe contra um segredo real) |
| 3 | Renderer escrevia senha no clipboard **sem limpeza** e os toasts mentiam (“limpeza automática em 30s”) | IPC `copyPlain` (main-process, auto-clear + audit) nos 2 pontos |
| 4 | Filtro **“De” da auditoria** sempre inválido (`input[type=date]` → `z.string().datetime()` recusava) → lista vazia silenciosa; exports CSV/PDF/JSON quebravam | Conversão local→ISO correta (meia-noite/23:59:59 local); estado de erro da query visível com retry |

### P2 (21) — corrigidos

1. **mTLS**: DN-only não seleciona mais (≥70). 2. **Injeção .gov.br** blanket → SSO hosts + allowlist. 3. **PAdES fail-open**: agora **fail-closed** — sem TSA válida a assinatura é cancelada; TSA só por HTTPS; token verificado (messageImprint + nonce + ContentInfo). 4. **holderName** (PII ICP-Brasil) fora da auditoria. 5. **Logger uncaught** sem redaction (stack 4.000 chars vazavam p/ log). 6. **`exportBackup` truncava** arquivo existente — agora `wx` + sufixo “(2)”, PFX zerado, auditoria mantida. 7. **Herança de renovação** fora de transação → dentro de `db.transaction` (PFX e Windows). 8. **`deleteObligation`** 2 deletes sem tx → transação. 9. **`duplicateService`** serviço+receita → transação + log de falha de receita (antes engolida sem rastro). 10. **DevTools ativo** em conteúdo remoto (portais .gov.br + gravação) no empacotado → `devTools: !app.isPackaged` + Ctrl+Shift+I/J/C bloqueados. 11. **asar ~541 MB** → **~50 MB** (deps reorganizadas; 14 deps de produção; `@napi-rs/canvas`, `sharp`, `next` etc. para dev; `graphify` removido por não ter referências). 12. **CI não empacotava** → novo job `package` (`electron-builder --dir` + `verify-release` + upload-artifact); stress passa a ser gate. 13. **publish placeholder** (`updates.aurumbit.invalid`) removido do builder; canal/auto-check mortos removidos da UI e dos settings. 14. **Ícone**: `build/icon.ico` ausente → gerado (256/48/32/16) de `public/Logomarca da empresa.png`; `scripts/build-icon.mjs` reproduzível. 15. **PFX em `%TEMP%` + senha em base64 no `.ps1`** → caminho/senha por **variáveis de ambiente efêmeras** do processo filho; script não contém segredo; diretório transitório continua removido. 16. **`pdf.reveal`** aceitava path arbitrário → só revela PDFs assinados nesta execução (registry em memória; senão `NOT_FOUND`). 17. **seed** (heal de receitas) engolia erros sem log → `logger.warn`. 18. **`deleteService`** mascarava qualquer erro como “possui histórico” → só mapeia `FOREIGN KEY/CONSTRAINT` p/ CONFLICT; resto sobe. 19. **redação**: `SENSITIVE_KEY` ancorada em `$` deixava passar `password_enc`/`pfx_enc`/`token_abc` → substring; `cpf|cnpj|email|doc` adicionados à query redaction; PEM embutido no meio de texto também redactado. 20. **CPF/CNPJ** no progresso/auditoria de Brasil API: `maskDocumentDigits` agora delega a `maskDocument` (nunca vaza a raiz); documento completo não vai mais ao progresso nem a logs. 21. **`reportSavePdfSchema`** apertado (≤ ~5 MB binário).

### P3 — corrigidos nesta rodada

- **Parênteses/pegadinhas de build**: `serviceUpdateSchema.partial()`/`clientUpdateSchema` (zod 4 proíbe `.partial()` em schema com checks; base separada); `z.record(k,v)` em zod 4; `.innerType()` removido; `update(service)` field `autoUpdateChannel` morto eliminado; migration ordering `ORDER BY version`.
- **OTP** (`recorder.ts`): regex não confunde mais “Código da empresa”/“token corporativo” com OTP (exige contexto de acesso/verificação/SMS).
- **`interruptedRecordingIds()`** varria a auditoria inteira em memória → filtra só `recipe.record_*`.
- **notificações deduplicáveis**: índice **único** parcial + `onConflictDoNothing` (v11).
- **IPs privados literais** em `recipes.test` (oráculo de rede p/ LAN/loopback) — recusa com mensagem clara.
- **Avisos lidos/não lidos** e **focus** do `notification-center` (foco entra no painel, Esc/close devolve ao gatilho).
- **PDF release** ao desmontar Assinaturas (token liberado; não espera TTL).
- **Toast honesto** no form de credencial/sessão manual (“limpeza automática da área de transferência”) — agora é verdade via IPC.
- **Erros de carga visíveis** em vez de “vazio”: Clientes, Certificados, Sessões, Auditoria, Detalhe do cliente (Alert + “Tentar novamente”).
- **Deep-link `?serviceId=`** não reabre o diálogo sozinho após refetch (consome-e-limpa o param).
- **Rascunho de Configurações** não é mais sobrescrito por refetch do tema (merge preserva campos editados pelo usuário; reflete mudanças externas só nas chaves intocadas).
- **Export CSV/PDF/JSON da Auditoria** com filtro de data funcionando (mesma correção local→ISO).
- **Serviço nativo `Juazeiro`** (legado de baseUrl errado) corrigido; mapa `LEGACY_BUILTIN_BASE_URLS` removido.
- **CI**: actions já fixadas; adicionado `test:stress` obrigatório; `verify-release` (N4, sem "autopilot" no bundle) agora roda no job de empacotamento.
- **postinstall** agora **falha a instalação** se o prebuild better-sqlite3 não carregar.

### P3 — conhecidos, NÃO corrigidos (ver seção 9)

HKDF subkeys · `getCertificateView` N+1 · `icp-chain.ts` morto · CSP `unsafe-inline` · retenção de auditoria · `sealBackup` sem chamadores · AAD fixo de backup · reuseKey race · janela `registry.set`→`createSessionRow` · clipboard-read-clear apagaria cópia idêntica · `idInputSchema` frouxo na borda · ByteRange scan falso-positivo no `verify.ts` · partições persistem cookies p/ sempre · idleLockMinutes/retainAuditDays sem efeito · `chain_incomplete` não calculado · installer não assinado · docs históricas (robot-wizard/QA) divergem do código.

---

## 5. Empacotamento / produção (o que muda para o instalador)

- **`app.asar`: ~541 MB → ~50 MB.** Dependências reorganizadas: 14 em `dependencies` (só o que o processo principal carrega), 56 em `devDependencies`. Removidos por zero referências: `graphify`, `react-hook-form`, `@hookform/resolvers`, `next-themes`.
- **electron-builder.yml**: sem `publish` placeholder; `files` exclui `.env*`, `*.pfx`, `*.p12`, `*.pvbackup`, `*.pem`, `*.key`, `scripts/`, `tests/`, `docs/`; `artifactName` = `aurumbit-portal-<versão>-x64-setup.exe`; `resources/` placeholder removido; better-sqlite3 segue unpacked.
- **Ícone** `build/icon.ico` gerado e verificado (cabeçalho/entradas/PNG 256 válidos).
- **DevTools** desligado no empacotamento para conteúdo remoto + gravação; F12/Ctrl+Shift+I/J/C bloqueados; janela principal continua `devTools: isDev`.
- **postinstall**: verifica binário carregando de fato (`new Database(':memory:').exec('SELECT 1')`), falha a instalação se quebrado; não-Windows só adia.
- **CI** (`.github/workflows/ci.yml`): `validate` (typecheck, lint, format, 618 unit + **15 stress**, build) → `package` (`npm run build` → `electron-builder --dir` → `verify-release` → upload do `win-unpacked` como artefato).
- **`npm audit`**: 26 → **16 moderate**, todas dev-time transitivas (esbuild/glob/minimatch/@electron/universal/typescript-estree). `zod` 3→**4.6.7** (advisory de DoS, exploit exige renderer comprometido + coleções enormes — ainda assim migrado), `vitest` 3→**5.1.0** + `@vitest/coverage-v8` idem; `node-forge` 1.4.2→**1.4.3** (Ed25519/ReDoS/TLS); `concurrently` 9.2.1→**9.2.5** (shell-quote crítico). 618 testes + 15 stress verdes na nova stack (uma falha intermitente observada 1x em ~6 execuções — ver seção 8).

---

## 6. Verificação (o que foi de fato executado)

| Gate | Resultado |
| --- | --- |
| `npm run typecheck` (2 tsconfig) | ✅ limpo |
| `npm run lint` | ✅ **0 erros** (99 warnings `any` pré-existentes em testes) |
| `npm test` (unit) | ✅ **618/618** (50 arquivos) |
| `npm run test:stress` | ✅ **15/15** |
| `npm run format:check` | ✅ |
| `npm run build` (next export + tsup) | ✅ |
| `npx electron-builder --dir` | ✅ `dist/win-unpacked` gerado; asar ~50 MB; better-sqlite3 unpacked; **instalador NÃO assinado** (sem certificado — decisão sua) |
| `npm audit` | ✅ 16 moderate (dev-only); 0 high/critical |
| Vault em disco (pós-migrações) | ✅ integrity_check ok; FK 0; marcador de integridade **aplicado** (chave confere com segredos) |
| `npm run test:e2e` | ⏭️ não executado — abrir o app para validação visual foi combinado |

**Executado 1× com falha intermitente** (depois verde em 5 execuções): uma rodada sob vitest 5 com 2/618 falhando por timeout (carga da máquina). Ajustados timeouts dos testes sensíveis (argon2id, TSA). Se aparecer de novo no CI, rodar com `isolate: false`.

---

## 7. Roteiro de validação do fluxo de certificados (validar junto)

1. **Clientes** (`/clients`) — coluna “Certificado”: confira 2–3 clientes com certificado a vencer (deve mostrar `A vencer Nd` amarelo/vermelho) e clientes sem certificado (`—`).
2. **Abrir sessão** (Acessos → Abrir) — método **Certificado A1**: o diálogo lista clientes elegíveis; selecione um; veja a urgência de validade e a nota “no cofre — será instalado no Windows ao abrir” (se aplicável); cancele sem abrir ou abra de fato um portal de teste.
3. **Assinaturas** — escolha um cliente/certificado; confira “vence em Nd” se expiring; clique **“Ver não elegíveis (N)”** e confira o motivo de cada sumido; cancele; não se preocupe com o PDF (pode escolher qualquer PDF local de teste).
4. **Certificados** (`/certificates`) — seus cards de resumo filtram a lista ao clicar (seu WIP) — confira `A vencer`, `Vencidos`, `Ausentes no Windows`.
5. **Loja de certificados do Windows** — os 66 certificados estão “Instalados” nesta máquina (diagnóstico `cid:…` ok).

---

## 8. Limitações conhecidas remanescentes (transparência)

- **`.pvbackup` não importa/restaura pela interface** nesta versão (só exporta).
- **`idleLockMinutes` e `retainAuditDays`** existem nas configurações mas **não têm efeito** nesta versão (sem bloqueio automático por inatividade; sem purga de auditoria).
- **`chain_incomplete`** nunca é calculado/atuado na 0.1.x (a validação efetiva ocorre no handshake do Windows/portal — comportamento documentado).
- **Partições persistentes** mantêm cookies no disco indefinidamente (sem limpeza automática por sessão).
- **Retenção da auditoria**: log cresce para sempre; WAL não cifrado; metadados (clientes/CNPJ) em claro por design (documentado).
- **TSA pública (DigiCert)** sem SLA — **fail-closed**: sem rede/TSA, o PAdES-B-T é **bloqueado** (decisão sua). Não há assinatura offline nesta configuração.
- **Cadeia ICP-Brasil** não é verificada pelo app (o handshake do Windows valida).
- **Instalador sem assinatura de código**: Windows SmartScreen/Smart App Control podem bloquear para terceiros; interno aceita.
- **CI não roda e2e**: ambiente sem display; `test:e2e` executado manualmente quando necessário.
- **Migrar o banco**: migrações rodam no boot; backups do cofre só por certificado (`.pvbackup`) ou cópia integral da pasta `%APPDATA%\aurumbit-portal` quando o app está fechado.

---

## 9. Decisões / ações pendentes (nada foi decidido por mim aqui)

1. **Assinar o instalador** (Certificado de assinatura de código OV/EV) — bloqueia/alarmaria menos no Windows; impacta distribuição externa e reputação do publisher. Sem ele, internalizar e instruir “Mais informações → Executar assim mesmo” ou distribuir por canal administrado.
2. **Servidor de atualizações**: publish removido até existir URL real; se quiser updater, hospedar `latest.yml` + binários e reabilitar `publish`; antes disso a checagem manual em Configurações simplesmente não acha atualização (erro claro).
3. **CSP** `script-src 'unsafe-inline'` (Next export emite inline scripts): hardening exigiria nonces/hashes por página — ADR recomendado antes de distribuição externa.
4. **Retenção de auditoria** (ex.: 90/365 dias) — decisão de produto; hoje cresce sem limite.
5. **HKDF por finalidade** (senha/PFX/campos com subchaves) — muda formato do envelope; exige dual-read + migração lazy; planejar janela própria; não dá para “só ligar”.
6. **Base legada `portal-vault.db`** — apagar quando quiser (não é usada).
7. **`sealBackup`/`icp-chain.ts` mortos** — remover (ou redesenhar AIA como módulo opt-in com verificação de cadeia — alto risco, não plugar).
8. **`verify.ts` ByteRange scan** pode rejeitar PDF legítimo que tenha “/ByteRange” em texto — manter fail-closed, mas considerar verificação por estrutura (pdf-lib) em vez de varredura latin1.
9. **docs históricas** (`docs/qa/*`, `docs/robot-wizard/*`) divergem do código atual — mantidas como registro histórico; não editar retroativamente.
10. **`.gitignore`**: `build/` deve ser **commitado** (contém `icon.ico`).

---

## 10. Apêndice — trilhas da auditoria (índice)

- **Processo principal** (A): sessões/receitas/IPC/selection/manager — 1 P1 (closeAll), 3 P2 (mTLS DN-only, .gov.br blanket, segredos da página em logs), 15+ P3 (abaixo). Revisado também `recipes.test` (oráculo de rede → mitigado), `interruptedRecordingIds` (scan completo → filtrado), `pdf.reveal` (path arbitrário → restrito), `idInputSchema` frouxo na borda (mitigado pelos repositórios — documentado), reuseKey race + janela `registry.set`→`createSessionRow` (race/vazamento, documentados), popups ocultas nunca reveladas (documentadas), OTP regex (corrigido), drain-stuck (corrigido), agentes invisíveis na auditoria (corrigido), `showMessageBoxSync` bloqueia main (decisão de UX — mantido só no quit com recorder), `clipboard.readText` (apagaria cópia idêntica — mantido, decisão de UX).
- **Renderer** (B): 1 P1 (clipboard), 1 P1 (filtro De), 2 P2 (deep-link reabre dialog; settings draft clobado), erros de query mascarados como vazio — **todos corrigidos nesta rodada**; `useSearchParam` só escuta popstate (latente — documentado); `useAudit(limit:500)` mantido (IPC não expressa “entity OU metadata.clientId”); obrigações (tabs/matrix) ainda usam o padrão “falha→vazio” — documentado.
- **Dados/cofre/PDF** (C): 1 P1 (regenerar master key), 6 P2 (PFX %TEMP%/base64 ps1, TSA não verificada/fail-open, holderName PII, logger uncaught, exportBackup, transações ausentes) — **todos corrigidos**; 4 P3 (HKDF, redaction anchor, migration ordering, seed silent) — corrigidos; demais P3 em 9.
- **Build/CI/distribuição** (D): asar 541→50 MB, icon, CI package job, publish removido, files excludes, postinstall fatal, audit 26→16, zod/vitest/node-forge/concurrently bumped, DevTools remoto, `.gitignore` nota (`build/` commitado), artifactName, README (618 testes, 12 embutidos, fail-closed PAdES verdadeiro), USER_GUIDE (JUcec-CE “Certificado e senha”, envio “Entrar sozinho” honestamente documentado).

**Fontes primárias:** `shared/builtins.ts`, `electron/main/{certificates,sessions,recipes,db,pdf,vault,ipc}/*`, `src/**`, `electron-builder.yml`, `.github/workflows/ci.yml`, `tests/**` e o banco `%APPDATA%\aurumbit-portal\aurumbit-portal.db` (íntegro).
