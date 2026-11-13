# Gravação Assistida — Campos nomeados, ensino sem cliente e dois passes

> Estado: **implementado (Fase 1 funcional)** — 2026-11-13 · acompanha (e aprofunda)
> `ENGINEERING_PLAN.md`. Fonte única para o que "o robô aprende" e como os dados
> fluem de ponta a ponta.

## 1. O princípio

> **O que vale para o robô é COMO o portal funciona — não de quem é o cliente.**

Criar um acesso ao portal nunca exige um cliente. O que o robô precisa aprender é:

1. **Quais telas** você enfrenta antes de chegar na área logada (telas de entrada,
   "Entrar com gov.br", intersticiais, mTLS...) — gravadas como etapas nomeadas
   (`T1`, `T2`... telas de documento), com seletores estáveis e confiança por etapa.
2. **Quais campos** o portal exige e **com que nome** (`usuário`, `senha`,
   `Código da empresa`...). Isso vira a lista de **campos nomeados** do serviço
   (`definition.fields`). Os VALORES desses campos vivem somente na credencial
   do cliente, cifrados — nunca no serviço, nunca em logs.

## 2. Modelo de dados

### 2.1 `RecipeDefinition` (aditivo, retrocompatível)

```ts
fields?: Array<{
  key: string       // estável, derivado do name/id do campo: codigo_empresa, f_inscricao_estadual
  label: string     // legível: "Código da empresa"
  kind: 'username' | 'password' | 'text'
  selector?: string // âncora diagnóstica (sem valores)
}>

certificateSteps?: RecipeStep[]  // passos da passada de CERTIFICADO
passwordSteps?: RecipeStep[]     // passos da passada de SENHA
```

Placeholders: `{{credential.username}}`, `{{credential.password}}`, `{{client.document}}`,
`{{client.name}}` **e** `{{credential.<key>}}` para os campos nomeados (ex.:
`{{credential.f_codigo_empresa}}`). A resolução acontece **somente no processo
principal**, na hora da execução, via `resolveRecipeTemplate(template, values, extraValues)`.

### 2.2 Credencial por cliente (`credentials.fields_json`, v2)

`CredentialField[]` agora carrega marcador de envelope: `{ name, kind, value?, enc?: 'aes-256-gcm' }`.

- Valores **são cifrados** na criação/atualização (AAD
  `credentials:{id}:field:{name}` com HKDF-SHA256, mesmo padrão de
  `sealCredentialPassword`). Nunca cifrar duas vezes.
- **Nada de valor (claro ou cifrado) chega ao renderer** — `mapCredential`
  devolve apenas `{ name, kind }`.
- `revealCredential` devolve `{ username, password, extraValues }` — o manager
  injeta `extraValues` em `recipeValues` → placeholder custom resolvido na
  memória a cada abertura, nunca persistido.
- Linhas legadas com valor em claro são lidas como fallback (compatibilidade),
  mas nunca são regravadas sem cifra. Cifra real entra na próxima edição da
  credencial. **Nota:** o comportamento legado anterior expunha valores em claro
  no renderer — corrigido nesta entrega.
- Fingerprint/mismatch de senha continua funcionando como antes (HMAC HKDF
  `password-reuse-fingerprint`, sem descriptografar o envelope).

### 2.3 Dois passes ("primeiro certificado, depois senha")

Quando o serviço aceita os dois (`authMethods: ['certificate', 'password']` —
"Os dois"), o assistente ensina **em dois passes sequenciais**:

1. **Passo 1 — Certificado** (obrigatório ensiná-lo primeiro, como pedido): o
   usuário faz o fluxo de certificado (cliques antes do mTLS, seleção automática
   do A1 no carregamento).
2. **Passo 2 — Senha**: o usuário faz o fluxo de login/senha (campos + clique
   em Entrar).

Cada passe vira um conjunto de etapas; ao final, **uma única receita** do serviço
carrega `certificateSteps` + `passwordSteps` + `steps` (= passada de senha, para
compatibilidade legada/agente). `recipeForSession` escolhe os passos pelo método
da sessão (certificado → `certificateSteps`; senha → `passwordSteps`), sem
categorização por strings — e mantém o fallback legado para receitas antigas.

### 2.4 Telas antes do login

São apenas **etapas gravadas em telas anteriores** (`T1` = página inicial, por
exemplo). O recorder já as compila como etapas normais (clicks "Entrar com
gov.br", expandir "Outras opções", etc.) com `expectedAfter` fundido quando há
navegação ≤5 s pós-clique. Nenhuma primitiva nova é necessária.

## 3. Segurança

- Valores de campo **nunca** entram no `RecipeDefinition` (só placeholders).
- Valores **nunca** chegam ao renderer (lista de credenciais devolve
  `{name, kind}` apenas).
- Valores **nunca** entram no audit (`logger`/`audit` não carregam `value` de
  campo; `redactRecord` limpa chaves `value|password|...`).
- AAD impede que um envelope de um campo seja reutilizado em outro campo ou
  credencial (prefixo `field:{name}`).
- A gravação não descriptografa nada além da comparação HMAC para
  `credential-mismatch` quando o usuário vincula credencial — e não há cliente
  vinculado por padrão.

## 4. O que fica para a próxima fase

- **Atualização pré-existente da UI de credencial**: pré-preencher os campos
  nomeados com os labels aprendidos pelo serviço ("Código da empresa", …) — o
  operador digita os valores na credencial que vincular.
- **mTLS por thumbprint na gravação de certificado sem cliente**: hoje a
  passada de certificado exige cliente (dono do A1) — preservar a UX pois o
  certificado é do cliente; sem cliente, a gravação de senha funciona
  normalmente.
- **Verificação pós-gravação por passe**: marker em `verified` por método —
  hoje a receita é `draft` até o primeiro login real de cada método.
- **e2e do fluxo completo** com fixture local para ambos os passes.
