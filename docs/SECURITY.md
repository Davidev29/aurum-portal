# Segurança

Documento operacional do AurumBit Portal 0.1.x. Ele descreve o modelo de proteção, os controles implementados, as limitações conhecidas e as responsabilidades do operador.

> O AurumBit Portal é uma ferramenta local. Ele **não** substitui antivírus, EDR, backup, gestão de identidades, política de mesa limpa ou treinamento de usuários.

## Versões suportadas

| Versão | Suporte de segurança |
| --- | --- |
| 0.1.x | Ativa |

Versões fora dessa faixa não recebem correções. Como o projeto é distribuído internamente, o operador deve manter uma cópia do instalador e do código-fonte correspondentes.

## Como reportar uma vulnerabilidade

1. **Não** abra issue pública, não publique detalhes e não teste em portais de terceiros ou com certificados de produção.
2. Envie um relato para o canal interno de segurança definido pela organização. O contato configurado no projeto é `suporte@aurumbit.local`; substitua-o pelo endereço oficial antes de distribuir externamente.
3. Inclua: versão do AurumBit Portal, versão do Windows, passos de reprodução, impacto esperado, evidências e se há dados pessoais envolvidos.
4. Não anexe certificados, PFX, senhas, cookies ou bancos reais. Use dados sintéticos.
5. Aguarde a triagem e combine prazo de divulgação. O objetivo é confirmar o recebimento em até 5 dias úteis e apresentar uma avaliação inicial em até 10 dias úteis.

Se houver vazamento de credenciais ou certificado, a prioridade é **revogar o certificado**, trocar as senhas afetadas e preservar evidências, antes de qualquer análise longa.

## Modelo de ameaça

### O que o AurumBit Portal protege

- Senhas de portais e senhas de PFX armazenadas no banco local.
- O conteúdo binário do PFX mantido no cofre.
- A chave-mestra do cofre contra leitura direta do arquivo por outro usuário do Windows.
- O certificado correto no handshake TLS, evitando que o Chromium escolha outro certificado instalado.
- Sessões de clientes diferentes contra compartilhamento de cookies e storage no uso normal.
- Dados sensíveis contra aparecerem em logs e auditoria.
- O renderer contra acesso direto a Node.js, ao sistema de arquivos e ao IPC não autorizado.

### O que o AurumBit Portal não protege

- Um Windows comprometido, malware no mesmo perfil, keylogger, screen capture ou acesso físico desbloqueado.
- Um administrador local ou domínio com capacidade de ler memória, instalar driver ou alterar o binário.
- Um portal legítimo ou malicioso que colete dados após o login.
- Phishing, engenharia social ou uso indevido por um operador autorizado.
- Perda do disco sem backup: o DPAPI não permite recuperar o cofre em outro perfil/máquina.
- Confidencialidade de metadados não cifrados no SQLite (nomes, documentos, URLs, horários).
- A área de transferência enquanto a senha copiada ainda não foi limpa.
- Ataques de canal lateral ou exploração de vulnerabilidades no Electron/Chromium sem atualização.

## Controles implementados

### Fronteira do renderer

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false` e `webSecurity: true` na janela principal e nas sessões.
- `preload` expõe somente a API `aurumBitPortal` por `contextBridge`; não há `require` ou `process` no renderer.
- Navegação da UI restrita à origem `app://aurumbit-portal` (ou ao dev server configurado).
- `setWindowOpenHandler` nega novas janelas na UI.
- `will-attach-webview` é bloqueado.
- Protocolo `app://` resolve apenas caminhos dentro de `out/`, com proteção contra path traversal.
- CSP: `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`.
- DevTools desabilitado no aplicativo empacotado; F12 bloqueado nas sessões.

### IPC

- Todos os handlers validam payloads com Zod.
- Apenas `webContents` confiáveis registrados podem chamar a API.
- Erros são convertidos em payloads controlados, sem stack trace para o renderer.
- Operações sensíveis têm throttle (revelação/cópia) e geram evento de auditoria.
- O renderer não recebe caminhos internos arbitrários, chaves ou conteúdo de PFX.

### Certificados

- Importação de PFX/P12 com senha, leitura em worker separado e validação do certificado.
- Instalação apenas em `Cert:\CurrentUser\My`, via PowerShell com caminho temporário e remoção do arquivo ao final.
- Remoção exige confirmação literal `REMOVER`.
- Seleção explícita no evento `select-client-certificate`, com `preventDefault()` obrigatório.
- Comparação por thumbprint SHA-256 e fallback SHA-1; o certificado só é apresentado a hosts `.gov.br` (infraestrutura governamental, exigida pelo fluxo de SSO) ou a hosts explicitamente na allowlist do serviço; qualquer outra origem é recusada.
- A injeção exige HTTPS; URLs são normalizadas antes da decisão (o Electron entrega `host:porta` sem esquema — ver ADR 0006). Parecidos com gov.br (`gov.br.evil.com`, `a..gov.br`, user/senha embutidos) são recusados.
- Certificados vencidos, ausentes ou não vinculados ao cliente não autenticam. A cadeia ICP-Brasil não é validada ativamente; se o Windows não oferecer o certificado, a autenticação é cancelada.
- A3/PIN: o handler de senha de certificado lança erro e não registra o PIN.
- Diagnóstico de injeção usa servidor TLS efêmero em `127.0.0.1`, com validação restrita ao loopback; nada é gravado em disco.
- Assinatura de PDF (PAdES-B-T) usa o PFX do cofre em worker isolado; o documento original nunca é sobrescrito (atualização incremental); o carimbo visual é informativo. Validade jurídica confirmada por validador externo (validar.iti.gov.br) com raízes ICP-Brasil na estação.

### Sessões e rede

- Partições persistentes por cliente e certificado; nenhuma partição compartilhada entre clientes.
- Permissões de câmera, microfone, geolocalização, notificações etc. negadas por padrão.
- Downloads de `.exe`, `.msi`, `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`, `.jse`, `.scr`, `.com`, `.pif`, `.reg` e `.dll` são cancelados.
- Downloads permitidos vão para a pasta padrão de Downloads, com nome não colidente.
- Redirecionamentos e navegações fora da allowlist são bloqueados; hosts `.gov.br` são aceitos por sufixo com validação de labels (ver ADR 0006).
- Links externos abrem no navegador padrão somente após confirmação quando `confirmOpenExternal` está ativo.
- User agent compatível com Chrome é usado para reduzir bloqueios de portais; isso não altera a validação TLS.

### Comunicação com terceiros

O aplicativo só fala com a rede em três situações:

1. **Portais abertos pelo usuário**, nas janelas de sessão (SSO gov.br, e-CAC etc.).
2. **Servidor de atualizações** (`updates.aurumbit.invalid` nesta versão, placeholder desabilitado; ver limitações) — somente se `autoCheckUpdates` for ativado ou o operador clicar em verificar.
3. **brasilapi.com.br** — somente para preencher a razão social ao importar um certificado CNPJ, e **somente** com a opção "Consultar dados publicos de CNPJ" ativada (`externalCnpjLookup`, padrão `false`; ver ADR 0007). A consulta é auditada (`external.cnpj_lookup`, CNPJ mascarado) e a resposta é limitada a 64 KB.
4. **TSA (carimbo de tempo, módulo de assinatura de PDF)** — ao assinar, o aplicativo envia **apenas o hash SHA-256 do valor da assinatura** (nunca o documento) à TSA configurada (`signTsaUrl`, padrão DigiCert pública; configurável em Configurações). Sem TSA válida, a assinatura é bloqueada (fail-closed). Evento `pdf.signed` registra o host da TSA.

Log, auditoria e diagnóstico não enviam dados para fora da estação.

### Cofre e criptografia

- AES-256-GCM com IV aleatório de 12 bytes, tag de 16 bytes e AAD `tabela:id:campo`.
- Chave-mestra de 32 bytes, protegida por `safeStorage`/DPAPI e gravada em `vault.key`.
- Derivação por finalidade com HKDF-SHA-256.
- Backups de certificado com Argon2id (64 MiB, 3 iterações) + AES-256-GCM e frase-senha mínima de 12 caracteres.
- Buffers de chave são zerados quando possível.

### Auditoria e logs

- Eventos de criação, alteração, arquivamento, importação, instalação, remoção, vínculo, seleção de certificado, abertura/fechamento de sessão, revelação, cópia, configuração e exportação.
- Metadados passam por `redactRecord` antes de serem gravados.
- Logs em `%APPDATA%\AurumBit Portal\logs\aurumbit-portal.log`, rotação em 10 MB.
- URLs logadas têm parâmetros sensíveis redigidos; PEM e blobs grandes são substituídos.

## Responsabilidades do operador

1. **Perfil dedicado.** Use um perfil Windows exclusivo para o AurumBit Portal, com senha forte e bloqueio automático do sistema.
2. **Disco cifrado.** Ative BitLocker (ou equivalente) na estação. O DPAPI protege a chave, não o disco roubado desligado.
3. **Mínimo privilégio.** Não execute o aplicativo como administrador. A importação em `CurrentUser\My` não exige elevação.
4. **Autorização do titular.** Obtenha e registre consentimento para usar o certificado e os dados do cliente. O campo de consentimento no cadastro é um registro, não a autorização em si.
5. **Certificados de teste.** Nunca use certificado de produção em spike, VM compartilhada ou máquina de terceiros. Prefira um A1 de teste e uma VM descartável.
6. **Backup.** Exporte o PFX original e, se usar o recurso, o envelope `.pvbackup` com frase-senha forte; mantenha cópia offline. A versão 0.1.x não restaura `.pvbackup` pela interface, então preserve o PFX. O banco não tem backup automático.
7. **Atualizações.** Atualize Electron, Chromium e dependências. A URL de updates do projeto é um placeholder e deve ser configurada antes de usar auto-update.
8. **Revisão de certificados.** Monitore vencimento, ausência no repositório e problemas de cadeia relatados pelo portal. Remova certificados que não são mais usados.
9. **Limpeza.** Ao encerrar o uso de um cliente, arquive o cliente, remova o certificado do Windows quando aplicável, apague credenciais e avalie a remoção da pasta de dados.
10. **Auditoria.** Exporte e proteja os registros conforme a política de retenção. A versão 0.1.x não purga auditoria automaticamente.

## Alterações no repositório de certificados do Windows

O aplicativo pode **listar**, **instalar** e **remover** certificados em `Cert:\CurrentUser\My`. Essas ações:

- são iniciadas por uma ação explícita na interface;
- geram auditoria;
- não são executadas pelos scripts de spike;
- não elevam privilégios nem tocam em `LocalMachine`;
- podem ser revertidas pela própria interface ou por PowerShell, com confirmação.

Antes de qualquer alteração manual no repositório (inclusive durante o spike), exija **confirmação explícita por escrito** do responsável, identifique o thumbprint e faça backup do PFX. Nunca execute `Remove-Item Cert:\...` em massa ou por padrão.

## Limitações conhecidas de segurança

- A3, token, smart card e PIN não são suportados.
- O bloqueio manual encerra sessões, mas não exige autenticação para reabrir o aplicativo. `idleLockMinutes` não é aplicado automaticamente nesta versão.
- `retainAuditDays` é uma preferência armazenada; não há purga automática.
- Partições persistentes mantêm cookies/storage após o fechamento da janela.
- O banco SQLite não é integralmente cifrado.
- A chave-mestra não tem rotação nem recuperação própria; depende do DPAPI e de backup.
- A cadeia ICP-Brasil não é validada ativamente no import; o status `chain_incomplete` não é calculado na versão 0.1.x. A recusa por cadeia aparece no handshake do portal.
- O AurumBit Portal não instala raízes ICP-Brasil: a estação precisa confiar nelas no repositório do Windows (política de TI), senão o portal gov.br exibe erro de certificado e o certificado nunca chega a ser solicitado.
- O backup `.pvbackup` é somente exportação; não há restauração pela interface nesta versão.
- A interface menciona “chave não exportável” na importação, mas o fluxo usa `Import-PfxCertificate` sem fixar essa propriedade. Não trate a chave como necessariamente não exportável; proteja o PFX e o perfil Windows.
- Não há assinatura de código configurada no repositório; o instalador deve ser assinado antes de distribuição externa.
- A URL de atualização é um placeholder inseguro para produção (`updates.aurumbit.invalid`).
- O teste de injeção valida o handshake local, não a aceitação por um portal real.

## Resposta a incidentes

1. **Conter:** feche as sessões, bloqueie a estação, desconecte da rede se houver suspeita de exfiltração.
2. **Preservar:** copie logs, eventos de auditoria e o banco antes de limpar; registre horários e usuários.
3. **Revogar:** revogue o certificado na AC, troque senhas afetadas e invalide sessões nos portais.
4. **Erradicar:** remova malware, atualize o sistema, reinstale o aplicativo a partir de uma build confiável.
5. **Recuperar:** restaure dados de backup verificado; não reutilize `vault.key` de uma máquina comprometida.
6. **Comunicar:** avalie notificação à ANPD e aos titulares conforme LGPD e prazos aplicáveis, com apoio jurídico.
7. **Aprender:** documente causa raiz, controles falhos e ações corretivas.

## Boas práticas de desenvolvimento

- Execute `npm run typecheck`, `npm run lint`, `npm test` e `npm run test:e2e` antes de distribuir.
- Não registre segredos em logs, auditoria, mensagens de erro ou testes.
- Não enfraqueça `contextIsolation`, `sandbox`, CSP ou validação de IPC para “facilitar” uma integração.
- Não adicione proxy TLS/MITM, CA raiz ou desabilitação de verificação de certificado em produção.
- Trate qualquer novo canal remoto como mudança de modelo de ameaça e registre um ADR.
