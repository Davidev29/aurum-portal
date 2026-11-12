# Suporte

Guia de diagnóstico e atendimento do AurumBit Portal 0.1.x. O suporte é local: não há acesso remoto da equipe do AurumBit Portal à estação, ao banco ou aos certificados.

## Antes de abrir um chamado

Reúna:

1. Versão do AurumBit Portal (Configurações → Sobre e diagnóstico).
2. Versão do Windows, arquitetura e se é máquina física, VM ou perfil corporativo.
3. Versão do Electron/Chromium/Node exibida na mesma tela.
4. Descrição do que você tentou fazer, o que esperava e o que aconteceu.
5. Mensagem de erro exata e horário aproximado.
6. Captura de tela com dados sensíveis ocultos.
7. Se o problema é com um certificado: titular, emissor, validade, status e thumbprint (nunca o PFX ou a senha).
8. Se o problema é com uma sessão: serviço, cliente, método de autenticação e URL exibida (sem query string sensível).
9. Se o problema é com o banco: tamanho do arquivo e se há `-wal`/`-shm`.

**Nunca envie** PFX, senha de PFX, senha de portal, cookies, `vault.key`, banco de produção ou certificado real. Use dados sintéticos.

## Diagnóstico rápido

Execute no diretório do projeto:

```powershell
npm run typecheck
npm run spike -- --check-only
npm run spike -- --check-only --json
```

O primeiro comando valida os dois `tsconfig`. O segundo faz um diagnóstico somente leitura do ambiente, caminhos, partições e checklist. O terceiro gera JSON para anexar ao chamado.

Para uma pasta de dados específica:

```powershell
npm run spike -- --check-only --user-data "C:\caminho\userData"
```

O script **não** importa, remove ou altera certificados. Ele também não abre o banco em escrita.

### Onde estão os arquivos

| Item | Caminho padrão |
| --- | --- |
| Pasta de dados | `%APPDATA%\AurumBit Portal` |
| Banco | `%APPDATA%\AurumBit Portal\aurumbit-portal.db` |
| WAL | `%APPDATA%\AurumBit Portal\aurumbit-portal.db-wal` |
| Chave do cofre | `%APPDATA%\AurumBit Portal\vault.key` |
| Logs | `%APPDATA%\AurumBit Portal\logs\aurumbit-portal.log` |
| Partições | `%APPDATA%\AurumBit Portal\Partitions` |
| PFX de teste do spike | `scripts/spike/.certs` |

O botão **Abrir logs** em Configurações abre a pasta de logs. O log rotaciona em 10 MB e passa por redaction, mas ainda pode conter nomes de hosts, caminhos e mensagens de erro. Revise antes de compartilhar.

## Problemas comuns

### O aplicativo não inicia

**Sintomas:** janela não abre, erro “cofre indisponível” ou encerramento imediato.

**Verifique:**

- Se o `safeStorage/DPAPI` está disponível no perfil.
- Se `vault.key` existe e pertence ao mesmo usuário do Windows.
- Se o perfil foi copiado de outra máquina (o DPAPI pode não decifrar).
- Se há outra instância aberta (o aplicativo usa instância única).
- O log em `%APPDATA%\AurumBit Portal\logs\aurumbit-portal.log`.

**Ações:**

1. Não apague `vault.key` sem backup; isso torna o cofre irrecuperável.
2. Teste com um perfil Windows limpo e uma pasta de dados temporária.
3. Se o erro começou após troca de máquina, restaure um backup ou recadastre os dados.
4. Se o erro for de banco corrompido, preserve o arquivo e abra chamado antes de qualquer reparo.

### `safeStorage/DPAPI indisponivel`

**Causas prováveis:** perfil sem sessão interativa, política de segurança que bloqueia DPAPI, execução como serviço, ambiente de teste sem o mesmo usuário.

**Ações:**

- Execute com o mesmo usuário que criou o cofre.
- Não execute como serviço ou conta de sistema.
- Verifique políticas de grupo e soluções de segurança que bloqueiam proteção de dados.
- Em último caso, crie uma instalação limpa e recadastre os dados; não copie apenas `vault.key`.

### PowerShell não encontrado ou falha ao listar certificados

**Sintomas:** erro ao importar do Windows, instalar ou remover certificado.

**Verifique:**

```powershell
Test-Path "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
powershell.exe -NoLogo -NoProfile -Command "$PSVersionTable.PSVersion"
```

**Ações:**

- Confirme o Windows PowerShell 5.1.
- Verifique políticas de execução e antivírus que bloqueiam `powershell.exe`.
- Teste a leitura manual:

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.HasPrivateKey } |
  Select-Object Subject, Thumbprint, NotAfter
```

Não altere o repositório sem confirmação explícita.

### Certificado não aparece na importação do Windows

- O certificado precisa ter chave privada.
- Pode estar em `LocalMachine` ou em outro usuário; o aplicativo lê apenas `CurrentUser\My`.
- O certificado pode estar corrompido ou sem provedor de chave.
- Execute a listagem manual acima e confira o thumbprint.

### “Senha do PFX incorreta ou arquivo corrompido”

- Confira maiúsculas/minúsculas e o layout do teclado.
- Confirme que o arquivo é `.pfx`/`.p12` e tem no máximo 20 MB.
- Teste a abertura do PFX em outra ferramenta confiável.
- Se a senha foi trocada, use o arquivo atualizado.
- Não tente repetidamente: o aplicativo pode registrar falhas de importação.

### “Certificado não oferecido” ou autenticação cancelada

1. Confirme que o certificado está instalado em `Cert:\CurrentUser\My`.
2. Confirme validade e chave privada.
3. Verifique a cadeia ICP-Brasil.
4. Confirme o vínculo com o cliente correto.
5. Rode o teste de injeção mTLS.
6. Confirme que o domínio do portal é `.gov.br` ou está na allowlist do serviço (necessário apenas para portais fora de `.gov.br`).
7. Verifique se o portal aceita A1; alguns exigem A3 ou outro fluxo.

### “O portal tentou autenticar em um dominio fora da allowlist”

Esta mensagem aparece quando o portal pede o certificado em um endereço que não é `.gov.br` nem está coberto pela allowlist. Em versões anteriores, um erro de parsing fazia o aplicativo recusar **todos** os portais gov.br (inclusive `sso.acesso.gov.br`) com esta mensagem — atualize para a build com a correção (ADR 0006).

1. Consulte a auditoria (evento `certificate.not_offered`, campo `reason` e `url` redigida) para ver o domínio exato.
2. Se o domínio terminar em `.gov.br`, trate como bug e relate com horário e o thumbprint do certificado; versões corrigidas autenticam normalmente.
3. Se o domínio for de fato fora de `.gov.br` (intranet, prefeitura em domínio próprio), inclua o domínio de SSO na allowlist do serviço (ex.: `*.empresa.com.br`).
4. Em dúvida, **não** adicione o domínio: o certificado apresentado ali não pode ser revogado pelo aplicativo.

Se o teste local passa, mas o portal falha, o problema pode ser do portal, da cadeia, do credenciamento ou do tipo de certificado. Abra chamado com o thumbprint e o horário.

### “Cadeia do certificado incompleta”

Instale os certificados da cadeia ICP-Brasil no repositório do Windows e repita o teste. O aplicativo não calcula o status de cadeia automaticamente; a mensagem pode vir do portal ou do teste mTLS. Não instale uma CA raiz arbitrária; use a cadeia oficial da AC.

### “Certificado ausente no Windows”

O registro existe no cofre, mas o certificado sumiu do repositório. Reinstale pelo botão **Instalar no Windows** ou importe novamente o PFX. Se o PFX não estiver no cofre, importe o arquivo original.

### “Certificado vencido não pode autenticar”

Renove o certificado na AC, importe o novo PFX e vincule ao cliente. Certificados vencidos permanecem no histórico, mas não abrem sessão.

### Backup `.pvbackup` não restaura

A versão 0.1.x apenas exporta o envelope `.pvbackup`; não há importação/restauração pela interface. Use o PFX original para reimportar ou decifre o backup com procedimento técnico controlado usando a frase-senha. Sem a frase-senha, não há recuperação.

### Erro ao remover certificado

- Feche as sessões que usam o certificado.
- Confirme que ele está em `CurrentUser\My`.
- Digite exatamente `REMOVER`.
- Verifique se outro processo/usuário está usando a chave privada.
- Não remova certificados de produção sem confirmação e backup.

### Sessão não abre ou fica em branco

- Verifique a conexão e a URL do serviço.
- Confirme que o domínio está na allowlist (ou é `.gov.br`).
- Teste o portal no navegador padrão.
- Verifique se o portal exige captcha, MFA ou JavaScript não suportado.
- Consulte o log e o status da sessão.
- Feche a sessão e abra com **Forçar nova sessão**.

### “Limite de sessões simultâneas atingido”

Feche sessões na tela **Sessões** ou aumente o limite em Configurações (2 a 40). O limite é local, não é imposto pelo portal.

### Download bloqueado

O aplicativo cancela extensões perigosas: `.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.jse`, `.scr`, `.com`, `.pif`, `.reg`, `.dll`. Baixe apenas de fontes confiáveis e fora da sessão, se necessário. Não desative o bloqueio.

### Link externo não abre

- Confirme a opção **Confirmar abertura de link externo**.
- Verifique se o navegador padrão está configurado.
- A URL pode estar fora da allowlist e ter sido bloqueada por segurança.
- Copie a URL e abra manualmente apenas se confiar na origem.

### Atualização indisponível

- Em desenvolvimento, a verificação é desabilitada.
- A URL de updates do repositório é `https://updates.aurumbit.invalid/stable`, um placeholder.
- Configure um servidor válido, assine o instalador e teste em ambiente controlado.
- Nunca aceite atualização de origem desconhecida.

### Alto uso de memória ou várias partições

Cada sessão abre um Chromium/`WebContentsView`. Feche sessões não usadas. Partições persistentes acumulam dados em `%APPDATA%\AurumBit Portal\Partitions`; a limpeza manual deve ser feita com o aplicativo fechado e após backup.

### Banco bloqueado ou corrompido

- Feche todas as instâncias do aplicativo.
- Verifique se há antivírus/backup segurando o arquivo.
- Preserve `aurumbit-portal.db`, `-wal` e `-shm` antes de qualquer ação.
- Não execute `VACUUM`, exclusão de WAL ou reparo sem orientação; isso pode agravar a perda.
- Restaure de backup verificado, se disponível.

## Coleta segura de evidências

Para um chamado, prefira:

- versão e ambiente;
- trecho do log com dados sensíveis removidos;
- print da tela de erro;
- relatório JSON do spike;
- lista de thumbprints (sem PFX);
- passos de reprodução;
- horário e fuso.

Evite:

- banco completo;
- `vault.key`;
- PFX ou backup;
- senhas;
- cookies;
- capturas com dados de outros clientes.

Se precisar compartilhar o banco, combine antes um canal seguro e uma autorização formal. O banco contém dados pessoais e metadados de clientes.

## Modelo de chamado

```text
Resumo:
Versão do AurumBit Portal:
Windows / arquitetura:
Tipo de máquina (física/VM/perfil corporativo):
Passos para reproduzir:
Resultado esperado:
Resultado observado:
Mensagem de erro:
Horário:
Serviço/cliente envolvido:
Certificado (titular, validade, thumbprint; sem PFX):
Já executou npm run spike -- --check-only? ( ) sim ( ) não
Anexos (sem segredos):
```

## Escalonamento

| Severidade | Exemplos | Ação |
| --- | --- | --- |
| Crítica | Vazamento de credencial/certificado, acesso não autorizado, malware, perda de dados | Conter, revogar certificado, trocar senhas, preservar evidências, acionar segurança/jurídico imediatamente. |
| Alta | Aplicativo não abre, cofre inacessível, certificado não autentica em produção | Atender no mesmo dia útil; avaliar rollback e backup. |
| Média | Falha em um portal específico, download bloqueado indevidamente, erro de importação | Coletar evidências e corrigir na próxima janela. |
| Baixa | Dúvida de uso, ajuste de texto, melhoria de UX | Registrar e tratar no fluxo normal. |

## Contato

Canal interno configurado no projeto: `suporte@aurumbit.local`. Substitua pelo endereço oficial, pelo canal de segurança e pelo encarregado de dados antes de distribuir o aplicativo.

**Última atualização:** 4 de novembro de 2026.
