# ADR 0005 — Tratamento de segredos, revelação e cópia

- **Status:** Aceita
- **Data:** 2026-11-04
- **Decisores:** Equipe AurumBit Portal

## Contexto

Além de cifrar segredos em repouso, o produto precisa lidar com o momento em que a senha é exibida ou copiada. Uma senha revelada pode ficar visível na tela, na área de transferência ou em logs. A auditoria precisa registrar o uso sem registrar o valor. O autofill também não pode enviar o formulário sem ação do usuário.

## Decisão

- **Mascaramento por padrão.** Senhas são exibidas como bullets até uma revelação explícita.
- **Revelação temporária.** A API `credentials.reveal` retorna a senha com `expiresAt` calculado por `passwordRevealSeconds` (3 a 120 s). A UI deve ocultar o valor ao expirar.
- **Cópia com limpeza.** `credentials.copy` grava a senha na área de transferência e agenda a limpeza após `clipboardClearSeconds` (5 a 300 s). A limpeza só ocorre se o conteúdo ainda for o valor copiado, para não apagar algo que o usuário copiou depois.
- **Throttle.** Revelação e cópia têm intervalo mínimo de 800 ms por credencial para reduzir automação acidental ou abusiva.
- **Auditoria sem segredo.** Eventos `credential.revealed` e `credential.copied` registram apenas id, motivo e tempo de limpeza. Valores nunca entram na auditoria.
- **Redaction.** Logs e metadados passam por `redactRecord`, que remove chaves como `password`, `senha`, `secret`, `token`, `pfx`, `p12`, `privateKey`, `authorization`, `cookie`, `credential` e `pin`, além de redigir URLs com parâmetros sensíveis e blobs/PEM.
- **Impressão digital de reutilização.** Para detectar senhas repetidas, o aplicativo calcula HMAC-SHA-256 com uma chave derivada da chave-mestra. O hash não permite recuperar a senha e não é um hash global comparável entre instalações.
- **Envio manual.** Receitas preenchem campos, mas `autoSubmit` é `false` por padrão. Captcha, MFA e envio final exigem ação humana.
- **Sem PIN.** Pedidos de senha de certificado A3 são recusados e logados sem o valor.

## Consequências

**Positivas**

- Reduz a janela de exposição de senhas na tela e na área de transferência.
- A auditoria permite investigar uso indevido sem se tornar um repositório de segredos.
- A detecção de reutilização funciona localmente sem expor a senha.
- O fluxo assistido evita automação cega de login e reduz risco de bloqueio de conta.

**Negativas**

- A área de transferência é compartilhada com outros aplicativos; durante a janela de cópia, qualquer processo pode lê-la.
- A limpeza programada não funciona se o aplicativo for encerrado antes do timer, e o conteúdo pode permanecer.
- A revelação temporária depende da UI; a API entrega o valor ao renderer, que é confiável, mas não imune a comprometimento do processo.
- O usuário pode colar a senha em outro lugar antes da limpeza.
- A impressão digital detecta igualdade, não qualidade ou vazamento da senha.

## Alternativas consideradas

1. **Nunca revelar senhas.** Mais seguro, mas inviável para portais que exigem digitação manual ou para suporte ao usuário.
2. **Cópia sem limpeza automática.** Pior para o usuário e para o risco de exposição.
3. **Salvar segredos no Windows Credential Manager.** Reduziria a exposição no banco, mas não resolveria a revelação/cópia e complicaria backup e migração.
4. **Registrar valores cifrados na auditoria.** Rejeitado: amplia o impacto de um vazamento e cria um segundo cofre a proteger.
