# Guia de suporte — Gravação Assistida do robô de login

Este documento é para quem dá suporte ao operadores do AurumBit Portal. O fluxo de
produto está descrito em `docs/robot-wizard/ENGINEERING_PLAN.md` (o plano técnico).

## O que é

O usuário cadastra um acesso (nome, endereço, como entra) e, se quiser, **ensina** o
login uma única vez. O app abre o portal, observa cliques/campos e compila uma
**receita** determinística daquele serviço — com prioridade sobre o preenchimento
inteligente automático.

## Quando usar

- O site não funciona bem com a automação automática (botão de entrada raro, formulário
  em etapas, portal próprio de prefeitura...).
- O usuário quer maior acertividade no login de um portal específico.

## Passo a passo (o que a tela mostra)

1. **Novo acesso** — nome, endereço, como entra. Botão **"Salvar e continuar →"**.
2. **Etapa 2 de 3 — Ensinar o robô?** Escolha o cliente (a gravação abre o portal como
   ele) e, opcionalmente, a credencial. **[Ensinar agora]** abre o portal; **[Pular por
   agora]** fecha e mantém a automação automática (como antes).
3. **Gravando…** — o portal abre em outra janela. O usuário faz o login normalmente.
   Um contador ao vivo mostra as etapas capturadas (ex.: "Tela T2 · 7 etapas").
   - **Nunca pinte o portal com cliques do app** — a gravação é passiva.
   - Ao chegar na área logada, o app mostra **"Parece que você entrou ✓"** — é só um
     aviso; quem conclui é o usuário, clicando **Concluir gravação**.
   - Captcha/2FA: o usuário resolve na mão. O robô não driblar desafios.
   - Teto de **15 minutos** de gravação (aviso aos 10): ao fim, o que foi capturado vira
     rascunho — nada se perde. Limite de **60 etapas** por gravação.
   - **Cancelar e descartar** não salva nada.
4. **Etapa 3 de 3 — Revisão** — lista das etapas (ícone, confiança por etapa,
   tela T#), avisos e a chave **Entrar sozinho**. O usuário pode **remover etapas**
   (lixeira) antes de salvar. Avisos comuns:
   - `no-credential-bound` — nenhuma credencial vinculada; usuário/senha viram
     referências. Vincule em **Editar → Credenciais** depois.
   - `credential-mismatch` — a senha digitada não confere com a credencial salva; a
     etapa usará a credencial escolhida (nunca o valor digitado).
   - `value-not-recorded` — campo que não é usuário/senha (ex.: agência) não é gravado;
     preencher manualmente ao entrar.
   - `otp-not-recorded` — código de uma vez nunca é gravado; no replay o passo é opcional.
   - `step-cap-reached` / `recording-max-duration` — gravação parcial; remover o excesso.
5. **Salvo** — botão **Testar agora** (abre o portal real com a credencial; entra e
   detecta login — marca o robô como verificado) ou **Testar depois** (a receita fica
   como rascunho; roda normalmente na próxima abertura).

Para acessos **já cadastrados**: **Editar → Opções avançadas → Automação deste acesso →
Reconfigurar robô** (serviços personalizados; nativos mantêm
"Regenerar automação").

## Dicas de gravação

- **Não use o preenchimento automático do Chrome** — os campos não disparam o evento
  que o gravador lê. Digite como você digita hoje.
- Evite navegações supérfluas: cada documento novo vira uma tela (T1, T2…).
- Se a gravação saiu com etapas erradas, **Regravar** recomeça do zero sem perder o acesso.
- Endereços com parâmetros de sessão da URL (`cid`, `session_code`...) são limpos no
  cadastro; não cole esse tipo de URL na barra.

## O que o robô faz com isso

Na próxima abertura, o app executa as etapas gravadas (esperando a página
**estabilizar** antes de agir). Se algo não for encontrado ou a página não
estabilizar, o fluxo **pausa e devolve o portal para a pessoa** — nunca chuta.
Se o portal mudou a ponto de a primeira etapa não existir mais, o app tenta o
preenchimento inteligente como fallback **somente nesse caso**.

## Limitações honestas

- Shadow DOM fechado é inalcançável; iframes cross-origin no login não são gravados.
- A gravação em navegação com recarregamento completo pode perder eventos raros
  (mitigado com avisos de "eventos perdidos" na revisão).
- O texto visível dos botões gravados ("Entrar") é armazenado; valores de campos, não.
- Receitas gravadas nunca marcam a si mesmas como "verificadas" — só o teste real faz isso.
