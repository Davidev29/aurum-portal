# AurumBit Portal — Sistema de cor (light / dark)

Estudo de colorimetria aplicado a `src/app/globals.css` e aos primitivos em `src/components/ui/*`.

## Princípios

- **Texto ≥ 4.5:1 em qualquer fundo, ≥ 7:1 para texto principal** (WCAG 2.2 AA).
- **Neutros dessaturados (croma ≤ 15%)** — sem brilho cromático e sem fadiga; saturação só em ação/estado.
- **Sem preto/branco puro** — reduz brilho e contraste agressivo; texto levemente azulado, fundo levemente quente/frio.
- **Hierarquia monotônica** (sempre clareando ao elevar): `bg < panel < panel-2 < panel-3`.
- **Destrutivo não é só cor**: `font-bold` + tint + borda + anel — legível à distância e sem depender de daltonismo.

## Tokens (CSS vars)

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--pv-bg` | `#F4F5F7` | `#0A0D13` | fundo da app |
| `--pv-panel` | `#FFFFFF` | `#10141E` | superfície base |
| `--pv-panel-2` | `#F8F9FB` | `#161C2A` | elevação 1 / hover / footer |
| `--pv-panel-3` | `#EDF0F4` | `#1C2438` | elevação 2 / inset |
| `--pv-border` | `#E2E6ED` | `#1F2A3F` | divisórias |
| `--pv-border-strong` | `#C6CFDD` | `#2F3D5A` | inputs / foco hover |
| `--pv-text` | `#0F1B2D` | `#E8EBF1` | texto principal (≥ 12:1) |
| `--pv-muted` | `#475569` | `#A8B4C8` | suporte (≥ 6:1) |
| `--pv-faint` | `#5B6B82` | `#8B9AB3` | metadados (≥ 4.5:1) |
| `--pv-accent` | `#2B4BC8` | `#8AA0F5` | **só texto/links** sobre fundo escuro ou claro — nunca fundo com branco |
| `--pv-accent-solid` | `#243C9E` | `#4066E6` | **fundo sólido com texto branco** (botão, nav ativa, avatar) — branco sobre 9.5:1 / 4.9:1 |
| `--pv-accent-solid-hover` | `#2B4BC8` | `#4466E0` | hover do sólido (branco segue ≥ 4.9:1) |
| `--pv-accent-2` | `#0F766E` | `#5FC6B4` | teal secundário (texto) |
| `--pv-accent-soft` | `#EAF0FE` | `rgba(138,160,245,.14)` | tint (texto escuro/claro por cima, nunca branco) |
| `--pv-success` | `#15803D` | `#6EE7B7` | ok **texto** |
| `--pv-success-solid` | `#15803D` | `#15803D` | fundo com branco (pill de contagem) |
| `--pv-warning` | `#B45309` | `#FCD34D` | atenção **texto** |
| `--pv-danger` | `#B91C1C` | `#FCA5A5` | destrutivo **texto** (sempre bold) |
| `--pv-danger-solid` | `#991B1B` | `#991B1B` | fundo com branco (botão destrutivo) |
| `--pv-info` | `#1D4ED8` | `#93C5FD` | info **texto** |

> **Regra de ouro:** tons claros do dark (`#8AA0F5`, `#6EE7B7`, `#FCA5A5`) são **só para texto sobre fundo escuro**. Nunca use como fundo com `text-white` — branco sobre `#8AA0F5` dá ~2.5:1 (falha). Para fundo + branco use `*-solid` (escuro nos dois temas).

Escala `brand` refinada (`@theme`): `50 #EEF3FF … 600 #2B4BC8, 700 #243C9E, 800 #22327C, 900 #1F2F60`.

### Tabelas de contraste (WCAG)

| Par | Razão |
|---|---|
| `--pv-text` sobre `--pv-panel` (light / dark) | ~14:1 / ~12:1 — AAA |
| `--pv-muted` sobre `--pv-panel` (light / dark) | ~7.5:1 / ~7:1 — AAA |
| `--pv-faint` sobre `--pv-bg` (light / dark) | ~4.9:1 / ~5.2:1 — AA |
| Branco sobre `--pv-accent-solid` / `--pv-danger-solid` / `--pv-success-solid` | 9.5:1 / 4.9:1, ~8:1, ~5.1:1 — AA/AAA |
| `--pv-danger` sobre `--pv-danger-soft` (light / dark) | ~6:1 / ~6.5:1 — AA+ |
| `--pv-success` / `--pv-warning` sobre soft (light / dark) | ≥ 5:1 / ≥ 6:1 — AA |

> Todos os pares acima passam em AA (4.5:1). Ícones/bordas exigem 3:1 — todos têm folga.

## O que mudou

- `globals.css`: novo sistema completo; antes era `#EDF1F8/#070F1D` (azul demais), `--pv-faint` #8A9AB5 (~2.3:1 — falhava), hierarquia invertida no dark (`panel-2` mais escuro), sem tokens dark para sucesso/aviso/perigo, e gradientes radiais saturados (3 cores) causando fadiga. Agora: fundo suave, 1 wash sutil por tema, sombras dessaturadas, utilitários semânticos `.pv-text-danger/.pv-error/.pv-danger-surface`, Sonner themado, placeholder e foco acessíveis.

- `button.tsx`: gradiente `brand-600→700` trocado por sólida legível (`--pv-accent-solid` / `--pv-danger-solid` com branco); `destructive` ganhou `font-bold` + anel de perigo; `soft/link` usam `--pv-accent` como texto (não cinza).

- `badge.tsx` / `alert.tsx` / `primitives.tsx`: saíram de `slate/emerald/red/amber-*` fixos e passaram a `--pv-*-soft/-border` — mesmo hue, contraste garantido nos dois temas; `danger` sempre bold.

- `input/select/switch/dialog`: foco via `--pv-ring`/`--pv-accent`, track de `slate-300/700`, overlay via `--pv-overlay`, progresso via `--pv-accent`.

- `app-shell.tsx` / `page-header.tsx`: ativo sem gradiente, pill de sessão com `--pv-success`, botão “Bloquear” com `.pv-danger-surface` (realce destrutivo imediato).

- `providers.tsx`: `Toaster richColors=false` para não introduzir cores neon fora do sistema.

## Elegância e conforto

- Azul governamental profundo e dessaturado (`#2B4BC8`) em vez de azul elétrico; teal `#0F766E` em vez de ciano neon.
- Tons pastel de estado só no dark (`300`), tons fortes só no light (`700`) — pastel no light falha, forte no dark falha; a regra resolve.
- Sombra `rgba(15,23,42,0.06)` neutra, não preta; hover desloca 2px sem alterar cor do texto.
- Focus ring 3px com 25–32% de opacidade (3:1 sobre o fundo) — visível sem gritar.

## Migração futura (páginas)

Páginas ainda usam `text-red-600 dark:text-red-400` etc. — **aceitável hoje** (são os mesmos tons 600/300 aprovados). Preferir `--pv-*` em novos textos (`text-[var(--pv-danger)]` ou `.pv-text-danger`) para acompanhar o tema automaticamente sem `dark:` duplicado.

## Arquivos

- `src/app/globals.css` — tokens + utilitários
- `src/components/ui/{button,badge,alert,input,primitives,select,switch,dialog,empty-state}.tsx`
- `src/components/{app-shell,page-header,providers}.tsx`
