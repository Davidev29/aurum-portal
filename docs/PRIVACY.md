# Privacidade e LGPD

Este documento descreve como o AurumBit Portal trata dados pessoais na versão 0.1.x. Ele é um modelo operacional e **não substitui** a avaliação jurídica da organização, o registro de operações de tratamento nem a política de privacidade institucional.

## Papéis

O AurumBit Portal é uma ferramenta local instalada na estação de trabalho. A organização que o utiliza (escritório, departamento ou prestador) é a **controladora** dos dados pessoais inseridos. A equipe do AurumBit Portal não opera um backend, não recebe os dados e não atua como operadora de tratamento.

O usuário do Windows que opera o aplicativo é responsável por:

- ter base legal e autorização para tratar os dados dos clientes;
- limitar o acesso ao perfil do Windows;
- atender solicitações de titulares;
- definir prazos de retenção e descarte;
- contratar e supervisionar fornecedores, quando houver.

## Dados tratados

| Categoria | Exemplos | Onde fica | Proteção |
| --- | --- | --- | --- |
| Cadastro de clientes | Nome, tipo PF/PJ, CPF/CNPJ, e-mail, telefone, tags, notas, consentimento | SQLite local | Banco não cifrado integralmente; acesso pelo perfil do Windows |
| Credenciais | Rótulo, usuário, senha, notas, indicador de senha padrão | SQLite local | Senha cifrada com AES-256-GCM; nota e usuário em claro |
| Certificados | Titular, documento, DN, emissor, série, thumbprints, validade, status | SQLite local | Metadados em claro; PFX e senha do PFX cifrados |
| Sessões | Cliente, serviço, método, partição, status, URLs, erros, horários | SQLite local + partições | Metadados em claro; cookies/storage no perfil Chromium |
| Auditoria | Eventos de acesso, alteração, cópia, revelação, seleção de certificado | SQLite local | Metadados redigidos; sem senhas |
| Logs | Versão, caminhos, hostnames, erros, eventos técnicos | Arquivo local | Redaction de segredos e parâmetros sensíveis |
| Preferências | Tema, limites, tempos de revelação/cópia, retenção | SQLite local | Sem dados sensíveis por natureza |

Também podem existir dados temporários:

- arquivos PFX em pasta temporária do Windows durante a instalação, removidos ao final;
- área de transferência com senha copiada, limpa após o tempo configurado;
- memória do processo com chave-mestra e segredos enquanto o aplicativo está aberto;
- artefatos de spike em `scripts/spike/.certs`, que não devem ser usados com dados reais.

## Finalidades e bases legais

O tratamento depende do contexto da organização. As bases típicas são:

- **Execução de contrato** ou procedimentos preliminares: cadastro do cliente, credenciais e acesso a portais para prestar o serviço contratado.
- **Cumprimento de obrigação legal ou regulatória**: guarda de registros, auditoria e comprovação de atos.
- **Legítimo interesse**: segurança da informação, prevenção a fraude, continuidade e melhoria operacional, com avaliação de impacto e salvaguardas.
- **Consentimento**: quando exigido para uso de certificado ou tratamento específico. O campo “consentimento” no cadastro registra a data, mas não substitui o instrumento de autorização.

O operador deve avaliar a base legal antes de inserir dados de terceiros e não deve usar o aplicativo para finalidades incompatíveis com a autorização obtida.

## Compartilhamento

O aplicativo **não vende, não aluga e não compartilha** dados com a equipe do AurumBit Portal. Não há telemetria, analytics, crash reporting remoto nem sincronização em nuvem.

Há dois fluxos externos que o operador deve conhecer:

1. **Portais acessados.** Ao abrir um portal, o Chromium envia a requisição diretamente ao site, incluindo cookies, user agent e, quando aplicável, o certificado cliente no handshake TLS. O tratamento pelo portal segue a política do próprio portal.
2. **Verificação de atualizações.** Quando habilitada no aplicativo empacotado, o `electron-updater` consulta o servidor configurado e pode enviar versão, plataforma e identificadores técnicos padrão. No repositório, a URL é um placeholder (`updates.aurumbit.invalid`) e a verificação automática vem desativada por padrão.

Links externos abrem no navegador padrão, fora do cofre e das partições isoladas, e estão sujeitos à política do navegador e do site.

## Retenção e descarte

Não há prazo automático imposto pelo produto. A organização deve definir prazos conforme a finalidade, o contrato, a legislação fiscal e as obrigações profissionais.

- **Clientes e credenciais:** permanecem até exclusão, arquivamento ou remoção da pasta de dados.
- **Certificados:** metadados permanecem no banco; o PFX pode ser removido do cofre e do Windows. A remoção do Windows não apaga automaticamente o registro histórico.
- **Sessões:** registros históricos permanecem; partições persistentes acumulam cookies e storage até limpeza manual.
- **Auditoria:** permanece no banco. A configuração `retainAuditDays` existe, mas **não há purga automática na versão 0.1.x**. A exclusão exige intervenção no banco ou remoção da pasta de dados.
- **Logs:** rotativos em 10 MB; a política de retenção é do sistema operacional ou do operador.
- **Backups:** a retenção é definida pelo operador. Backups de certificado são cifrados com a frase-senha escolhida; sem ela, não há recuperação. A versão 0.1.x exporta `.pvbackup`, mas não restaura esse envelope pela interface.

Para descarte completo, feche o aplicativo e remova `%APPDATA%\AurumBit Portal`. Antes, exporte o que precisa ser preservado e revogue certificados que não serão mais usados. A remoção da pasta é irreversível.

## Direitos dos titulares

Titulares podem solicitar confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação, portabilidade, informação sobre compartilhamento e revogação de consentimento, nos termos da LGPD.

O canal deve ser definido pela organização controladora. O aplicativo oferece recursos que ajudam a atender pedidos:

- consulta e edição de clientes;
- exportação de clientes em CSV;
- exportação de auditoria em CSV/JSON;
- revelação controlada de credenciais;
- remoção de certificados e vínculo com clientes;
- arquivamento de clientes.

A resposta ao titular deve ser dada pela organização, não pela equipe do AurumBit Portal. Solicitações que envolvam dados de terceiros ou segredos de outros clientes devem passar por verificação de identidade e análise jurídica.

## Segurança

As medidas técnicas estão detalhadas em [SECURITY.md](SECURITY.md). Em resumo:

- criptografia de segredos e PFX com AES-256-GCM;
- chave-mestra protegida por DPAPI/safeStorage;
- isolamento de sessões por cliente e certificado;
- seleção explícita de certificado;
- controle de acesso pelo perfil do Windows;
- validação de IPC, CSP, sandbox e permissões negadas;
- redaction de logs e auditoria;
- backups de certificado com Argon2id.

Nenhum controle é absoluto. O operador deve complementar com BitLocker, antivírus, atualizações, bloqueio de tela, política de senhas, backup offline e treinamento.

## Transferência internacional

O aplicativo não transfere dados para o exterior por si só. O acesso a portais e a verificação de atualizações podem envolver servidores fora do Brasil, conforme a infraestrutura de cada serviço. A organização deve avaliar essas transferências e as salvaguardas dos fornecedores.

## Crianças e adolescentes

O produto é destinado a uso profissional e não é projetado para tratamento de dados de crianças ou adolescentes. Se o contexto exigir, o operador deve observar o melhor interesse e as regras específicas da LGPD.

## Alterações

Este documento pode ser atualizado com a evolução do produto. Mudanças relevantes de tratamento, compartilhamento ou segurança devem ser comunicadas aos operadores e registradas em um novo ADR quando alterarem o modelo de ameaça.

## Contato

Canal interno configurado no projeto: `suporte@aurumbit.local`. Substitua pelo contato oficial da organização, pelo encarregado de dados (DPO) e pelo canal de incidentes antes de distribuir o aplicativo.

**Última atualização:** 4 de novembro de 2026.
