# AurumBit Portal — Sistema de movimento (micro-interações elásticas)

## Objetivo
Dar à aplicação um efeito **elástico elegante**: toda transição — menu, modal,
botão, página, toast — responde com leve overshoot (spring), sem parecer
cartoon. O movimento comunica estado (hover, pressionado, aberto, ativo) e
manteve o contexto visual durante trocas de tela.

## Curvas e durações (tokens)
```css
--pv-ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1)  /* overshoot p/ cliques */
--pv-ease-spring-soft: cubic-bezier(0.22, 1.36, 0.36, 1)  /* entradas de página/modal */
--pv-ease-out-expo:    cubic-bezier(0.16, 1, 0.30, 1)     /* saída / sombra */
--pv-dur-micro: 120ms  /* hover/press */
--pv-dur-fast:  160ms  /* micro-estados */
--pv-dur-base:  220ms  /* menus, chips, tabs */
--pv-dur-slow:  380ms  /* página, toast, stagger */
--pv-dur-modal: 340ms  /* abertura/fechamento de modal */
```
Tempo ideal: 120–380ms. Acima de 400ms o app parece lento; abaixo de 100ms
não se percebe o spring.

## Padrões aplicados em todas as telas

### 1. Botões (`src/components/ui/button.tsx` + `.pv-btn`)
- Base: `position:relative; overflow:hidden; will-change:transform`.
- **Hover**: sobe 1px (`translateY(-1px)`), sombra cresce, ícone desloca +1.5px
  e escala 1.08 (`.pv-btn svg`).
- **Shine**: brilho transversal (`::before` sweep `pv-shine`) no hover.
- **Active/click**: afunda (`translateY(1px) scale(0.96)` em 80ms) — sensação
  de tecido, não de botão rígido.
- **Ripple**: clique injeta `<span class="pv-ripple">` na posição do cursor
  (escuro em variantes claras, claro em sólidas). Ver `handleMouseDown`.
- **Icon buttons** (ghost/size icon): `.pv-icon-btn` — ícone faz pop
  (`scale 1.18 rotate -4deg` no hover), botão comprime a 0.88 ao pressionar.

### 2. Menus — navegação lateral (`pv-nav-link`)
- Item desliza +4px no hover com spring, indicador esquerdo cresce em altura
  (0 → 20px em 220ms spring), ícone dá pop (`scale 1.12 rotate -4deg`).
- Ativo: indicador fixo (22px) + `is-active`. Badge de sessões usa
  `pv-anim-check-pop`.
- Caminho (breadcrumb) usa `pv-anim-slide-right` a cada troca de rota.

### 3. Transição de páginas (`AppShell` + `.pv-page-transition`)
- `key={pathname}` remontra o conteúdo a cada navegação.
- Animação `pv-page-in`: sobe 14px com leve overshoot (`scale 1.002` no
  meio), entra pela curva `spring-soft` em 380ms.
- Grades e listas usam `.pv-stagger-spring` (45ms entre itens, pop com
  overshoot 1.03). Tabelas usam `.pv-row-hover` (tint suave, sem deslocamento
  para não quebrar leitura tabular).

### 4. Modais — abertura e fechamento (`Dialog` / `AlertDialog`)
- Overlay: fade 220ms (abre) / 180ms (fecha) via `.pv-overlay[data-state]`.
- Conteúdo `.pv-dialog[data-state=open]`: `pv-dialog-in` — entra de `scale .92 +
  translateY 14px + blur 2px`, passa por `scale 1.015` e assenta em 1.0
  (340ms spring). Fecha com `pv-dialog-out` (scale .94, 180ms).
- Botão fechar é `.pv-icon-btn` (gira no hover via pop do ícone).
- `animate={false}` mantém comportamento atual para modais de progresso
  (conteúdo mutável não deve reanimar).

### 5. Menus flutuantes (`pv-floating`)
Dropdowns/Popovers/Selects (Radix): `pv-pop-in` 220ms spring origin
`var(--radix-popper-transform-origin)`. Fechamento: fade 120ms.

### 6. Tabs (`pv-tabs-content`)
Conteúdo ativo entra com `pv-slide-in-up` 280ms spring-soft. Triggers são
`pv-pressable` (sobem 1px no hover, comprimem no clique).

### 7. Formulários
- Inputs/Selects: hover apenas borda-acento (sem salto), foco = anel + sombra
  md, clique comprime levemente (`scale .99`). Erros de campo entram com
  `pv-anim-slide-up`.
- Switch: trilha muda cor em 200ms spring; thumb desliza com overshoot.
- Checkbox: quadrado comprime a .9 no clique; check aparece com
  `pv-anim-check-pop`.

### 8. Cartões e superfícies (`.pv-lift` / `.pv-surface-hover`)
`pv-lift` (Card, StatCard, ServiceCard, QuickCard, sessões): sobe 3px e
escurece borda no hover (220ms spring), volta com scale .99 no clique.
Usado em Store, Sessões, Clientes e Certificados — qualquer `Card` já herda.

### 9. Toasts (Sonner)
Entrada `pv-toast-in` (380ms spring-soft, sobe 12px de .92), pressão
`scale .98`, saída `pv-toast-out`. Definido no CSS global — vale para todos
os `toast.success/error` da app.

### 10. Favorito / ícones de estado
Estrela de favorito usa `.pv-anim-heart-pop` (scale 1.25 + rotate -8deg);
`Badge` de contadores e checks usam `.pv-anim-check-pop`.

## Utilitários rápidos (globals.css)
| Classe | Uso |
|---|---|
| `.pv-page-transition` | container da página (tempo de rota) |
| `.pv-anim-pop / -scale / -slide-up/-left/-right` | entradas genéricas |
| `.pv-stagger-spring` | grade com cascata 45ms |
| `.pv-pressable` | chip, linha clicável, link-botão |
| `.pv-lift` | card clicável / hover elevado |
| `.pv-icon-btn` | botão só-ícone |
| `.pv-btn` (via `Button`) | botões com shine+ripple |
| `.pv-nav-link` | item de menu lateral |
| `.pv-floating` | Radix dropdown/popover |

Helpers TS em `src/lib/motion.ts`: `motion` (tokens) + `attachRipple()`.

## Acessibilidade e performance
- `prefers-reduced-motion: reduce` zera durações (regra já existente).
- Apenas `transform/opacity/box-shadow` são animados — sem reflow.
- Foco visível (`:focus-visible`) mantém anel + leve scale; nunca removido.
- Ripple e shine são `pointer-events:none` e removidos após 550ms.

## Como estender
1. Novo cartão clicável: `className="pv-lift …"`.
2. Novo botão custom: use `<Button>` (já tem tudo) ou envolva com `.pv-pressable`.
3. Nova entrada de lista: envolva com `.pv-stagger-spring` ou aplique
   `.pv-anim-slide-up` no item.
4. Novo modal: use `DialogContent`/`AlertDialogContent` — já animam.
