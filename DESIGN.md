# AurumBit Portal — DESIGN.md

> Sistema de design do AurumBit Portal — cofre de acessos e sessões isoladas
> para portais públicos brasileiros (Electron + Next.js + Tailwind v4 + Radix).
> Linguagem visual derivada da referência **Linear** (catálogo awesome-design-md,
> pasta `linear.app`), adaptada para um **aplicativo desktop de uso prolongado**
> e para os dois temas (claro e escuro). Valores abaixo refletem **exatamente**
> o que está em `src/app/globals.css` e nos componentes de `src/components/`.
> Não documente token que não exista no código; mantenha os dois em sincronia.

---

## 1. Tema

**Resumo em uma frase:** "quiet luxury software" — canvas tinta-índigo
**elevado** (`#17171F`) com textura de filme (mesh índigo + grain) e um véu de
vidro "liquid glass" (iOS 26 em repouso: especular de 1px no topo da janela,
sidebar/header translúcidos com `backdrop-blur`) no escuro; o mesmo sistema de
textura/vidro em tom aquarela sobre o canvas frio no claro (tokens do claro
intocáveis); um único acento cromático (lavanda Linear `#5E6AD2`); hairlines
de 1px e ladder de superfícies carregam a hierarquia — nunca sombras pesadas
nem arco-íris.

- **Contexto:** app de gestão contábil/gov.br (kind: software), denso e técnico,
  para profissionais que usam o sistema o dia inteiro.
- **Símbolo:** a logo AurumBit (`public/Logomarca da empresa.png`) em chip de 44px.
- **Referência de linguagem:** Linear (cool greys, single accent, motion com
  overshoot contido). Nenhuma criação é afiliada à marca Linear.
- **Adaptação da referência:** Linear é dark-first; aqui o **tema claro foi
  derivado** do `inverse-*` do Linear (canvas branco puro → substituído por um
  canvas frio `#F6F6F8` com painéis brancos) e o escuro parte de `surface-1`
  `#0F1011`, elevado para `#101014` em 2026-11 e depois para `#17171F`
  (menos fadiga em sessões longas; contraste re-medido e aprovado).
- **Accent scarcity:** lavanda só em CTA primário, foco, item de navegação ativo,
  links e chips de identidade (gov.br). Semânticos (verde/âmbar/vermelho) só para
  estado. Nunca dois acentos decorativos.
- **Tipografia:** Inter (substituto aberto do Linear) com o stack de sistema
  como fallback — o app roda offline (Electron) e não baixa fontes.
- **Adaptação Mercury (2026-11):** a tela inicial ("Acessos", rota `/`) usa a
  superfície tonal do Mercury (catálogo awesome-design-md, pasta `mercury`):
  fills lavanda-pálida/noite-violeta, radius 12/32px, hierarquia por tamanho e
  cor, pill primário única por card. O acento do app é preservado. Nenhuma
  criação é afiliada à marca Mercury. Detalhes em §2 (Acessos) e §4.

## 2. Cores

### Escuro (`.dark` — padrão visual do app é o claro; o usuário escolhe)

| Token | Valor | Uso |
|---|---|---|
| `--pv-bg` | `#17171f` | canvas da janela (nunca `#000`) — elevado 2026-11-13 |
| `--pv-panel` | `#1f1f27` | surface-1: cards, sidebar (vidro `.pv-glass` sobre o canvas), header, dialog |
| `--pv-panel-2` | `#26262f` | surface-2: hover, chips, toolbar interna |
| `--pv-panel-3` | `#2d2d38` | surface-3: ícone ativo de seção |
| `--pv-inset` | `#13131a` | poços e trilhos |
| `--pv-border` | `#2d2d36` | hairline 1px padrão |
| `--pv-border-strong` | `#43434f` | hairline forte (inputs/hover) |
| `--pv-border-subtle` | `#23232c` | divisores internos |
| `--pv-text` | `#f2f2f6` | primário (15,9:1 no canvas) |
| `--pv-muted` | `#bec0ca` | secundário (9,8:1) |
| `--pv-faint` | `#9b9ea9` | terciário/labels (6,7:1 no canvas; 5,1:1 no panel-3) |
| `--pv-accent` | `#a5adff` | lavanda **texto** no escuro (8,5:1) |
| `--pv-accent-solid` | `#5e6ad2` | CTA sólido (branco sobre ele: 4,7:1 ✓ AA) |
| `--pv-accent-solid-hover` | `#6e77de` | hover do CTA (branco sobre: 4,8:1 ✓) |
| `--pv-accent-strong` | `#828fff` | lavanda clara ênfase |
| `--pv-accent-2` | `#8e94c8` | slate índigo (chips terciários) |
| `--pv-accent-soft` | `rgba(133,141,255,.13)` | fundo de seleção/ativo |
| `--pv-accent-soft-border` | `rgba(140,149,255,.32)` | borda do soft |
| `--pv-on-accent` | `#ffffff` | texto sobre CTA |
| `--pv-success` | `#3dd68c` | texto/estado válido |
| `--pv-success-solid` | `#1f7a3d` | fill verde com texto branco (5,4:1 ✓) |
| `--pv-success-soft` / `-border` | `rgba(61,214,140,.12/.28)` | tint |
| `--pv-warning` | `#fbb03b` | texto atenção |
| `--pv-warning-soft` / `-border` | `rgba(251,176,59,.11/.28)` | tint |
| `--pv-danger` | `#ff6369` | texto destrutivo (6,2:1) |
| `--pv-danger-solid` / `-strong` | `#d92d20` / `#b02a20` | fill destrutivo (4,8:1 ✓) |
| `--pv-danger-soft` / `-border` | `rgba(255,99,105,.12/.3)` | tint |
| `--pv-info` | `#a9b4cc` | texto informativo (slate-azulado) |
| `--pv-info-soft` / `-border` | `rgba(169,180,204,.12/.26)` | tint |

### Claro (`:root`)

| Token | Valor | Uso |
|---|---|---|
| `--pv-bg` | `#f6f6f8` | canvas frio (inverse-canvas adaptado) |
| `--pv-panel` | `#ffffff` | painéis de folha branca |
| `--pv-panel-2` | `#f1f1f4` | hover, chips, headers de tabela secudários |
| `--pv-panel-3` | `#e8e8ec` | trilhos fortes |
| `--pv-inset` | `#ededf1` | poços |
| `--pv-border` | `#e2e2e7` | hairline |
| `--pv-border-strong` | `#c7c7ce` | hairline forte |
| `--pv-border-subtle` | `#ececf1` | divisores |
| `--pv-text` | `#17181c` | primário (17,7:1) |
| `--pv-muted` | `#4e5058` | secundário (8,0:1) |
| `--pv-faint` | `#6e707a` | terciário (4,6:1 no painel) |
| `--pv-accent` | `#4e56c4` | lavanda **texto** no claro (6,0:1 ✓ AA) |
| `--pv-accent-solid` / hover | `#5e6ad2` / `#4e56c4` | CTA (branco: 4,7/6,0 ✓) |
| `--pv-accent-strong` | `#3f46a8` | ênfase profunda |
| `--pv-accent-2` | `#575e8a` | slate índigo |
| `--pv-accent-soft` / `-border` | `#ededfc` / `#d9d9f2` | tint de ativo |
| `--pv-success` / `-solid` | `#17753c` / `#1f7a3d` | texto/fill (5,8/5,4 ✓) |
| `--pv-warning` | `#b45309` | texto (5,0:1 ✓) |
| `--pv-danger` / `-solid` | `#b3261e` / `#d92d20` | texto/fill (6,5/4,8 ✓) |
| `--pv-info` | `#3f4c5e` | slate informativo |
| `--pv-success-soft/border`, `--pv-warning-soft/border`, `--pv-danger-soft/border`, `--pv-info-soft/border` | pares "soft" claro (`#edf7ef`/`#bfe5cc`, `#fbf3e4`/`#f0d7a8`, `#fcedeb`/`#f3c0b8`, `#eef0f5`/`#ccd2de`) | tints |

### Seleção, anel de foco, overlay, shimmer

- `::selection` — lavanda a 28–34% de opacidade.
- Foco: `outline: 2px solid var(--pv-accent-solid); outline-offset: 2px` (camada
  `base`). Inputs ganham também `box-shadow: var(--pv-ring)`
  (`rgba(94,106,210,.35)` / `rgba(130,143,255,.38)`).
- Overlay de modais: `rgba(16,16,20,.44)` claro / `rgba(5,5,8,.62)` escuro + `backdrop-blur-sm`.
- Skeleton shimmer: `rgba(255,255,255,.55)` claro / `.06` escuro.

### Canvas — textura + liquid glass (ambos os temas, 2026-11-13)

O canvas deixou de ser cor chapada: recebe **grain de filme** + **mesh** índigo
e veste um **véu de vidro** ("liquid glass" iOS 26 em repouso). Tudo fixo,
`pointer-events:none`, `z-index:-1` (atrás de todo conteúdo); nada anima.

| Camada | Token | Claro | Escuro |
|---|---|---|---|
| Mesh (3 radiais nos cantos, só lavanda→índigo) | `--pv-mesh` | α .22/.15/.16 sobre `#f6f6f8` | α .13/.11/.085 sobre `#17171f` |
| Véu vertical + especular 1px no topo | `--pv-veil-top` | `rgba(255,255,255,.14)` | `rgba(226,229,255,.06)` |
| | `--pv-veil-bottom` | `rgba(23,24,28,.05)` | `rgba(0,0,0,.3)` |
| | `--pv-edge-specular` | `rgba(255,255,255,.9)` | `rgba(226,229,255,.14)` |
| Grain (SVG `feTurbulence`, soft-light) | `--pv-grain-image` | `url("data:image/svg+xml,…")` (compartilhado) | idem |
| | `--pv-grain-opacity` | `.06` | `.05` |
| Vidro — fill | `--pv-glass-fill` | `rgba(255,255,255,.68)` | `rgba(31,31,41,.66)` |
| Vidro — fallback (sem `backdrop-filter`, via `@supports`) | `--pv-glass-fallback` | `rgba(255,255,255,.94)` | `rgba(31,31,39,.94)` |
| Vidro — blur / saturação / especular interno | `--pv-glass-blur` / `--pv-glass-saturate` / `--pv-glass-specular` | `20px` / `1.5` / `rgba(255,255,255,.8)` | `20px` (herdado) / `1.6` / `rgba(255,255,255,.1)` |

**`.pv-glass`** (superfícies reais de vidro — sidebar, header da shell, header
da sessão isolada, barra de ações fixa das Configurações): fill translúcido
(light `rgba(255,255,255,.68)` / dark `rgba(31,31,41,.66)`) +
`backdrop-filter: blur(20px) saturate(1.5/1.6)` + especular interno no topo
(`box-shadow: inset 0 1px 0`). Fallback sem suporte: `@supports not
(backdrop-filter)` → fill sobe para α `.94` (vidro vira painel quase opaco).

**Nunca em painéis/cards/tabelas/dialogs** (AA + performance); blur só nas
superfícies de função. Painéis seguem opacos.
**Sombreado de seleção/foco/overlay:** inalterados.

Contraste re-medido (`.preview/contrast.mjs` + medição na build): text 15,9 ·
muted 9,8 · faint 6,7 (canvas) / 5,1 (panel-3) · accent 8,5 — todos AA.
Texturas são estáticas: `prefers-reduced-motion` respeitado por construção.

### Escala `brand` (Tailwind, mapeada ao lavanda)

`brand-50…900` — `#f0f0fc #e3e3fa #c7c8f5 #a5adff #5e6ad2 #4e56c4 #3f46a8 #2f348a #23255f`.
Usada por utilitários legados (`text-brand-600` etc.). **Não introduzir novas
cores fora desta escada.**

### Semântica obrigatória

- `--pv-accent`, `--pv-success`, `--pv-warning`, `--pv-danger` são cores de
  **texto** (soft backgrounds). Fundo sólido com texto branco usa `--pv-*-solid`.
- Destrutivo nunca é só vermelho: peso 700 + tint + borda (`.pv-danger-surface`).

### Acessos (tela inicial) — linguagem tonal Mercury adaptada

Frame do card de acesso derivado do catálogo awesome-design-md (pasta `mercury`),
**adaptado**, não afiliado. Mercury entra pela **superfície, forma e tom** — o acento
de ação continua `--pv-accent-solid` (`#5E6AD2`, índigo a 2% de matiz do Mercury
`#5266eb`); adotar os dois criaria deriva dual-accent no mesmo pixel. Cards são
separados por **fill**, nunca por borda/sombra de repouso.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `--pv-access-fill` | `#edecfb` | `#1e1e2a` | fill do card (lavender / night-raised Mercury) |
| `--pv-access-fill-hover` | `#e2e1f8` | `#242432` | hover — UM degrau tonal, sem translateY |
| `--pv-access-fill-active` | `#d7d6ef` | `#1a1a26` | press |
| `--pv-access-ink` | `#28253b` | `#ededf3` | título do acesso (plum-ink / on-dark) |
| `--pv-access-ink-2` | `#554e7b` | `#c3c3cc` | secundário (ink-secondary / fog) |
| `--pv-access-divider` | `rgba(40,37,59,.08)` | `rgba(237,237,243,.08)` | hairline do rodapé de ações |

Contraste no card (medido, WCAG): `#28253b` sobre `#edecfb` 12,7:1; `#554e7b` 6,5:1.
No escuro: `#ededf3` sobre `#1e1e2a` 14,1:1; fog `#c3c3cc` 9,4:1. Branco sobre CTA
`#5e6ad2` 4,7:1. Tudo ≥ 4,5:1 (AA).

## 3. Tipografia

- **Família:** `Inter` → `'Segoe UI Variable Text'` → `'Segoe UI'` → `system-ui`
  → `-apple-system` → `BlinkMacSystemFont` → `Helvetica Neue` → `sans-serif`.
  (`--font-sans` em `@theme`.)
- **Mono:** `ui-monospace` → `Cascadia Mono` → `JetBrains Mono` → `Consolas`
  (`--font-mono`) — usado em partições, thumbprints, códigos CID.
- **Pesos usados:** 400 (corpo), 500 (labels/eyebrows semibold discretos),
  600 (botões, títulos de card, headers), 700 (eyebrows de seção).
- **Tracking:** corpo `-0.011em`; títulos `-0.02em`; eyebrow `+0.13em` upper-case 10.5px.
- **Escala efetiva (Tailwind arbitrário):**
  - h1 de tela: 19px / 600 / `-0.02em` / `text-wrap: balance`
  - título de card/dialog: 15–20px / 600
  - corpo: 13–14px / 400–500
  - caption/labels: 11–12px
  - eyebrow: 10.5px / 700 / tracking `.13em`
  - métrica grande (StatCard): 20px / 600 / `.pv-num` (`tnum`)
- `h1,h2,h3` recebem `text-wrap: balance` **na camada `utilities`** (nunca fora
  dela: `text-wrap` reseta `text-wrap-mode` e quebraria `.truncate`).

## 4. Componentes

### Botões (`ui/button.tsx`, base `.pv-btn` em `globals.css`)
- Base: `rounded-[var(--pv-radius-control)]` (8px), `text-sm font-semibold`,
  shine hover (`.pv-btn::before`), press `scale .97`, ripple JS opcional.
- `default`: fill `--pv-accent-solid` + `--pv-on-accent`; hover `--pv-accent-solid-hover` + `shadow-md`.
- `secondary`: borda `--pv-border-strong` + painel; hover: borda lavanda, texto lavanda, fundo `--pv-accent-soft`.
- `ghost` / `outline` / `soft` / `link` / `destructive` (fill `--pv-danger-solid`, branco).
- Tamanhos: `h-10 px-4` padrão, `sm h-9`, `lg h-11`, `icon h-10 w-10`, `icon-sm`, `icon-xs`.

### Inputs (`ui/input.tsx`, `ui/select.tsx`, `ui/tabs.tsx`, `ui/switch.tsx`)
- 8px radius, borda `--pv-border-strong`, hover `--pv-accent-solid`,
  foco: borda lavanda + `box-shadow: var(--pv-ring)`. Sem sombra no hover (enxuto).
- Switch: trilho `--pv-border-strong` → checked `--pv-accent-solid`; thumb branco;
  `data-state` transição suave (expo, 200ms).
- Checkbox: checked → `--pv-accent-solid`, ícone Check com `pv-anim-check-pop`.
- Tabs: lista `--pv-panel-2` + hairline; aba ativa = `--pv-panel` com `shadow-sm`
  + `ring-1 --pv-border` + texto forte (**surface-lift**, não CTA lavanda).

### Cards (`ui/card.tsx`, `ui/primitives.tsx`)
- `pv-lift`: painel 12px, hairline, hover: `--pv-shadow-md` + borda forte (sem subir).
- `StatCard`: label 11px CAPS/faint (`break-words`/`[overflow-wrap:anywhere]`),
  valor 20px/600 `pv-num`; ícone em chip tonal (brand/success/warning/danger/teal=accent-2).
- `Toolbar`, `SectionTitle`, `SkeletonGrid`, `SkeletonTable`: mesma linguagem.

### Acessos — card de acesso (`app/page.tsx`, `.pv-access-card` / `.pv-access-logo`)

Tela inicial ("Acessos", rota `/`). Mercury adaptado (ver §2). Regras do card:

- **Sem borda nem sombra de repouso** — separação por `--pv-access-fill`;
  hover = UM degrau tonal (`-hover`), press = `-active`. Nada de `translateY`.
- Anatomia: cabeçalho (logo 72px em tile arredondado 18px, nome 16px/500
  `--pv-access-ink`, máx. 2 linhas via `line-clamp-2` + `title`; eyebrow de
  categoria 10px/500 uppercase `+0.14em` `--pv-access-ink-2`) → linha 1 de
  badges (sessões abertas primeiro, `AuthMethodBadges`, chip `gov.br`, estados
  de atenção: `Desabilitado` danger / `Automação com falha` warning) →
  linha 2 quieta: `Origem · automação` em `--pv-access-ink-2` + switch Ativo/Inativo
  à direita → rodapé com hairline `--pv-access-divider`: **uma** ação sólida
  ("Abrir portal", pill 40px, raio 32px, `--pv-accent-solid`) + ações
  translúcidas redondas (`variant="soft"`, `rounded-full`) para editar/menu.
- Favorito: estrela flutuante absoluta no canto superior direito (botão 40×40,
  ícone 20px), hover âmbar + `pv-star-pop`; `focus-visible:ring-2`.
- `Nativo`/`Personalizado` e `sem automação`/`automação ativa` são **texto**,
  não badge — badges só para o que pede atenção.
- Grid 1/2/3 colunas por **container query** (`@container` + `@min-[600px]`,
  `@min-[1080px]` — a sidebar alterna 264px/76px, invalidando breakpoints de
  viewport); gap 20px; `SkeletonGrid` permanece em sm/xl (estado de carga).
- Logos: `loading="lazy"` removido — 8 ícones de ≤ 35 KB, eager evita frame
  vazio no primeiro paint.

### Navegação (`components/app-shell.tsx`)
- Sidebar **dois modos**: completa 264px (≥ `lg`, 1024px) e **rail de ícones 76px**
  (< `lg`); **superfície de vidro** (`.pv-glass` — fill translúcido +
  backdrop-blur + especular no topo) sobre o canvas texturizado, borda
  direita hairline; transição `width` 200ms.
  Seções: OPERAÇÃO / TRABALHO / SISTEMA (eyebrow 10.5px faint, só no modo completo).
- No rail: rótulos ocultos, `title` nativo + `aria-label` com o nome do item, ícone
  32px centralizado (`justify-center`), seções ocultas, badge de sessões vira
  bolinha absoluta no ícone (`aria-hidden`); contador no header fica só ícone+número.
- Item: ícone chip 32px (`--pv-panel-2`, borda, radius 6px), label 13.5px/500;
  rail centraliza (`px-2`), modo completo alinha à esquerda (`lg:px-3`).
  **Ativo:** `--pv-accent-soft` + inset ring `--pv-accent-soft-border` + rótulo e ícone
  em `--pv-accent` (fundo lavanda suave, sem barra lateral).
  **Hover:** `--pv-panel-2`, ícone sobe para `--pv-panel-3`.
- Badge de sessões abertas: `--pv-success-solid` + texto branco, `pv-anim-check-pop`.
- Header 64px: **superfície de vidro** (`.pv-glass`), borda inferior hairline;
  breadcrumb crumb + nome da tela (`pv-anim-slide-right` a cada rota),
  relógio ao vivo ao centro (`xl+`), `ThemeToggle` (`components/theme-toggle.tsx`:
  lua/sol, ao lado do sininho; binário claro↔escuro, grava o tema explícito
  via `settings.set` e invalida o cache — o "Seguir o Windows" segue no select
  de Configurações) + `NotificationCenter` + chip de sessões à direita
  (chip: texto completo `xl+`, só ícone+contagem abaixo).
- Sessão isolada (`/session`) e barra de ações fixa das Configurações usam a
  mesma `.pv-glass` (nunca painéis opacos duplicando o vidro).

### Tabela (`ui/table.tsx`)
- Header: **sem preenchimento**, label 11px CAPS `--pv-faint` tracking `.08em`,
  borda inferior hairline. Linhas: hairline, `pv-row-hover` (lavanda 60% no hover).
- Wrapper `overflow-x-auto` (sempre) — scroll horizontal próprio, nunca da página.
- Células `px-3 sm:px-5`; colunas secundárias por **prioridade de viewport**:
  Clientes (Contato `lg+`, Tags/Criado `2xl+`) · Auditoria (ID `lg+`,
  Metadados `xl+`, coluna Detalhes sempre visível) · Certificados (Origem `xl+`,
  Clientes `2xl+`). Identidade (Nome/Titular) sempre visível.

### Feedback
- Toasts (sonner): herdam `--pv-panel`, bordas/tint por tipo.
- Dialog: `--pv-panel` 16px radius, overlay escuro + blur, `pv-dialog-in` spring.
- EmptyState: borda tracejada + ícone em chip accent-soft; `pv-anim-slide-up`.
- `Alert`: tint por variante + ícone Lucide; `role="alert"` só quando danger.

### Status (`components/status-badges.tsx`)
- Pills `rounded-full` 11px/600: success/warning/danger/outline — via `Badge`.

### Motion (`globals.css`, respeitando `prefers-reduced-motion`)
- Tokens: `--pv-ease-spring` `cubic-bezier(.33,1.24,.4,1)` · `--pv-ease-spring-soft`
  `(.25,1.1,.35,1)` · `--pv-ease-out-expo` `(.16,1,.3,1)` · `--pv-ease-in-out (.65,.05,.36,1)`.
- Durações: `--pv-dur-micro 120ms` · `--pv-dur-fast 160ms` · `--pv-dur-base 220ms`
  · `--pv-dur-slow 380ms` · `--pv-dur-modal 340ms`.
- Padrões: press `scale .96/.97`; listas com `pv-stagger`; entradas `pv-fade-up`;
  ícones `pv-anim-check-pop`; favoritos `pv-star-pop`; "ao vivo" `pv-live-dot`;
  páginas `pv-page-transition` na troca de rota (via `key={pathname}`).
- **Troca de tema (2026-11-13):** dissolução ("cross-fade") da janela inteira
  via View Transitions API (Chromium ≥111 / Electron) — `::view-transition-old/new(root)`
  com `animation-duration .5s` e curva ease-in-out `cubic-bezier(.45,0,.15,1)`
  (dissolução cinematográfica, meio 50/50). Disparo **só em troca efetiva** de
  tema, em `components/providers.tsx` (`ThemeSync`): montagem,
  `prefers-reduced-motion: reduce` e engines sem suporte fazem a troca
  instantânea. `useLayoutEffect` isomórfico aplica a classe `.dark` antes da
  primeira pintura (acabou o "flash" de tema errado no boot). Seletor de tema
  da página Configurações e `ThemeToggle` (header) compartilham o mesmo caminho.
- Cena de autenticação (`components/session/boot-loader.tsx` + `boot-loader.css`):
  "cofre" escuro índigo (#0e0e13→#0a0a0f), grade `rgba(133,141,255,.05)`,
  spinner duplo lavanda — tela única de espera para TODAS as autenticações.
- Banners de estado da sessão (sessions/page): erro→danger, autenticado→success,
  demais→warning — sempre via tokens, nunca cor fixa.
- Tudo respeita `@media (prefers-reduced-motion: reduce)`.

### Dark mode por classe (`@custom-variant dark`)
O Tailwind v4 por padrão amarra o variante `dark:` a `prefers-color-scheme` do SO —
diferente do seletor de tema do app (claro/escuro/sistema, toggle em Settings).
Para coerência, `globals.css` declara `@custom-variant dark (&:where(.dark, .dark *))`:
os utilitários `dark:` só valem sob `.dark` na `<html>` (aplicada pelo `ThemeSync`).

### Cascade & layers (regra de ouro desta base)
Tailwind v4 usa `@layer theme, base, components, utilities`. **Não usar regras
globais fora de camada**: elas vencem qualquer utility (especificidade
diferente não se aplica entre origens). Regras globais de elemento vivem em
`@layer base`; `.pv-*` em unlayered por ser API do design system.

## 5. Layout

- Janela Electron: 1380×900 padrão, **mínimo 768×680** (`minWidth` no main;
  reduzido em 2026-11-13 de 1024).
- Shell: sidebar 264px (≥`lg`) / **rail 76px** (<`lg`) + coluna principal; header
  64px; conteúdo `max-width: 1440px`, padding `16/24/32px` (`p-4 sm:p-6 lg:p-8`).
- Grid de cards: 2–3 colunas responsivas; stats em 3–4 col (`sm:grid-cols-2/3/4`).
  A grade de acessos usa **container queries** (`@container`, `@min-[600px]`/`@min-[1080px]`)
  porque a sidebar tem dois modos — breakpoints de viewport seriam mentirosos.
- Grids de conteúdo denso (forms da aba Aparência + letterhead 1fr/360px) vão a
  2 colunas só em `xl`; pares simples (quickcards Acessos, cards de sessão,
  dados do cliente + notas) permanecem `lg` (340px é suficiente); pares de
  formulário só em `sm+`; toolbars de busca com `basis-full` (full row) abaixo de `sm`.
- Páginas de formulário (settings): coluna `max-w-[980px]` centralizada.
- Unit base 4px; gaps 12/16/24/32; paddings de seção 24–32.
- Superfícies: canvas `--pv-bg` < painel `--pv-panel` < `--pv-panel-2` < `--pv-panel-3`.

## 6. Profundidade

| Nível | Claro | Escuro |
|---|---|---|
| 0 — canvas | `#f6f6f8` (sem sombra) | `#17171f` (sem sombra) |
| 1 — card | `#ffffff` + `--pv-shadow-sm` | `#1f1f27` + hairline |
| 2 — raised/hover | `--pv-shadow-md` | `#26262f` + hairline forte |
| 3 — overlay/top | `--pv-shadow-lg` | `#2d2d38` + `--pv-shadow-lg` |
| Focus | `outline 2px accent + offset 2px` | idem |

- No escuro a profundidade vem da **ladder**, não de sombras (bordas metálicas);
  o canvas carrega profundidade própria (mesh + grain + véu de vidro com
  especular de 1px no topo) — nunca replicar isso em área interna de conteúdo.
- O vidro (`.pv-glass`) é reservado às superfícies de **função** (navegação e
  barras de ação fixas): logo acima do canvas texturizado, abaixo dos painéis.
- No claro, sombras de baixa opacidade (≤ 0,13) em camadas (`--pv-shadow[...]`).
- Cards elevam **só** sombra/borda — nunca `translateY` permanente. O card de
  acesso (`pv-access-card`) nem sequer usa isso: a elevação é **tonal**
  (`--pv-access-fill` → `-hover` → `-active`), a única exceção deliberada ao
  padrão de sombra — linguagem Mercury (profundidade como cor, não como sombra).

## 7. Do's e Don'ts

**Do**
- Usar exatamente os tokens `--pv-*` (nada de hex literal em tsx novo).
- Accent lavanda apenas em CTA, foco, nav-ativo, links e identidade gov.br.
- Hierarquia por ladder + hairline; sombras sutis só no claro.
- Radii: 8px controles, 12px cards, 16px painéis grandes/diálogos; status = pill.
- Números/tabelas com `.pv-num`; rótulos 11px CAPS com tracking.
- `prefers-reduced-motion` sempre respeitado; motion contido (≤ 380ms).
- Contraste ≥ 4,5:1 texto secundário; ≥ 7:1 primário.

**Don't**
- Não introduzir segundo acento decorativo (laranja, rosa, verde "só de enfeite").
- Não usar `#000` no canvas nem `#fff` puro em painéis do claro.
- Não usar `transition-all` (sempre propriedades explícitas) nem `outline-none`.
- Não usar regras globais sem camada (`@layer base` apenas).
- Não pintar fundo de seção inteiro com lavanda; soft tints apenas (exceção:
  os fills tonais dos cards da tela Acessos — ver §2/§4 — são componentes, não seção).
- Não "levantar" cards no hover (border + sombra apenas).
- **Acessos:** nunca borda/sombra de repouso no card (o fill separa), nunca duas
  ações sólidas, nunca nome de portal em peso ≥ 600, nunca badge para o que é
  texto quiet (origem/automação).
- Não usar branco sobre `--pv-accent` translúcido — sempre `--pv-on-accent` sobre `--pv-accent-solid`.
- Não dar `backdrop-filter` a painéis, cards, tabelas ou dialogs (vidro só nas
  superfícies de função via `.pv-glass`); não usar mesh fora de lavanda→índigo;
  não animar grain/mesh/véu (sempre estáticos); não remover o hairline estrutural
  da sidebar/header (o especular é enfeite, não fronteira).

## 8. Responsividade

- **Alvo real:** Electron desktop. Largura mínima **768px** (janela 768×680,
  2026-11-13). Telas fluidas até ultrawide (conteúdo limita em 1440px).
- **< 1024px (Compacto):** sidebar = **rail de ícones 76px** (rótulos ocultos,
  `title`+`aria-label`, seção eyebrows ocultas, badge de sessões como bolinha
  no ícone); relógio oculto; chip de sessões no header só ícone+contagem;
  breadcrumb sem nome do app (`sm-`); padding de conteúdo 16px; PageHeader
  compacto (padding 14px, ícone 36px, h1 17px); tabelas por prioridade de
  coluna (seção 4); tabs de Obrigações com scroll horizontal
  (`nowrap`+`overflow-x-auto`, antes `flex-wrap`); toolbars de busca full-row abaixo de `sm`.
- **≥ 1024px (Padrão):** sidebar completa 264px; relógio segue oculto até `xl`;
  padding 24px.
- **≥ 1280px (Amplo):** relógio visível (`xl`); Contato/ID visíveis; padding 32px.
- **≥ 1536px (Máximo) / ≥ 2xl:** Tags/Criado (Clientes), Clientes (Certificados)
  visíveis.
- **Em 1440×900:** grid de acessos = 2–3 colunas conforme a largura do
  container (container query); stats 3–4 col.
- **Diálogos:** `w-[calc(100vw-2rem)]` + `max-h-[92vh]` + footer empilhado
  (`flex-col-reverse`) — intactos; funcionam em 768px (verificado com shots
  reais em 768×640: Novo cliente, Novo acesso, Detalhes do evento).
- **Sessões isoladas (`/session`):** header chrome (`overflow-x-auto`,
  "Credencial manual" icon-only abaixo de `lg`), barra de URL e tiras com
  scroll horizontal próprio; janelas ≥ 860px.
- Safe areas, zoom mínimo, touch 44px: aplicáveis só como piso de robustez CSS
  (Electron é desktop); item do rail = 52px de altura (py-2.5 + ícone 32px).
- Console limpo em todas as rotas (768/1024/1280/1440) — verificado;
  `prefers-reduced-motion` desabilita a transição `width` do rail.
- Media queries do Tailwind medem a **área de conteúdo**, não o frame da janela
  (a ~16px de moldura no Windows, uma janela de 1024px tem viewport ~1008px —
  por isso "1024×680" exibe o rail; correto por design).

## 9. Prompt Guide (para agentes/devs)

Ao estender o sistema:

1. **Antes de criar componente:** verifique `src/components/ui/*` e `ui/primitives.tsx`.
   Reutilize `Button`, `Card`, `Badge`, `EmptyState`, `Alert`, `Field`, `Toolbar`,
   `StatCard`, `SectionTitle`, `SkeletonGrid`.
2. **Cor:** escolha o token mais semântico (`--pv-accent-soft` para item ativo,
   `--pv-warning-soft` para estado), nunca hex.
3. **Texto destrutivo:** `text-[var(--pv-danger)]` + `pv-danger-surface` em blocos;
   fill só via `--pv-danger-solid`.
4. **Foco:** nunca remover outline; o anel global cobre tudo. Inputs usam ring lavanda.
5. **Animação nova:** declarar keyframes no `globals.css` com `prefers-reduced-motion`
   respeitado; usar `pv-anim-*` existentes antes de criar novos.
6. **Novo asset de tema:** sincronizar `:root` e `.dark` — os dois temas são obrigatórios.
7. **Canvas/vidro:** nunca adicionar `backdrop-filter` a painéis, cards, tabelas
   ou dialogs; vidro só nas superfícies de função (sidebar/header/barras fixas)
   via `.pv-glass`. Grain/mesh são estáticos — não animar. Hex literais de
   textura vivem só em `globals.css` (tokens `--pv-mesh`, `--pv-veil-*`,
   `--pv-grain-*`, `--pv-glass-*`); nunca `#000` no canvas nem mesh fora de
   lavanda→índigo (um único acento cromático).
8. **Ícones:** Lucide (`lucide-react`), 18–20px, `strokeWidth` padrão, `aria-hidden="true"`
   quando decorativos; `aria-label` em botões só-ícone.
9. **Verificação:** `npm run build` → `out/` + `dist-electron/`; screenshots em
   768×640, 1024×680, 1280×800, 1440×900 (`.preview/responsive-shots.mjs`,
   dados reais via IPC); `npm run typecheck`; `npm test`; console limpo.

---

*Versão do sistema: 1.5.0 — revisado em 2026-11-13 (canvas: dark elevado
`#17171F` + ladder re-medida; textura mesh+grain nos dois temas; líquido
"liquid glass" iOS 26 em repouso — véu + especular de 1px; `.pv-glass`
(backdrop-blur) na sidebar/header/sessão/barra fixa; paleta clara intacta;
`ThemeToggle` no header, ao lado do sininho; troca de tema com dissolução
via View Transitions, sem flash de tema no boot).*
*Referências de linguagem: Linear (awesome-design-md) + Mercury (awesome-design-md, só a tela Acessos). Sem afiliação a marcas.*
