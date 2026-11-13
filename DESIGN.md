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

**Resumo em uma frase:** "quiet luxury software" — canvas tinta-quase-preta com
viés índigo no escuro; canvas frio com painéis de folha branca no claro; um
único acento cromático (lavanda Linear `#5E6AD2`); hairlines de 1px e ladder de
superfícies carregam a hierarquia — nunca sombras pesadas nem arco-íris.

- **Contexto:** app de gestão contábil/gov.br (kind: software), denso e técnico,
  para profissionais que usam o sistema o dia inteiro.
- **Símbolo:** a logo AurumBit (`public/Logomarca da empresa.png`) em chip de 44px.
- **Referência de linguagem:** Linear (cool greys, single accent, motion com
  overshoot contido). Nenhuma criação é afiliada à marca Linear.
- **Adaptação da referência:** Linear é dark-first; aqui o **tema claro foi
  derivado** do `inverse-*` do Linear (canvas branco puro → substituído por um
  canvas frio `#F6F6F8` com painéis brancos) e o escuro parte de `surface-1`
  `#0F1011`, elevado para `#101014` (menos fadiga em sessões longas).
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
| `--pv-bg` | `#101014` | canvas da janela (nunca `#000`) |
| `--pv-panel` | `#17171c` | surface-1: cards, sidebar, header, dialog |
| `--pv-panel-2` | `#1d1d24` | surface-2: hover, chips, toolbar interna |
| `--pv-panel-3` | `#23232b` | surface-3: ícone ativo de seção |
| `--pv-inset` | `#0b0b0f` | poços e trilhos |
| `--pv-border` | `#25252d` | hairline 1px padrão |
| `--pv-border-strong` | `#383845` | hairline forte (inputs/hover) |
| `--pv-border-subtle` | `#1d1d24` | divisores internos |
| `--pv-text` | `#f2f2f6` | primário (≈14,8:1 no canvas) |
| `--pv-muted` | `#bec0ca` | secundário (≥ 8:1) |
| `--pv-faint` | `#8b8e99` | terciário/labels (≈4,6:1 no painel) |
| `--pv-accent` | `#a5adff` | lavanda **texto** no escuro (9,1:1) |
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
  `@min-[1080px]` — a sidebar fixa de 264px invalida breakpoints de viewport);
  gap 20px; `SkeletonGrid` permanece em sm/xl (estado de carga).
- Logos: `loading="lazy"` removido — 8 ícones de ≤ 35 KB, eager evita frame
  vazio no primeiro paint.

### Navegação (`components/app-shell.tsx`)
- Sidebar 264px, `--pv-panel`, borda direita hairline; seções: OPERAÇÃO / TRABALHO / SISTEMA
  (eyebrow 10.5px faint).
- Item: `pl-0`, ícone chip 32px (`--pv-panel-2`, borda, radius 6px), label 13.5px/500.
  **Ativo:** `--pv-accent-soft` + inset ring `--pv-accent-soft-border` + rótulo e ícone
  em `--pv-accent` (fundo lavanda suave, sem barra lateral).
  **Hover:** `--pv-panel-2`, ícone sobe para `--pv-panel-3`.
- Badge de sessões abertas: `--pv-success-solid` + texto branco, `pv-anim-check-pop`.
- Header 64px: breadcrumb crumb + nome da tela (`pv-anim-slide-right` a cada rota),
  relógio ao vivo ao centro (`xl+`), `NotificationCenter` + chip de sessões à direita.

### Tabela (`ui/table.tsx`)
- Header: **sem preenchimento**, label 11px CAPS `--pv-faint` tracking `.08em`,
  borda inferior hairline. Linhas: hairline, `pv-row-hover` (lavanda 60% no hover).

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

- Janela Electron: 1380×900 padrão, **mínimo 1024×680**.
- Shell: sidebar 264px fixa + coluna principal; header 64px sticky dentro da coluna;
  conteúdo com `max-width: 1440px`, padding 24–32px.
- Grid de cards: 2–3 colunas responsivas; stats em 3–4 col (`sm:grid-cols-2/3/4`).
  A grade de acessos usa **container queries** (`@container`, `@min-[600px]`/`@min-[1080px]`)
  porque a sidebar fixa de 264px torna breakpoints de viewport mentirosos.
- Páginas de formulário (settings): coluna `max-w-[980px]` centralizada.
- Unit base 4px; gaps 12/16/24/32; paddings de seção 24–32.
- Superfícies: canvas `--pv-bg` < painel `--pv-panel` < `--pv-panel-2` < `--pv-panel-3`.

## 6. Profundidade

| Nível | Claro | Escuro |
|---|---|---|
| 0 — canvas | `#f6f6f8` (sem sombra) | `#101014` (sem sombra) |
| 1 — card | `#ffffff` + `--pv-shadow-sm` | `#17171c` + hairline |
| 2 — raised/hover | `--pv-shadow-md` | `#1d1d24` + hairline forte |
| 3 — overlay/top | `--pv-shadow-lg` | `#23232b` + `--pv-shadow-lg` |
| Focus | `outline 2px accent + offset 2px` | idem |

- No escuro a profundidade vem da **ladder**, não de sombras (bordas metálicas).
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

## 8. Responsividade

- **Alvo real:** Electron desktop, largura mínima 1024px (janela 1380×900).
  Telas fluidas até ultrawide (conteúdo limita em 1440px).
- **1024×768:** grids 3→2 col; relógio da topbar oculto (`xl:flex`); sidebar mantida.
- **≤768 / ≤390 (somente preview web):** o export estático registra overflow; o app
  **não** é suportado abaixo de 1024px — não gastar esforço de otimização mobile nele.
- Safe areas, zoom mínimo, touch 44px: não aplicáveis (janela desktop).

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
7. **Ícones:** Lucide (`lucide-react`), 18–20px, `strokeWidth` padrão, `aria-hidden="true"`
   quando decorativos; `aria-label` em botões só-ícone.
8. **Verificação:** `npm run build:renderer` → export em `out/`; screenshot real em
   1440×900 (claro e escuro); `npx tsc --noEmit`; `npm test`; console limpo.

---

*Versão do sistema: 1.1.0 — revisado em 2026-11-13 (tela Acessos, Mercury adaptado).*
*Referências de linguagem: Linear (awesome-design-md) + Mercury (awesome-design-md, só a tela Acessos). Sem afiliação a marcas.*
