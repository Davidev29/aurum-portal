# Avaliação — Renderer/UI e Next.js 16 (AurumBit Portal 0.1.0)

Data: 2026-11-12 · Escopo: renderer Next.js 16.4.4 (Turbopack) + React 19.3.1 do AurumBit Portal — rotas em `src/app/*/page.tsx` (10 rotas reais + `layout.tsx` + shell), componentes em `src/components/*`, `src/lib/api.ts`, `src/lib/queries.ts`, `src/lib/obligations-queries.ts`, `src/lib/hooks.ts`, `src/app/globals.css`, `next.config.ts`. Contexto: UI desktop local dentro de Electron (sem SSR real; export estático servido via protocolo `app://aurumbit-portal`). SOMENTE LEITURA; nenhum arquivo do repositório foi modificado (este relatório é a única escrita).

Escala de severidade: **S1** = bloqueia release / perda ou exposição de dados / exploit sem interação · **S2** = falha grave com pré-condição razoável, impacto real ao operador · **S3** = fraqueza relevante, mitigável · **S4** = higiene/dívida técnica/defesa em profundidade.

## Veredito: CONCERNS

Renderer estruturalmente saudável e acima da média para um app desktop local (export estático coerente com `app://`, IPC renderer↔preload↔main 100% consistente nos 124 canais (112 invoke + 12 eventos), sem `dangerouslySetInnerHTML`, formulários com validação própria, boa cobertura de landmarks/labels), **mas dois S2 precisam ser corrigidos antes de considerar a UI pronta para produção**: (1) nenhuma página trata erro de query do React Query (`isError` ignorado → falha de IPC/banco vira "cofre vazio" silencioso) e (2) não existe error boundary/`not-found` nas rotas — um crash de render deixa o usuário numa janela branca sem recuperação (DevTools ficam desligados em produção, `electron/main/index.ts:349`). Não há S1. O restante são S3/S4 concentráveis em uma sprint de a11y e higiene.

## Pontos fortes

- **Export estático coerente com Electron**: `next.config.ts` usa `output: 'export'` + `trailingSlash: true` + `images.unoptimized: true` + `devIndicators: false` (válido no tipo de Next 16.4.4) — certo para `app://aurumbit-portal/<rota>/index.html`; `out/` gerado; handler `protocol.handle(APP_SCHEME)` resolve `index.html` com `no-store` em HTML, cache imutável em assets com hash, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `content-security-policy` em toda resposta, e guarda de path traversal (`electron/main/index.ts:406-461`). Nenhuma API dinâmica/SSR/server-component-dependente-de-runtime foi usada — coerente com a natureza desktop.
- **IPC completo e verificado por diff automatizado**: todos os métodos chamados pelo renderer (`window.aurumBitPortal.*`) existem no preload (`electron/preload/index.ts`) e todos os canais do preload existem em `shared/contracts.ts` (`IPC`) e têm handler registrado no main (`handle(IPC.*)` em `electron/main/ipc/index.ts`, 112 handlers); os 12 eventos `IPC.events.*` são broadcast pelo main. Nenhum canal órfão ou inexistente.
- **`window.aurumBitPortal` tipado** (`src/types/global.d.ts`) e `aurumBitPortal()` lança erro fora do runtime do app em vez de falhar tarde (`src/lib/api.ts:4-12`) — fail-fast com mensagem amigável; `errorMessage`/`errorCode`/`isPdfSessionExpired` centralizam tratamento de erro de IPC.
- **React Query organizado**: chaves hierárquicas e namespaced (`['clients', filter]`, `['obligations','list',filter]` — `src/lib/queries.ts:10-26`, `obligations-queries.ts:7-18`), `useInvalidate` usa prefix matching consistente, `queryClient.setQueryData(['sessions'], …)` no EventBridge casa com a key de `useSessions`; `keepPreviousData` em `useMonthOverview`; `staleTime`/`refetchInterval` razoáveis; `refetchOnWindowFocus: false` adequado ao desktop.
- **Sem XSS por construção**: nenhum `dangerouslySetInnerHTML` em `src/`; logos armazenadas como data URL e sanitizadas no main (SVG com blocklist de padrões ativos — `electron/main/services/logo.ts`); `img-src 'self' data:` cobre o uso real; `connect-src 'self'` porque nada faz fetch de rede direto; renderer só fala com o main via IPC validado por Zod.
- **Formulários e validação**: validação manual consistente e correta (`shared/validation.ts` — CPF/CNPJ com dígitos verificadores, máscara progressiva, bl…uge); componente `Field` gera ids via `useId` e associa `<label htmlFor>` (`src/components/ui/input.tsx:84-131`); erros com `role="alert"`; wizards com `aria-current="step"` e radios nomeados (`assinaturas`, `certificate-import-wizard`); diálogos Radix com focus-trap/Escape; `ConfirmDialog` em todas as exclusões.
- **Shell com landmarks**: `<aside>` + `<nav aria-label="Navegação principal">`, `<main>`, breadcrumb `<nav aria-label="Caminho">`, `aria-current="page"` no item ativo, sidebar e topbar com foco visível (outline não removido sem substituto) (`src/components/app-shell.tsx:72,94,142,144`).
- **Estados de UI quase completos**: `isLoading` → `SkeletonGrid/SkeletonTable`, `EmptyState` com ação, toasts de sucesso/erro em 100% das mutações verificadas; `aria-live` em regiões de progresso (assinatura, importação de certificados, avisos); `LiveClock` hidrata sem mismatch; `prefers-reduced-motion` respeitado globalmente (`globals.css:1087`).
- **Carimbo de assinatura acima da média**: arraste com pointer capture, clamp em `pt` absolutos (zoom-independent), ResizeObserver throttling de layout, teclado (setas = mover, Alt+setas = redimensionar — `assinaturas/page.tsx:1203-1227`), `role="slider"` com `aria-valuetext` completo, handle de desenho na página.
- **`any` contido**: apenas 17 ocorrências em código não-teste (3 em `assinaturas` via `import('pdfjs-dist')` dinâmico, 6 em `lib/pdf/barcode.ts`, 8 em `lib/pdf/report-document.ts`); nenhum em componentes/páginas de UI.
- **Tema escuro por arquitetura**: `.dark` class no `<html>` com `suppressHydrationWarning`, tokens WCAG-documentados no topo de `globals.css` (texto ≥7:1, neutros dessaturados), `ThemeSync` reativo a `matchMedia` + setting persistida, toasts com overrides CSS (`globals.css:1106`).

## Achados

### R-1 — S2 — todas as páginas, ex.: `src/app/page.tsx:86`, `src/app/certificates/page.tsx:136`, `src/app/clients/page.tsx:64`, `src/app/audit/page.tsx:76`, `src/app/clients/detail/page.tsx:77-88`
**Descrição:** nenhuma página/componente trata `isError`/`error` do React Query. Falha de IPC (banco bloqueado, permissão, resposta inválida) deixa `data` como `undefined` e a UI renderiza o estado vazio/zero ("Nenhum certificado", contadores `0`, `EmptyState`) sem nenhum aviso. Só handlers de mutação dão toast. `useInvalidate` também engole revalidações.
**Impacto:** o operador não distingue "não há dados" de "o backend falhou" — num cofre de certificados/credenciais, isso pode induzir reimportação, desconexão prematura do banco ou desconfiança total na ferramenta; sem ação de retry na tela.
**Recomendado:** componente `QueryErrorState` compartilhado (mensagem + botão "Tentar novamente" → `refetch()`), renderizado quando `isError`; alternativamente, um banner global no `AppShell` via `QueryErrorResetBoundary`/`useIsFetching+isError` por query crítica; auditar `isLoading || isError` em todas as 10 páginas.

### R-2 — S2 — `src/app/` (ausência) vs. `electron/main/index.ts:349`
**Descrição:** não existe `error.tsx`, `global-error.tsx` nem `not-found.tsx` em nenhuma rota. Uma exceção de render (ex.: dado inesperado de IPC repassado a componente, `undefined.map`) derruba a árvore inteira e a janela fica branca. Em produção, `devTools: isDev` desabilita o DevTools para o usuário final — não há nem diagnóstico nem saída além de matar o processo.
**Impacto:** indisponibilidade total da UI até restart manual; perda do estado em andamento (fluxo de assinatura, formulários); péssima experiência justamente em máquina do escritório, sem usuário técnico presente.
**Recomendado:** adicionar `src/app/error.tsx` (`'use client'`) com mensagem amigável + botão "Recarregar" (`window.location.reload()`/`router.refresh()`) e `src/app/not-found.tsx` mínimo; opcionalmente um `ErrorBoundary` de classe no `Providers` como segunda linha de defesa.

### R-3 — S3 — `src/app/layout.tsx:9-17`, `src/components/app-shell.tsx:72,142`
**Descrição:** não há link "Pular para o conteúdo" (WCAG 2.4.1, nível A). Landmarks existem, mas o teclado percorre logo, ~10 itens de navegação, breadcrumb, relógio e ações da topbar antes do conteúdo — em todas as 10 rotas.
**Impacto:** navegação por teclado desnecessariamente lenta/frustrante; reprovação em checklist formal de acessibilidade (governo/LGPD-adjacent clients costumam exigir).
**Recomendado:** primeiro elemento focável do shell: `<a href="#conteudo" className="sr-only focus:not-sr-only …">Pular para o conteúdo</a>` e `<main id="conteudo" tabIndex={-1}>`.

### R-4 — S3 — `src/app/globals.css:97-98,258-261,359,1058-1062`
**Descrição:** `:focus-visible { outline: none; box-shadow: var(--pv-ring) }` com ring `rgba(168,133,63,.35)` (claro) / `rgba(220,201,135,.3)` (escuro) — alphas muito baixos sobre painéis quase-neutros; na prática o indicador de foco fica abaixo de 3:1 contra o fundo adjacente (contraste mínimo WCAG 1.4.11 / visível em 2.4.11 para AA). Componentes reforçam com `ring-brand-600/40` etc., mas também translúcidos. Regra ainda duplicada em dois pontos do arquivo (linhas 258 e 1058).
**Impacto:** usuários de teclado perdem a trilha do foco em painéis claros/escuros quentes (paleta "chumbo/champanhe"); o undo de `outline` só é seguro se o ring for claramente perceptível.
**Recomendado:** ring opaco com ≥3:1 medido contra `--pv-panel` (ex.: 2px sólido `brand-600`/`brand-300`); remover a duplicação; validar par claro/escuro com ferramenta de contraste; manter `outline: none` apenas onde o ring substituto é visivelmente mais forte.

### R-5 — S3 — `electron/main/index.ts:438-445` (verificado via leitura; ver também SA-2 em `docs/qa/EVAL-security-architecture.md`)
**Descrição:** CSP de produção (protocolo `app://`) inclui `script-src 'self' 'unsafe-inline'` — exigido pelos scripts inline de hidratação do export estático do Next — e `style-src 'unsafe-inline'`. Não é defeito novo nem exclusivo do renderer, mas o renderer é quem o herda: qualquer marcação injetada no DOM executa com privilégio de `window.aurumBitPortal.*` (origin trusted).
**Impacto:** anula parcialmente a contenção de XSS same-origin; risco residual baixo (sem `dangerouslySetInnerHTML`, React escapa por padrão, dados de API passam por componentes controlados), mas real como defesa em profundidade.
**Recomendado:** manter e monitorar (ver SA-2: hashes/nonces dos inline scripts no export, ou documentar a exceção como trade-off aceito); não "consertar" movendo CSP para `<meta>` — piora a precedência. Enquanto isso, CSP permanece reportada aqui como risco assumido, não como bug.

### R-6 — S3 — `src/app/assinaturas/page.tsx:165,567,174-199`
**Descrição:** o fluxo de assinatura mantém os **bytes completos do PDF em `useState`** (`PdfPreviewData.data: ArrayBuffer`, até 50 MB por `SIGN_PDF_MAX_BYTES`) **e** passa `preview.data.slice(0)` ao `pdfjs-dist` na linha 567 — criando uma segunda cópia integral do arquivo; o getDocument pode ainda destacar/transferir o buffer. Pico de memória ≈ 2–3× o tamanho do arquivo, mais o documento pdf.js parseado e o canvas de render (zoom até 4×). O estado local (`stampPt`, `step`, `certPage`…, ~15 `useState` num único "god component" de 2.508 linhas) também torna caro cada re-render com um ArrayBuffer pendurado.
**Impacto:** em máquinas modestas (o público-alvo — escritórios de contabilidade em Windows de entrada), assinar PDFs grandes pode estourar heap do renderer, causar jank perceptível no arraste do carimbo e, em caso extremo, crash da aba — sem recuperação (ver R-2).
**Recomendado:** (1) manter `preview.data` num `useRef` (não re-renderiza) e fatiar **uma vez** por documento; (2) considerar blob URL + `getDocument({ url })`/streaming do pdf.js; (3) limitar DPR/zoom de render e descartar canvases de páginas anteriores; (4) extrair `usePdfPreview`/`useStampDrag` e dividir a página (manutenibilidade); (5) revalidar no main que o token ainda corresponde ao arquivo antes do sign (já existe — manter).

### R-7 — S3 — `src/app/assinaturas/page.tsx:2014-2026`
**Descrição:** o carimbo 2D é exposto como `role="slider"` (unidimensional por definição) com `aria-valuemin/max={0..100}` e `aria-valuenow={x%}`; o eixo Y, a largura e a altura só existem dentro de `aria-valuetext`. Leitor de tela anuncia "controle deslizante 42" — semântica incorreta e sem como operar W/H via papel semântico. O teclado existe e é bom (setas movem, Alt redimensiona, clamp, `preventDefault`), mas o papel não descreve a affordance.
**Impacto:** usuário de leitor de tela não consegue posicionar/redimensionar o carimbo com confiança — o passo mais sensível do fluxo de assinatura (posição do selo no documento).
**Recomendado:** `role="application"` (com `aria-label` e instruções de teclado anunciadas na entrada) ou `role="group"` + dois `spinbutton` (X/Y) e dois para W/H; documentar as setas no texto de ajuda visível ("Use as setas (Alt redimensiona)") e manter o `aria-valuetext` completo.

### R-8 — S4 — `package.json:39,66,70,78` (+ `zod` em 81)
**Descrição:** `react-hook-form@7.91.0`, `@hookform/resolvers@5.2.2` e `next-themes@0.4.6` declarados mas **nunca importados** em `src/` (grep exaustivo). Formulários usam `Field` manual + `shared/validation.ts`; tema é sincronizado manualmente em `providers.tsx:34-53`. `graphify@^1.0.0` idem. `zod@3.25.76` só é usado no main (schemas IPC em `shared/contracts.ts`) e em `src/lib/knowledge-graph/types.ts`.
**Impacto:** peso morto de instalação, superfície de supply-chain e documentação implícita enganosa (quem ler package.json espera RHF); risco de alguém "migrar" parcial para RHF e coexistir com o padrão atual.
**Recomendado:** remover as quatro deps (ou migrar conscientemente); manter zod apenas se main/shared seguirem usando (sim); registrar a decisão no ADR de stack.

### R-9 — S4 — `src/lib/knowledge-graph/*` (17 arquivos), `knowledge-graph/llm/orchestrator.ts:111`
**Descrição:** módulo inteiro de grafo de conhecimento + orquestrador LLM **sem nenhum chamador no app** (apenas testes `tests/unit/knowledge-*.test.ts` importam). O orquestrador traz default hardcoded `baseURL: 'https://api.openai.com/v1'` para `chat/completions` com API key — código de produto morto com default de endpoint externo e sem feature flag.
**Impacto:** superfície de leitura/manutenção sem payoff; risco real de um futuro "ativarmos o grafo" sem decisão de design/LGPD (enviar metadados de clientes para API externa por padrão é violação do princípio do menor privilégio e da LGPD para esse domínio); infla `tsc`/cobertura.
**Recomendado:** mover para `docs/spikes/` ou `experiments/` fora do build, ou deletar (git preserva histórico); qualquer endpoint externo deve exigir opt-in explícito com consentimento e nunca default.

### R-10 — S4 — `src/app/clients/detail/page.tsx:88,103`
**Descrição:** a ficha do cliente baixa `useAudit({ limit: 500 })` e filtra **no renderer** por `entityId === client?.id || metadata.clientId === client?.id` — embora `AuditFilter` suporte `entity`/`entityId` (`shared/types.ts` — `AuditFilter`) e o handler `audit:list` já receba o filtro completo.
**Impacto:** IPC desnecessário por abertura de ficha, filtro incompleto (só olha 500 eventos recentes — eventos do cliente fora da janela somem silenciosamente) e lógica de negócio duplicada no cliente.
**Recomendado:** `useAudit({ entity: 'client', entityId: id, limit: 50 })` (+ paginação) e deixar a filtragem no main.

### R-11 — S4 — `src/components/ui/primitives.tsx:142`, `src/components/ui/empty-state.tsx:30`
**Descrição:** salto de hierarquia de headings: páginas abrem com `<h1>` (PageHeader) e seções/estados vazios usam `<h3 className="pv-eyebrow">`/`<h3>` — nunca `<h2>`. Leitores de tela perdem o outline (WCAG 1.3.1/2.4.6, técnica suficiente ARIA12).
**Impacto:** navegação por headings confusa em páginas densas (assinaturas: h1 → h3 repetido em painéis).
**Recomendado:** trocar `SectionTitle` e o heading de `EmptyState` para `<h2>` (estilo inalterado via classe).

### R-12 — S4 — `src/components/ui/table.tsx:7,42`
**Descrição:** tabelas de dados (certificados, clientes, auditoria, matriz de obrigações) sem `<caption>` e `<th>` sem `scope="col"`; contêiner scrollável sem `role="region"`/`aria-label`.
**Impacto:** leitor de tela anuncia células sem contexto de coluna em tabelas de 5+ colunas; a matriz de obrigações é navegável mas sofre do mesmo problema.
**Recomendado:** adicionar `scope="col"` em `TableHead`, aceitar `aria-label` em `Table` e aplicá-lo nas tabelas densas; `<caption className="sr-only">` onde fizer sentido.

### R-13 — S4 — `src/components/credentials/credential-reveal-dialog.tsx:110`
**Descrição:** botão somente-ícone `<Button size="icon-sm" onClick={copy}>` sem `aria-label` nem `title` (único caso detectado; os demais ícone-only usam `aria-label`).
**Impacto:** leitor de tela anuncia "botão" sem função — justamente a ação "copiar senha", a mais provável de ser usada às cegas.
**Recomendado:** `aria-label="Copiar senha"` (+ `title`).

### R-14 — S4 — `src/components/sessions/launch-dialog.tsx:289-303`
**Descrição:** `role="radio"` em `<button>` comuns sem navegação por setas (padrão APG `radiogroup`: Tab move para o grupo, setas alternam) — só Enter/Space/clique funcionam.
**Impacto:** comportamento anunciado ("radio") não corresponde à interação real; usuário de teclado percorre N botões individuais.
**Recomendado:** usar Radix `RadioGroup` (já no stack) ou implementar `onKeyDown` com setas/roving tabindex.

### R-15 — S4 — `src/components/sessions/launch-dialog.tsx:69-79`, `src/app/assinaturas/page.tsx:116`, `src/app/page.tsx:110`
**Descrição:** regra de elegibilidade de certificado (`status !== 'expired' && !== 'missing_windows' && !== 'chain_incomplete'`, + vínculo com cliente/janela de validade) implementada de novo em três lugares do renderer, enquanto `shared/certificate-renewal.ts` e o main já conhecem a verdade (o sign revalida). Idem `isGovBrDerived` e o filtro "a vencer".
**Impacto:** drift garantido no tempo (novo status de certificado → UI mente até alguém lembrar do terceiro ponto); erros de UX ("certificado aparece mas o main recusa") sem diagnóstico.
**Recomendado:** extrair helper compartilhado (`shared/certificate-eligibility.ts`) consumido por renderer e main, ou derivar de `certificateEffectiveValidToOf`/`CERTIFICATE_STATUSES` únicos.

### R-16 — S4 — `src/components/sessions/launch-dialog.tsx:32,63,232-236`
**Descrição:** preferência "última escolha" por serviço grava `{clientId, method, certificateId, credentialId}` em `localStorage` (`aurumbit:launch:<serviceId>`). São ids opacos (não segredos), mas persistem trilha de "quem acessa o quê com qual certificado" fora da auditoria e sobrevivem a limpeza de cache do webview.
**Impacto:** metadado sensível residual em disco dentro de `localStorage` do origin `app://`; fora do modelo de auditoria/redação do main.
**Recomendado:** questionar necessidade; se útil, mover para setting no main (tabela `settings`/pref por usuário) — ou ao menos `sessionStorage` e documentação da escolha.

### R-17 — S4 — `src/lib/hooks.ts:8-12`
**Descrição:** `useSearchParam` lê `window.location.search` só no mount e escuta apenas `popstate`. Navegação client-side do App Router para a mesma rota com query diferente (`/clients/detail?id=A` → `?id=B`) **não dispara `popstate`** — o valor fica obsoleto (ex.: `?edit=1` na home/`serviceId`) até remontar. Funciona hoje porque quase toda navegação com query muda de rota.
**Impacto:** dado obsoleto exibido para a URL atual (ficha do cliente errada em cenário de deep-link same-route); deep-links antigos (`?serviceId=`) herdam o mesmo risco.
**Recomendado:** migrar para `useSearchParams()` do `next/navigation` com fronteira `<Suspense>` (obrigatório no export estático) ou combinar com `usePathname()` + efeito que relê `location.search` a cada mudança de pathname.

### R-18 — S4 — `src/app/session/page.tsx:172-199`
**Descrição:** a janela de sessão (portal embarcado) não tem `<h1>` nem `<AppShell>`; o nome do cliente é um `<span className="truncate text-sm font-semibold">` sem papel semântico nem acesso por heading. (Os dois `<main>` condicionais são mutuamente exclusivos e o segundo é `aria-hidden` — aceitável.)
**Impacto:** leitor de tela entra numa "página" sem título nem contexto; dificulta identificar qual portal/cliente está aberto.
**Recomendado:** `<h1 className="sr-only">{clientName} — {serviceName}</h1>` no header; opcionalmente `aria-label` no `<header>`.

### R-19 — S4 — `src/components/providers.tsx:130`
**Descrição:** `<Toaster theme={undefined}>` — o default do sonner é `'light'`, então os toasts nascem claros mesmo no tema escuro; a mitigação são os overrides `[data-sonner-toaster]` em `globals.css` (parciais, e não cobrem bordas/estados do richColors desligado).
**Impacto:** inconsistência visual e possível baixo contraste de texto secundário do toast no modo escuro.
**Recomendado:** ler o tema efetivo (mesma fonte do `ThemeSync`) e passar `theme={theme === 'dark' ? 'dark' : 'light'}` (ou `'system'` + `color-scheme`).

### R-20 — S4 — `src/app/assinaturas/page.tsx` (2.508 linhas)
**Descrição:** página-monólito: autenticação de certificado, escolha de PDF, preview pdf.js, drag-and-drop do carimbo, QR, zoom, passos 1–4, assinatura com timer — dezenas de `useState`/refs, zero extração em hooks/componentes próprios. Funciona (o fluxo está bem pensado) mas qualquer mudança toca em tudo.
**Impacto:** tempo de iteração e risco de regressão altos; dificulta testes unitários de UI e review; combina com R-6 (PDF em estado) e R-7 (a11y do carimbo).
**Recomendado:** fatiar em `features/assinatura/{PdfPreview,StampLayer,CertTable,SignStepper}.tsx` + hooks `usePdfDocument`, `useStampRect`; manter o fluxo igual.

### R-21 — S4 — `src/components/ui/input.tsx:99-104` + `primitives.tsx` (Avatar aria-hidden)
**Descrição:** observação positiva com ressalva: o padrão `Field`/`useId` é bom, mas o `Avatar` é `aria-hidden` mesmo quando é o único conteúdo de identificação visual (ex.: cards de cliente) — o nome textual adjacente cobre, então **sem impacto**; registrado apenas para completar a cobertura de leitura. (Sem ação necessária.)
**Impacto:** nenhum.
**Recomendado:** nenhuma ação; manter.

### R-22 — S3 — `src/app/page.tsx:557-570`
**Descrição:** cards de serviço/certificado usam `<button>`/`<img alt="">` corretamente na maioria dos pontos, mas a "estrela" de favorito usa `key={String(service.favorite)}` para re-montar o ícone e a animação `pv-star-pop` — reinício de animação a cada toggle, sem respeito explícito a `prefers-reduced-motion` além do override global. Verificado: o override global (`globals.css:1087`) cobre, portanto **risco residual**.
**Impacto:** baixo; listado para completude de a11y de animações.
**Recomendado:** nenhuma urgência; opcionalmente trocar remount por classe de estado.

## Limitações da avaliação

- **Somente leitura**: `next build`, `lint`, `vitest`, `playwright` não foram executados (escrita em `out/` e artefatos é proibida); erros de build/typecheck não foram avaliados além de leitura estática. O build de produção pode embutir riscos que só aparecem em runtime.
- **Sem execução do app**: nenhum fluxo foi clicado; CSP só vale no protocolo `app://` (produção) — no dev (`http://localhost:3000`) não há CSP nem `nosniff`; ambos não foram observados em browser.
- **A11y por inspeção de código**: não houve auditoria com leitor de tela real (NVDA/JAWS/VoiceOver) nem medição instrumental de contraste; os julgamentos de WCAG são por inspeção e cálculo aproximado.
- **Contagem de rotas**: o pedido fala em "11 rotas"; o repositório tem **10** `page.tsx` (`/`, `/assinaturas`, `/audit`, `/certificates`, `/clients`, `/clients/detail`, `/obrigacoes`, `/session`, `/sessions`, `/settings`) + `layout.tsx` + `_not-found` gerado pelo export. Detalhe de cliente/sessão é via query param (`/clients/detail?id=`), não rota dinâmica — adequado ao export.
- **Main/preload fora do escopo exceto nas fronteiras** (canais IPC, broadcast de eventos, CSP do protocolo): correção de handlers, criptografia, paths de arquivo etc. estão no `EVAL-security-architecture.md`; a sobreposição deliberada (CSP `unsafe-inline`) é referenciada, não duplicada.
- **SSR/SEO não exigidos**: para este app desktop local, `metadata` mínimo no `layout.tsx` é suficiente; ausência de OpenGraph/sitemap/canonical **não é defeito**. Client Components em todas as páginas é a escolha correta aqui — não penalizado.
- **Testes de UI**: não inspecionei `tests/` em profundidade (fora do escopo); cobertura de a11y/interação nos testes existentes não foi medida.
- **Datas**: arquivos-fonte exibem mojibake em comentários pt-BR (encoding lido como Latin-1 em algumas tools); conteúdo semântico não foi afetado na revisão.
