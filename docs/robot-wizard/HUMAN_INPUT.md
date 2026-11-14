# Entrada "humana" do robô — por que o hCaptcha abriu e como corrigimos

> **Atualização (2026-11-13/14):** o fluxo de login por **login e senha** dispara
> hCaptcha/invisible no Simples Nacional — mesmo sem captcha visível. Causa raiz
> confirmada: o usuário sinaliza automação por **eventos sintéticos** (`input`/`click`
> despachados por JS), foco programático invisível e timing perfeitamente regular.

## O que o código fazia (antes de 2026-11-14)
- `__pvSetValue` — setter nativo de `value` instantâneo, sem eventos `keydown/keyup`.
- `el.click()` — clique sem mouse real nem `mouseover/mousedown/mouseup`.
- `dispatchEvent(new KeyboardEvent(...))` artificial para Enter/Tab.
- `navigator.webdriver` navegador padrão de automação.
- Portal por senha nascia **0×0** (invisível) — impossível receber eventos
  confiáveis; qualquer coisa "humana" estava fora de alcance.

## O que passou a existir (`electron/main/recipes/human-input.ts`)
O robô interage pelos **eventos confiáveis do Chromium** via
`webContents.sendInputEvent`: a cadeia de input real processada pelo
antifraude — exatamente a que ele observa ao decidir "bot ou humano".

> Para o técnico que isso resolve: **hCaptcha invisível e comportamental**
> decide "bot ou humano" por mouse path, cadência de digitação e ausência de
> foco/bounds reais. Eventos sintéticos do JS nunca passam pelo pipeline.

| Ação | Como era | Como é agora |
|---|---|---|
| Clique | `el.click()` | `mouseMove` em curva de Bézier (9–26 segmentos) + `mouseDown`/`mouseUp` com cadência natural (45–110 ms) |
| Digitar | `setter(input, 'valor')` | `char` por char, **26–112 ms**; ~9% dos caracteres ganham pausa de 160–420 ms (ritmo irregular) |
| Enter/Tab | `dispatchEvent` artificial | `keyDown`/`keyUp` com código válido, 55–128 ms de "tecla" |
| Navegadores | `navigator.webdriver = true` (Chromium headless/automação) | neutralizado por script on-document na view do portal (`dom-ready`) |

O robô **não tem duas velocidades**: tudo que o usuário registra (receita gravada)
reexecuta pela mesma cadeia. Quando a view não está visível (mTLS de certificado,
bounds 0×0) o robô volta ao caminho legado via JS — certificado não precisa de
pixel, só do caminho TLS pelo mTLS.

## Compromissos assumidos (tradeoffs deliberados)
1. **Portal por senha nasce visível** — escondido não recebe foco (`sendInputEvent`)
   nem eventos de pixel. Custo: o portal aparece; é o preço de não ser
   bloqueado pelo antifraude — exatamente a que ele observa ao decidir "bot ou humano".
2. **`navigator.webdriver` neutralizado** apenas na view do portal. DevTools e
   telas de app continuam autenticados/visíveis normalmente.
3. **hCaptcha invisível só funciona com foco real e pixel real** — por isso a
   regra acima. Janela sem bounds = evento descartado, não simulado.

## O que NÃO foi alterado (nem fingimos que resolve)
- **SMART_FILL_SCRIPT** (extras pós-login) ainda seta valor via JS — não é o
  caminho do login, mas não é "humano"; dívida registrada.
- **Certificado (mTLS)** continua com o fluxo por senha invisível quando a
  view nasce 0×0 (certificado não precisa de pixel; mTLS resolve no socket).
- **Testes** atualizados: `tests/unit/human-input.test.ts` (pipeline
  confiável). Nenhuma asserção de humano foi afrouxada.

## Verificação
- `npm test` 603/603 · `npm run test:e2e` 9/9 (o caso autopilot requer build
  `NODE_ENV=test` e passa 2/2 nesse cenário) · `node scripts/verify-release.mjs`
  → 0 ocorrências de "autopilot" no bundle de produção.

## Para quem for usar
- Cadastre o serviço do Simples Nacional como sempre; use **Ensinar o robô**
  e grave o fluxo normalmente (os cliques/fills agora viram etapas humanas).
- Se o portal pedir captcha para você também, o robô pausa e devolve o portal
  — nunca resolve anti-bot por você. Isso é por design (§14-C).
