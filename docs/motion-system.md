# AurumBit Portal — Sistema de movimento (micro-interações sutis)

## Objetivo
Dar à aplicação um efeito **elástico contido**: toda transição — menu, modal,
botão, página, toast — responde com um **overshoot mínimo** (~2%), sem nunca
"pular". O movimento comunica estado (hover, pressionado, aberto, ativo) sem
parecer cartoon, e cada elemento interativo dá o mesmo feedback táctil de
compressão ao ser pressionado.

Princípios:
- **Hover estável**: nada desloca no hover (só sombra/borda/cor). O "levantamento"
  dos cards foi removido em favor de sombra — leitura tabular e grids ficam estáveis.
- **Press compartilhado**: todo `<button>`/`[role='button']` comprime `scale: 0.96`
  ao pressionar (120 ms `ease-out-expo`), usando a propriedade individual `scale`
  — compõe com `transform` sem conflitos.
- **Spring contido**: usado apenas em entradas (página, modal, toast, menus) e
  sempre com curvas de overshoot baixo; nunca como resposta a clique (clique =
  compressão seca + ripple).

## Curvas e durações (tokens)
```css
--pv-ease-spring:      cubic-bezier(0.33, 1.24, 0.40, 1)  /* overshoot contido (~2%) */
--pv-ease-spring-soft: cubic-bezier(0.25, 1.10, 0.35, 1)  /* entradas grandes */
--pv-ease-out-expo:    cubic-bezier(0.16, 1, 0.30, 1)     /* press/sombra/saídas */
--pv-ease-in-out:      cubic-bezier(0.65, 0.05, 0.36, 1)  /* shake */
--pv-dur-micro: 120ms  /* press (scale) */
--pv-dur-fast:  160ms  /* micro-estados */
--pv-dur-base:  220ms  /* menus, chips, tabs */
--pv-dur-slow:  380ms  /* página, toast, stagger */
--pv-dur-modal: 340ms  /* abertura de modal */
```
Tempo ideal: 120–380 ms. Acima de 400 ms o app parece lento; abaixo de 100 ms
não se percebe o easing.

## Feedback táctil (pressionar)
| Elemento | Press |
|---|---|
| Qualquer `button` / `[role='button']` | `scale: 0.96` em 120 ms |
| `.pv-btn` (botões) | `scale: 0.97` + `brightness(0.96)` (e ripple) |
| `.pv-icon-btn` (só ícone) | `scale: 0.88` |
| `.pv-pressable` (chips, tabs) | `scale: 0.98` |
| `.pv-nav-link` (menu lateral) | `scale: 0.98` |
| `.pv-lift` (cards) | `scale: 0.99` |
| `.pv-toast` | `scale: 0.98` |

Troca de tema nunca anima o press; `prefers-reduced-motion: reduce` zera
durações de animação e transição globalmente.

## Padrões aplicados em todas as telas

### 1. Botões (`src/components/ui/button.tsx` + `.pv-btn`)
- Base: `position:relative; overflow:hidden; isolation:isolate`.
- **Hover**: nada se desloca — só cor/borda/sombra + brilho (`::before` sweep
  `pv-shine`) e `brightness(1.04)`.
- **Active/click**: comprime `scale: 0.97` + `brightness(0.96)` em 120 ms —
  resposta seca, sem overshoot.
- **Ripple**: clique injeta `<span class="pv-ripple">` na posição do cursor
  (escuro em variantes claras, claro em sólidas). Ver `handleMouseDown`.
- **Icon buttons** (ghost/size icon): `.pv-icon-btn` — hover só muda
  cor/fundo; press comprime a 0.88.

### 2. Menus — navegação lateral (`.pv-nav-link`)
- Hover: somente cor/fundo; indicador esquerdo cresce em altura
  (0 → 20 px em 220 ms spring-soft).
- Ativo: indicador fixo (22 px) + `is-active`. Press comprime a 0.98.

### 3. Transição de páginas (`AppShell` + `.pv-page-transition`)
- `key={pathname}` remonta o conteúdo a cada navegação.
- `pv-page-in`: sobe 12 px entrando com `.997` de escala → 1 (380 ms
  `spring-soft`). Sem overshoot no meio.
- Grades e listas usam `.pv-stagger-spring` (cascata 45 ms, pop-in suave).
  Tabelas usam `.pv-row-hover` (tint suave, sem deslocamento).

### 4. Modais — abertura e fechamento (`Dialog` / `AlertDialog`)
- Overlay: fade 220 ms (abre) / 180 ms (fecha) via `.pv-overlay[data-state]`.
- Conteúdo `.pv-dialog[data-state=open]`: `pv-dialog-in` — entra de
  `scale .94 + translateY 10px + blur(1px)` → 1 (340 ms `spring-soft`).
  Fecha com `pv-dialog-out` (scale .94, 180 ms). Sem pico de escala.
- Botão fechar é `.pv-icon-btn` (compressão no press).

### 5. Menus flutuantes (`.pv-floating`)
Dropdowns/Popovers/Selects (Radix): `pv-pop-in` 220 ms spring-soft, origem
`var(--radix-popper-transform-origin)`. Fechamento: fade 120 ms.

### 6. Tabs (`.pv-tabs-content`)
Conteúdo ativo entra com `pv-slide-in-up` 280 ms `spring-soft`. Triggers usam
`.pv-pressable` — hover sem deslocamento, press comprime a 0.98.

### 7. Formulários
- Inputs/Selects: hover apenas borda-acento (sem salto), foco = anel + sombra.
  Campos de erro entram com `pv-anim-slide-up`.
- Switch: trilha muda cor em 200 ms; thumb desliza com `ease-out-expo`
  (sem bounce).
- Checkbox: check aparece com `.pv-anim-check-pop` (pico 1.12).
- Badge: transição de transform em `ease-out-expo` — sem tremida no hover.

### 8. Cartões e superfícies (`.pv-lift` / `.pv-surface-hover`)
Hover sem deslocamento; só sombra/borda. Press comprime 0.99 ("papel").
O card de serviço (`.pv-service-card`) é a exceção deliberada: hover sobe 5 px
com `cubic-bezier(0.25, 1, 0.5, 1)` e active volta para 0.985/`translateY(-2px)`.

### 9. Toasts (Sonner)
Entrada `pv-toast-in` (380 ms `spring-soft`), press `scale .98`, saída
`pv-toast-out` (140 ms). Definido no CSS global — vale para todos os toasts.

### 10. Favorito / ícones de estado
Estrela usa `.pv-anim-heart-pop` (pico 1.15 + rotate −6°). Badges e checks
usam `.pv-anim-check-pop` (pico 1.12).

## Utilitários rápidos (globals.css)
| Classe | Uso |
|---|---|
| `.pv-page-transition` | container da página (tempo de rota) |
| `.pv-anim-pop / -scale / -slide-up/-left/-right` | entradas genéricas |
| `.pv-stagger-spring` | grade com cascata 45 ms |
| `.pv-pressable` | chip, linha clicável, tab trigger |
| `.pv-lift` | card clicável / hover sombra |
| `.pv-icon-btn` | botão só-ícone |
| `.pv-btn` (via `Button`) | botões com shine+ripple |
| `.pv-nav-link` | item de menu lateral |
| `.pv-floating` | Radix dropdown/popover |

Helpers TS em `src/lib/motion.ts`: `motion` (tokens) + `attachRipple()`.

## Acessibilidade e performance
- `prefers-reduced-motion: reduce` zera durações (regra já existente).
- Apenas `transform/opacity/box-shadow/scale` são animados — sem reflow.
- Foco visível (`:focus-visible`) mantém anel — nunca removido.
- Ripple e shine são `pointer-events:none` e removidos após 550 ms.
- Linhas de tabela e inputs de texto **não** comprimem — preserva densidade e
  a posição do cursor.
