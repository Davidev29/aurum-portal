# Spike Windows A1 — plano e decisão go/no-go

**Versão avaliada:** AurumBit Portal 0.1.0  
**Sistema-alvo:** Windows 10/11 x64  
**Objetivo:** decidir se o fluxo de certificado A1 e o isolamento de sessões estão aptos a avançar para piloto controlado.

> **Regra de segurança:** nenhum comando deste documento deve alterar o repositório de certificados do Windows sem **confirmação explícita, por escrito, do responsável pelo spike**, com identificação do certificado e do thumbprint. O diagnóstico é somente leitura; o gerador grava apenas arquivos locais. Nenhum dos dois instala, remove ou altera certificados.

## 1. Resumo executivo

O spike avalia cinco perguntas:

1. O aplicativo abre o cofre com `safeStorage`/DPAPI no Windows-alvo?
2. Um PFX A1 pode ser importado, cifrado, instalado em `Cert:\CurrentUser\My` e removido sem resíduos?
3. O Chromium apresenta exatamente o certificado da sessão no handshake mTLS, sem escolher outro certificado instalado?
4. Sessões de clientes diferentes permanecem isoladas em partições distintas?
5. O fluxo é operável e seguro o suficiente para um piloto com um certificado A1 real e autorizado?

**Decisão atual:** `GO CONDICIONAL`. Os verificadores automáticos passam; faltam as evidências manuais de `safeStorage`, repositório de certificados, autorização LGPD, isolamento e, para produção, autenticação em portal real com A1 autorizado.

## 2. Escopo

### Dentro do escopo

- Windows 10/11 x64, perfil de usuário dedicado.
- Certificado A1 em PFX/P12, com chave privada.
- Importação para o cofre local, instalação em `Cert:\CurrentUser\My`, teste de injeção mTLS e remoção.
- Sessões isoladas por cliente e certificado.
- Seleção explícita de certificado e bloqueio de hosts fora da allowlist.
- Auditoria, logs e limpeza de artefatos.
- Geração de PFX sintético para testar o encanamento sem usar certificado real.

### Fora do escopo

- A3, token, smart card, PIN ou certificado em hardware.
- Certificados em `LocalMachine` ou em outro usuário do Windows.
- Proxy TLS, MITM, instalação de CA raiz ou interceptação de tráfego.
- Emissão, renovação, revogação ou validação legal de certificados.
- Teste de carga, múltiplos usuários simultâneos ou sincronização entre estações.
- Alteração de código do aplicativo durante o spike.

## 3. Segurança e autorização

### Antes de começar

- [ ] Preferir **VM descartável** ou perfil Windows dedicado, sem dados de produção.
- [ ] Confirmar que o certificado de teste **não** é um certificado de produção.
- [ ] Obter autorização escrita do titular ou do responsável para usar o certificado no spike.
- [ ] Registrar quem autorizou, data, escopo e thumbprint.
- [ ] Fazer backup do PFX e da frase-senha em local seguro.
- [ ] Confirmar que o BitLocker/criptografia de disco está ativo, quando disponível.
- [ ] Garantir que nenhum outro processo está usando o certificado.
- [ ] Ler esta seção e a seção 4 com o responsável.

### Gate de confirmação para alterar o repositório

Qualquer ação que importe, remova ou altere um certificado no Windows exige o preenchimento abaixo **antes** da execução:

```text
Confirmo que autorizo a alteração no repositório de certificados do Windows
para o spike do AurumBit Portal.

Máquina/perfil:
Certificado (titular/emissor):
Thumbprint SHA-1:
Thumbprint SHA-256:
Ação (instalar/remover):
Responsável:
Data/hora:
Forma de backup:
```

Sem esse registro, execute apenas as etapas de leitura e os testes que não alteram o repositório. O script `run-spike.ts` nunca executa `Import-PfxCertificate`, `Remove-Item` ou equivalente.

### O que nunca fazer

- Não importar certificado de produção em máquina de terceiros.
- Não remover certificado por nome, subject ou curinga; use o thumbprint exato.
- Não instalar CA raiz ou cadeia de origem desconhecida.
- Não desabilitar verificação TLS, firewall, antivírus ou política de grupo.
- Não copiar `vault.key` entre máquinas.
- Não anexar PFX, senha, cookie ou banco real a um chamado.
- Não executar comandos de limpeza em massa.

## 4. Pré-requisitos do ambiente

| Item | Verificação |
| --- | --- |
| Windows 10/11 x64 | `winver` e `Get-CimInstance Win32_OperatingSystem` |
| Node.js >= 22 | `node --version` |
| npm | `npm --version` |
| Dependências instaladas | `npm install` |
| Electron 45.x | `npm run spike -- --check-only` |
| PowerShell 5.1 | Caminho em `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe` |
| Porta livre para diagnóstico | O teste usa porta efêmera em `127.0.0.1` |
| Perfil dedicado | Sem outras sessões de cliente abertas |
| Autorização | Gate da seção 3 preenchido |

## 5. Artefatos e scripts

| Artefato | Caminho | Efeito |
| --- | --- | --- |
| Diagnóstico | `scripts/spike/run-spike.ts` | Somente leitura; não grava arquivos, não abre o banco em escrita e não altera certificados. |
| Gerador de PFX | `scripts/spike/generate-certs.ts` | Gera PFX autoassinado, PEM e metadados em `scripts/spike/.certs`; não instala nada. |
| PFX sintético | `scripts/spike/.certs/spike-a1-test.pfx` | Certificado de teste, autoassinado, sem validade legal. |
| Metadados | `scripts/spike/.certs/spike-a1-test-metadata.json` | Thumbprints, DN, validade e aviso; não registra a senha. |
| Aplicativo | `npm run dev` ou `npm start` | Interface para importar, instalar, testar e remover. |

O diretório `scripts/spike/.certs/` está no `.gitignore`. Ainda assim, trate os arquivos como sensíveis e apague-os ao final.

## 6. Plano de execução

### Fase 0 — Preparação e linha de base

**Objetivo:** registrar ambiente, versão e responsáveis.

```powershell
node --version
npm --version
npm run typecheck
npm run spike -- --check-only
```

**Evidência:** saída do diagnóstico, versão do Windows, versão do Electron, usuário do perfil, se é VM e autorização LGPD.

**Critério de parada:** falha em Windows, Node, Electron ou PowerShell; ambiente sem autorização; certificado real sem backup.

### Fase 1 — Geração do PFX sintético

**Objetivo:** validar o parser, o envelope e o fluxo de importação sem certificado real.

```powershell
npm run spike:certs -- --password "TesteA1!2026"
```

Para sobrescrever artefatos existentes:

```powershell
npm run spike:certs -- --password "TesteA1!2026" --force
```

**Esperado:**

- quatro etapas concluídas (`[1/4]` a `[4/4]`);
- PFX, PEM e JSON gerados;
- validação pelo mesmo `parsePfx` do aplicativo;
- titular `SPIKE TESTE`, documento de teste, validade de um ano;
- thumbprints SHA-1 e SHA-256 exibidos;
- nenhuma alteração no repositório do Windows.

**Evidência:** caminho dos artefatos, thumbprints e mensagem final.

**Atenção:** o PFX é autoassinado e **não** representa a ICP-Brasil. Ele serve para testar o encanamento, não para autenticar em gov.br ou em portal real.

### Fase 2 — Cofre e importação no aplicativo

**Objetivo:** validar `safeStorage`, cifragem e importação.

1. Abra o AurumBit Portal.
2. Vá em **Configurações → Sobre e diagnóstico**.
3. Confirme `safeStorage/DPAPI: Disponível`.
4. Crie um cliente de teste (não use dados reais).
5. Abra **Certificados → Importar PFX**.
6. Selecione o PFX sintético e informe a senha usada.
7. **Não** marque instalação no Windows nesta etapa, se quiser testar primeiro apenas o cofre.
8. Vincule ao cliente de teste e confirme a autorização.
9. Verifique o status e os thumbprints.

**Esperado:**

- importação com sucesso;
- PFX e senha cifrados no cofre;
- registro com titular, validade e documento;
- evento `certificate.imported` na auditoria;
- nenhum segredo no log.

**Evidência:** print da tela, status, thumbprint e evento de auditoria.

**Critério de parada:** `safeStorage` indisponível, falha de senha, PFX não parseado, segredo em log ou ausência de evento.

### Fase 3 — Instalação no repositório do Windows

> **Pare.** Esta fase altera `Cert:\CurrentUser\My`. Só continue com o gate da seção 3 preenchido e assinado.

**Objetivo:** validar instalação, presença e remoção.

1. Na lista de certificados, clique em **Instalar no Windows**.
2. Confirme que o status passa a **Instalado**.
3. Execute a leitura somente leitura:

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.HasPrivateKey } |
  Select-Object Subject, Thumbprint, NotAfter
```

4. Compare o thumbprint com o metadado do PFX.
5. Rode o **teste de injeção mTLS** no aplicativo.
6. Confirme que o thumbprint apresentado é igual ao esperado.
7. Feche a sessão/teste e remova o certificado **pelo aplicativo**, digitando `REMOVER`.

**Esperado:**

- instalação sem elevação;
- certificado visível em `CurrentUser\My`;
- thumbprint idêntico;
- teste mTLS com `ok: true`;
- remoção apenas do certificado testado;
- eventos `certificate.installed`, `certificate.test_completed` e `certificate.removed`.

**Critério de parada:** thumbprint divergente, instalação em local errado, falha de remoção, certificado em uso por sessão ou qualquer efeito em certificados de produção.

**Nota:** a interface menciona “chave não exportável”, mas o fluxo usa `Import-PfxCertificate` sem fixar essa propriedade. Para o spike, **não** assuma que a chave é não exportável; proteja o PFX e o perfil. A versão 0.1.x também não calcula o status de cadeia; a validação efetiva é a do handshake do Windows/portal.

### Fase 4 — Seleção explícita e isolamento de sessão

**Objetivo:** provar que o certificado correto é apresentado e que clientes não compartilham sessão.

Pré-requisito: um portal de teste ou o diagnóstico local. Não use portal real com o PFX sintético.

1. Crie dois clientes de teste.
2. Vincule certificados/credenciais distintos a cada um.
3. Abra uma sessão para o cliente A e outra para o cliente B.
4. Confirme que as partições são diferentes:
   - `persist:client:<A>[:cert:<certA>]`
   - `persist:client:<B>[:cert:<certB>]`
5. No teste de injeção, confirme que o thumbprint apresentado corresponde ao certificado da sessão.
6. Force uma situação em que o servidor ofereça outro certificado e confirme que a autenticação é cancelada, com evento `certificate.not_offered`.
7. Confirme que um host fora da allowlist é bloqueado.
8. Feche a sessão e reabra; confirme que a partição é reutilizada (comportamento persistente).

**Esperado:**

- nenhuma sessão compartilhada entre clientes;
- certificado correto no handshake;
- cancelamento seguro quando o certificado não é oferecido;
- bloqueio de host fora da allowlist;
- auditoria dos eventos;
- ao fechar, cookies/storage **permanecem** na partição (limitação conhecida).

**Evidência:** ids de partição, thumbprints, eventos e prints das telas.

**Critério de parada:** sessão de A aparecendo em B, certificado errado selecionado, host fora da allowlist acessível ou ausência de auditoria.

### Fase 5 — A1 real em portal real (para GO de produção)

**Objetivo:** validar aceitação por um portal oficial e o fluxo ponta a ponta.

Pré-requisitos:

- certificado A1 **real**, de teste ou de titular autorizado;
- conta/portal de homologação ou ambiente controlado;
- autorização escrita;
- máquina isolada;
- backup do PFX;
- possibilidade de revogar o certificado se necessário.

Passos:

1. Importe o A1 real no cofre e instale em `CurrentUser\My`.
2. Vincule ao cliente correto.
3. Rode o teste de injeção.
4. Abra o portal oficial, selecione o cliente e autentique.
5. Confirme que o portal mostra o titular correto.
6. Navegue por uma função de leitura e, se possível, uma função de escrita controlada.
7. Encerre a sessão.
8. Remova o certificado do Windows ao final, se ele não for mais necessário.
9. Revogue o certificado se houver qualquer suspeita de comprometimento.

**Esperado:**

- autenticação aceita pelo portal;
- titular correto;
- nenhuma seleção automática de outro certificado;
- sessão isolada;
- logs/auditoria sem segredos;
- remoção limpa.

**Critério de parada:** portal rejeita o certificado, titular errado, seleção de certificado incorreto, vazamento entre clientes ou impossibilidade de remover o certificado.

> Se esta fase não puder ser executada, a decisão máxima é `GO CONDICIONAL`, não `GO` de produção.

### Fase 6 — Limpeza e encerramento

1. Feche todas as sessões.
2. Remova o certificado de teste do Windows **pelo aplicativo** (ou por PowerShell, somente com o gate preenchido).
3. Apague os artefatos sintéticos:

```powershell
Remove-Item -Recurse -Force .\scripts\spike\.certs
```

4. Se usou uma pasta de dados de teste, remova-a com o aplicativo fechado.
5. Preserve logs e auditoria necessários ao relatório, com dados sensíveis removidos.
6. Registre o resultado e as assinaturas.

**Esperado:** nenhum certificado de teste restante, nenhum PFX sintético no disco e nenhum dado real na VM.

## 7. Critérios go/no-go

### Obrigatórios para GO de produção

| # | Critério | Evidência | Peso |
| --- | --- | --- | --- |
| 1 | Windows 10/11 x64, Node >= 22, Electron e PowerShell disponíveis | `run-spike` sem falhas | Obrigatório |
| 2 | `safeStorage/DPAPI` disponível e cofre abre | Tela Sobre e diagnóstico | Obrigatório |
| 3 | PFX A1 importado, cifrado e vinculado ao cliente | Relatório de importação + auditoria | Obrigatório |
| 4 | Instalação em `CurrentUser\My` sem administrador | Listagem + thumbprint | Obrigatório |
| 5 | Teste mTLS apresenta o thumbprint correto | Resultado `ok: true` | Obrigatório |
| 6 | Certificado errado/não oferecido é recusado | Evento `certificate.not_offered` | Obrigatório |
| 7 | Sessões de clientes distintos não compartilham partição | Ids distintos + teste cruzado | Obrigatório |
| 8 | Host fora da allowlist é bloqueado | Teste negativo | Obrigatório |
| 9 | Remoção do certificado funciona e não afeta outros | Listagem antes/depois | Obrigatório |
| 10 | Logs/auditoria não contêm senha, PFX, cookie ou token | Inspeção amostral | Obrigatório |
| 11 | Autorização LGPD registrada | Gate + consentimento | Obrigatório |
| 12 | A1 real autentica em portal real | Print/titular + sessão | Obrigatório para produção |
| 13 | A3/PIN é recusado sem registrar o PIN | Teste negativo | Obrigatório |
| 14 | Backup do PFX é criado e a frase-senha é exigida | Arquivo + tentativa sem senha | Recomendado |
| 15 | Limpeza de artefatos e certificado de teste | Listagem final | Obrigatório |

### Critérios de NO-GO

Qualquer item abaixo leva a **NO-GO** até correção:

- `safeStorage/DPAPI` indisponível ou cofre abre sem proteção.
- Certificado é instalado em local diferente de `CurrentUser\My` sem autorização.
- Chromium apresenta certificado diferente do thumbprint da sessão.
- Sessão de um cliente acessa cookies/storage de outro.
- Host fora da allowlist é acessível.
- Senha, PFX, cookie ou token aparece em log/auditoria.
- Certificado de produção é usado sem autorização ou sem backup.
- Remoção de certificado afeta outros certificados ou não pode ser revertida.
- A3/PIN é solicitado ou armazenado.
- A1 real não autentica no portal-alvo (para GO de produção).

### Decisão

| Resultado | Significado |
| --- | --- |
| **GO** | Todos os critérios obrigatórios, incluindo A1 real em portal real, foram atendidos. Piloto liberado com monitoramento. |
| **GO CONDICIONAL** | Ambiente e encanamento aprovados; faltam evidências manuais ou teste com A1 real. Piloto limitado a dados sintéticos ou homologação. |
| **NO-GO** | Há bloqueio de segurança, isolamento, certificado ou legal. Corrigir e repetir o spike. |

## 8. Comandos de referência

```powershell
# Diagnóstico somente leitura
npm run spike -- --check-only

# Diagnóstico em JSON
npm run spike -- --check-only --json

# Pasta de dados alternativa
npm run spike -- --check-only --user-data "C:\spike\userData"

# Gerar PFX sintético
npm run spike:certs -- --password "TesteA1!2026"

# Sobrescrever artefatos sintéticos
npm run spike:certs -- --password "TesteA1!2026" --force

# Validar tipos
npm run typecheck

# Testes unitários
npm test

# Leitura do repositório (somente leitura)
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.HasPrivateKey } |
  Select-Object Subject, Thumbprint, NotAfter
```

### Limpeza manual do certificado (somente com o gate preenchido)

Substitua o thumbprint exato e confirme o subject antes:

```powershell
$thumbprint = "COLE_O_THUMBPRINT_SHA1_AQUI"
Get-Item "Cert:\CurrentUser\My\$thumbprint" | Select-Object Subject, Thumbprint, NotAfter
# Só execute a linha abaixo após conferir o subject e ter autorização escrita:
# Remove-Item "Cert:\CurrentUser\My\$thumbprint" -Force
```

Nunca use curinga, `-Recurse` ou remoção por nome.

## 9. Modelo de resultados

Preencha e anexe ao relatório. Não inclua segredos.

```text
SPIKE WINDOWS A1 — RESULTADO

Data/hora:
Responsável:
Máquina/perfil:
VM? ( ) sim ( ) não
Windows:
Node:
Electron:
AurumBit Portal:
Autorização LGPD (responsável/data):
Certificado de teste (titular/emissor):
Thumbprint SHA-1:
Thumbprint SHA-256:
A1 real? ( ) sim ( ) não

[ ] Fase 0 — ambiente
[ ] Fase 1 — PFX sintético
[ ] Fase 2 — cofre/importação
[ ] Fase 3 — instalação/remoção
[ ] Fase 4 — seleção/isolamento
[ ] Fase 5 — A1 real em portal
[ ] Fase 6 — limpeza

Evidências:
- Diagnóstico automático:
- Print do cofre:
- Thumbprint instalado:
- Teste mTLS:
- Partições A/B:
- Evento de recusa:
- Bloqueio de host:
- Remoção:
- Logs/auditoria:

Falhas encontradas:
1.
2.

Riscos residuais:
1.
2.

Decisão: ( ) GO  ( ) GO CONDICIONAL  ( ) NO-GO
Justificativa:
Assinatura do responsável:
Data:
```

## 10. Registro da execução inicial

Execução local em **4 de novembro de 2026**, no repositório, sem alteração do repositório de certificados:

| Verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Passou nos dois `tsconfig`. |
| `npm run spike -- --check-only` | `GO CONDICIONAL`; Windows, Node 26.13.0, Electron 45.2.1 e PowerShell 5.1 aprovados. |
| Geração de PFX sintético | Passou; PFX, PEM e metadados gerados fora do repositório e validados pelo `parsePfx`. |
| `safeStorage/DPAPI` | Pendente de verificação manual no aplicativo. |
| Repositório de certificados | Não alterado; leitura manual pendente. |
| Autorização LGPD | Pendente de registro formal. |
| Ambiente isolado | Pendente de confirmação (VM/perfil dedicado). |
| A1 real em portal | Não executado. |

**Conclusão:** o encanamento e os verificadores automáticos estão prontos. A decisão permanece `GO CONDICIONAL` até que as evidências manuais e, para produção, o teste com A1 real sejam anexadas.

## 11. Riscos e rollback

| Risco | Mitigação | Rollback |
| --- | --- | --- |
| Certificado de teste esquecido no Windows | Listar por thumbprint antes/depois; remover pelo app | Remover pelo thumbprint exato, com autorização |
| PFX sintético vazado | Diretório ignorado; apagar ao final; senha de teste | Apagar artefatos; não reutilizar senha |
| Certificado real usado sem autorização | Gate LGPD; VM isolada; backup | Revogar na AC; trocar senhas; registrar incidente |
| Sessão compartilhada entre clientes | Teste cruzado A/B; partições distintas | Fechar sessões; corrigir antes de piloto |
| Seleção automática de certificado errado | Teste negativo; auditoria `certificate.not_offered` | Bloquear uso até correção |
| Chave “não exportável” não garantida | Não assumir; proteger PFX/perfil; registrar limitação | Reinstalar com política adequada, se exigido |
| Cadeia ICP-Brasil não validada ativamente | Testar no Windows/portal e conferir a cadeia oficial | Instalar a cadeia correta; bloquear uso até corrigir |
| Partição persistente retém cookies | Tratar como limitação; limpar pasta ao encerrar cliente | Remover partição com o app fechado |
| Atualização de origem desconhecida | URL placeholder; assinatura; teste | Reinstalar build anterior confiável |

## 12. Anexos

- [README](../README.md)
- [SECURITY](SECURITY.md)
- [PRIVACY](PRIVACY.md)
- [USER_GUIDE](USER_GUIDE.md)
- [SUPPORT](SUPPORT.md)
- [ADR 0003 — isolamento e seleção de certificado](adr/0003-session-isolation-and-certificate-selection.md)
- [ADR 0004 — cofre com DPAPI e AES-256-GCM](adr/0004-vault-dpapi-aes-gcm.md)
