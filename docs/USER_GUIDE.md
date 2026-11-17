# Guia do usu??rio

Este guia cobre o uso di??rio do AurumBit Portal 0.1.x em Windows 10/11. Para instala????o, build e diagn??stico, consulte o [README](../README.md) e o [SPIKE_GO_NO_GO](SPIKE_GO_NO_GO.md).

## 1. Antes de come??ar

### Requisitos

- Windows 10 ou 11, x64.
- Perfil Windows dedicado, com senha forte e bloqueio de tela.
- Certificado digital **A1** em `.pfx` ou `.p12`, v??lido e com chave privada.
- Autoriza????o do titular para tratar os dados e usar o certificado.
- Acesso aos portais que ser??o abertos.

### O que o aplicativo n??o faz

- N??o suporta A3, token, smart card ou PIN.
- N??o sincroniza dados com nuvem.
- N??o faz backup autom??tico.
- N??o gerencia certificados fora de `Cert:\CurrentUser\My`.
- N??o substitui o site oficial do portal nem valida juridicamente um certificado.

### Primeiro uso

1. Abra o AurumBit Portal.
2. Confira se o cofre abriu. Se o `safeStorage/DPAPI` estiver indispon??vel, o aplicativo encerra para proteger os dados.
3. Abra **Configura????es** e revise os tempos de revela????o/c??pia, o limite de sess??es e o comportamento ao fechar.
4. Cadastre um cliente.
5. Importe ou vincule um certificado A1.
6. Cadastre uma credencial, se o portal usar senha.
7. Abra o portal pela **Store**.

## 2. Vis??o geral da interface

| ??rea | Para que serve |
| --- | --- |
| **Store** | Abre portais, mostra sess??es abertas e certificados a vencer. |
| **Clientes** | Cadastro dos titulares, consentimento, tags, arquivamento e exporta????o CSV. |
| **Obrigações** | Calendário do mês com baixa de entregas por cliente, catálogo de obrigações recorrentes, matriz cliente × obrigação, grupos reutilizáveis e avisos de vencimento. | 
| **Certificados** | Importa????o PFX, leitura do Windows, v??nculo, teste, backup e remo????o. |
| **Credenciais** | Usu??rios e senhas por cliente/servi??o, gera????o e c??pia. |
| **Sess??es** | Lista, foco e encerramento das janelas abertas. |
| **Auditoria** | Consulta e exporta????o dos eventos. |
| **Configura????es** | Prefer??ncias locais, informa????es do sistema, logs e atualiza????o. |

O rodap?? da barra lateral mostra **Bloquear e fechar sess??es**. Ele encerra todas as janelas de portal e registra o evento, mas n??o cria uma senha de desbloqueio: a prote????o continua sendo a conta do Windows.

## 3. Clientes

### Cadastrar

1. Abra **Clientes** e clique em **Novo cliente**.
2. Escolha **Pessoa jur??dica** ou **Pessoa f??sica**.
3. Informe raz??o social/nome completo e CPF/CNPJ. O documento ?? validado localmente.
4. Preencha e-mail, telefone, tags e observa????es, se necess??rio.
5. Marque a declara????o de autoriza????o do titular (LGPD).
6. Clique em **Cadastrar cliente**.

O CPF/CNPJ ?? ??nico. Se precisar corrigir um documento, edite o cadastro; n??o crie duplicata.

### Editar, arquivar e exportar

- **Editar:** abra o cliente e altere os campos.
- **Arquivar:** remove o cliente das listas ativas e impede novas sess??es. O hist??rico permanece.
- **Restaurar:** reativa um cliente arquivado.
- **Exportar CSV:** dispon??vel na lista de clientes; o arquivo ?? gravado com BOM para abrir corretamente no Excel.

Antes de arquivar, feche as sess??es e avalie se o certificado deve ser removido do Windows.

## 4. Certificados A1

### Formas de importa????o

| Origem | Quando usar | O que acontece |
| --- | --- | --- |
| **Importar PFX** | Voc?? tem o arquivo `.pfx`/`.p12` e a senha. | O PFX e a senha s??o cifrados no cofre; opcionalmente o certificado ?? instalado em `Cert:\CurrentUser\My`. |
| **Importar do Windows** | O certificado j?? est?? instalado no perfil. | O aplicativo l?? os certificados com chave privada e cria o registro no cofre, sem copiar o PFX. |

### Importar PFX

1. Abra **Certificados** e clique em **Importar PFX**.
2. Selecione um ou mais arquivos `.pfx`/`.p12` (m??ximo de 20 MB por arquivo).
3. Informe a senha. Marque **Usar a mesma senha para todos os arquivos** se for o caso.
4. Escolha um cliente ou deixe **Detectar automaticamente pelo documento**.
5. Decida se deseja **instalar no reposit??rio do Windows** em `Cert:\CurrentUser\My`.
6. Marque a confirma????o de autoriza????o do titular quando houver v??nculo com cliente.
7. Revise o resultado: sucesso, duplicado, vencido ou erro.

Um arquivo inv??lido n??o interrompe os demais. Duplicatas s??o identificadas pelo thumbprint SHA-256 e podem atualizar o v??nculo com o cliente.

> **Aten????o:** o texto da interface menciona ???chave n??o export??vel???, mas a instala????o usa `Import-PfxCertificate` sem fixar essa propriedade. N??o trate a chave como necessariamente n??o export??vel. Proteja o PFX original e o perfil Windows.

### Importar do Windows

1. Clique em **Importar do Windows**.
2. Selecione um ou mais certificados com chave privada.
3. Escolha o cliente e confirme a autoriza????o.
4. Clique em **Importar**.

Certificados sem chave privada n??o aparecem. A lista mostra titular, emissor, validade e se o certificado j?? foi importado.

### Vincular a um cliente

Um certificado pode atender mais de um cliente, desde que haja autoriza????o para cada v??nculo.

1. Na lista de certificados, clique no ??cone de v??nculo.
2. Escolha o cliente.
3. Confirme a autoriza????o.
4. Salve.

Sem v??nculo, o certificado n??o pode ser usado em sess??es. O aplicativo n??o usa um ???cliente atual??? global.

### Testar a inje????o mTLS

O teste sobe um servidor HTTPS ef??mero em `127.0.0.1` que exige certificado de cliente e verifica qual certificado o Windows apresentou.

1. Instale o certificado no Windows.
2. Clique no ??cone de tubo de ensaio.
3. Confira se o thumbprint apresentado ?? igual ao esperado.

O teste valida a instala????o, a chave privada e a capacidade do Chromium/Windows de apresentar o certificado. Ele **n??o** valida a cadeia ICP-Brasil ativamente, **n??o** garante que um portal real aceite o certificado e **n??o** substitui um teste no ambiente oficial.

### Instalar, remover e fazer backup

- **Instalar no Windows:** usa o PFX do cofre e instala em `Cert:\CurrentUser\My`; n??o exige administrador.
- **Remover do Windows:** exige digitar `REMOVER` e falha se o certificado estiver em uso por uma sess??o aberta. Remove apenas a c??pia do reposit??rio do usu??rio; o registro no cofre permanece.
- **Backup criptografado:** exporta o PFX protegido por frase-senha de pelo menos 12 caracteres. Guarde a frase separadamente. Sem ela, o backup ?? irrecuper??vel.

### Status exibidos

| Status | Significado | A????o sugerida |
| --- | --- | --- |
| **V??lido** | Dentro da validade e instalado quando necess??rio. | Nenhuma. |
| **A vencer** | Faltam 30 dias ou menos para o **vencimento efetivo**, ou seja, a data final do ??ltimo certificado v??lido da cadeia de renova????o (do mesmo CPF/CNPJ). | Planeje a renova????o. |
| **Vencido** | A validade passou. | N??o autentica; importe o certificado renovado. |
| **Somente no cofre** | PFX importado, mas n??o instalado no Windows. | Instale antes de abrir sess??o por certificado. |
| **Ausente no Windows** | O certificado sumiu do reposit??rio. | Reinstale ou importe novamente. |
| **Cadeia incompleta** | Status reservado no modelo e no filtro; a vers??o 0.1.x n??o calcula a cadeia automaticamente. | Se o portal recusar por cadeia, instale a cadeia ICP-Brasil no Windows e repita o teste. |

## 5. Credenciais

### Cadastrar

1. Abra **Credenciais** e clique em **Nova credencial**.
2. Escolha cliente e servi??o.
3. Informe um r??tulo (por exemplo, ???Matriz???, ???Filial SP???).
4. Selecione o tipo de usu??rio: CPF, CNPJ, e-mail ou outro.
5. Informe usu??rio e senha.
6. Marque **Padr??o** se esta for a credencial preferida daquele cliente/servi??o.
7. Salve.

A senha ?? cifrada com AES-256-GCM e n??o ?? gravada em texto claro no banco.

### Revelar e copiar

- **Revelar** mostra a senha por tempo limitado (`passwordRevealSeconds`, padr??o 12 s). Ao expirar, a interface deve ocult??-la novamente.
- **Copiar** grava a senha na ??rea de transfer??ncia e agenda a limpeza (`clipboardClearSeconds`, padr??o 30 s). A limpeza s?? ocorre se o conte??do ainda for o valor copiado.
- C??pias feitas manualmente, por menu de contexto ou dentro de um formul??rio podem n??o seguir essa limpeza. Apague a ??rea de transfer??ncia ao terminar.

Revela????o e c??pia s??o registradas na auditoria sem o valor da senha.

### Gerar senha

O bot??o de gera????o cria uma senha de 24 caracteres com mai??sculas, min??sculas, n??meros e s??mbolos. Voc?? pode editar antes de salvar. A for??a ?? exibida no formul??rio, mas n??o impede o salvamento.

### Reutiliza????o

O aplicativo calcula uma impress??o digital HMAC da senha para sinalizar reutiliza????o entre credenciais. O valor n??o permite recuperar a senha e n??o ?? um hash global.

## 6. Store (servi??os)

A Store ?? a ??nica tela de servi??os: cat??logo, gest??o e abertura de portais acontecem nela ??? n??o h?? tela separada de "Servi??os".

### Servi??os embutidos

| Servi??o | Categoria | M??todos |
| --- | --- | --- |
| gov.br | Governo Federal | Certificado e senha |
| Redesim | Governo Federal | Certificado e senha |
| e-CAC | Governo Federal | Certificado e senha |
| JUcec-CE | Governo Estadual | Certificado e senha |
| Pend??ncias CNPJ | Governo Federal | Certificado e senha |
| FGTS Digital | Governo Federal | Certificado e senha |
| eSocial | Governo Federal | Certificado e senha |
| DTE Trabalhista | Governo Federal | Certificado e senha |
| SIGA SEFAZ-CE | Governo Estadual | Certificado e senha |
| Simples Nacional | Governo Federal | Certificado e senha |
| Registrato | Governo Federal | Certificado e senha |
| DTE SEFAZ-CE | Governo Estadual | Certificado e senha |

Os servi??os embutidos podem ser restaurados nas configura????es ou na Store ("Restaurar nativos"). As automa????es de login s??o assistidas: nos servi??os de senha gerados pelo cadastro, o aplicativo preenche usu??rio e senha e clica em Entrar por padr??o ("Entrar sozinho") — desligue no cadastro do servi??o para revisar o preenchimento antes de enviar.

### Criar servi??o personalizado ("Novo site")

O cadastro de um novo site pede apenas duas informa????es e uma escolha ??? nada t??cnico. A automa????o de login ?? configurada sozinha.

1. Na Store, clique em **Novo site**.
2. Informe o **nome do site** (como voc?? se refere a ele, por exemplo "SEFAZ da empresa").
3. Informe o **endere??o do site** (por exemplo `portal.sefaz.gov.br` ??? o `https://` ?? adicionado automaticamente quando voc?? n??o digita).
4. Escolha **Como voc?? entra nesse site?**:
   - **Certificado digital** ??? A1 via Windows;
   - **Login e senha** ??? o aplicativo preenche usu??rio e senha, voc?? clica em Entrar;
   - **Os dois** ??? escolha na hora de abrir o portal.
5. Clique em **Adicionar site**.

O que acontece por baixo dos panos:

- o endere??o ?? validado (HTTPS) e o nome do site ganha um identificador interno autom??tico;
- o endere??o sem protocolo recebe `https://` sozinho e **par??metros de sess??o vol??teis s??o removidos** (`cid`, `session_code`, `tab_id`, `authorization_id` etc. ??? c??digos que mudam a cada acesso e invalidariam o portal no dia seguinte);
- a allowlist de dom??nios do servi??o ?? derivada do pr??prio endere??o (host, dom??nio pai e, para sites `.gov.br`, os dom??nios de identidade gov.br);
- a logomarca ?? buscada do site automaticamente;
- a **automa????o de login ?? gerada automaticamente**: 
  - sites com bot??o de entrada (ex.: portais municipais como o ISS Fortaleza, com "Fazer login" ??? Keycloak/SSO) s??o conduzidos por um **fluxo ag??ntico**: o app observa a tela (o que existe, onde est??), decide a a????o certa (clicar em "Fazer login", preencher CPF, avan??ar, preencher senha e clicar em Entrar) e repete o ciclo at?? o portal autenticar ??? tudo local, sem IA externa, sem nunca enviar o conte??do da p??gina para fora;
  - sites do governo com login ??nico gov.br seguem o fluxo certificado validado (interstitial ??? SSO);
  - nenhum seletor precisa ser configurado: o preenchimento inspeciona o formul??rio da pr??pria p??gina no momento da abertura.
- se quiser revisar antes de enviar, abra o servi??o ??? **Editar** ??? **Op????es avan??adas** ??? desligue **Entrar sozinho**;
- na primeira abertura e nos logins seguintes, o aplicativo monitora a sess??o e marca a automa????o como ativa (ou com falha, se o site mudar);
- durante a automa????o o portal fica oculto e a tela de sess??o exibe a anima????o de boot ("Entrando no ???") ??? se for preciso intervir (captcha/2FA) ou se algo falhar, o portal ?? revelado (ou voc?? clica em "Abrir o portal mesmo assim").

Se o site do governo tiver SSO em outro dom??nio, tudo continua autom??tico: a navega????o para qualquer `.gov.br` ?? aceita automaticamente.

Ajustes finos (op????es t??cnicas ??? normalmente n??o s??o necess??rios):

1. Clique no servi??o ??? **Editar** ??? **Op????es avan??adas**.
2. L?? ficam o identificador interno, a categoria, a allowlist, o m??todo padr??o, notas, ativo/favorito e a se????o **Automa????o deste servi??o**:
   - **Testar lado do site** ??? confere se o site responde;
   - **Regenerar automa????o** ??? recria a automa????o a partir do cadastro atual (??til se o site mudou);
   - **Entrar sozinho** ??? o aplicativo clica em Entrar ap??s preencher CPF/senha (desligado, voc?? clica para finalizar, mais seguro);
   - **Buscar logomarca** ??? carrega o favicon do dom??nio;
   - **Editor de receita (JSON)** ??? edi????o t??cnica da receita de preenchimento (para quem conhece seletores);
3. Duplicar um servi??o tamb??m copia a automa????o para a c??pia.

Regras importantes:

- A allowlist aceita dom??nios exatos e curingas (`*.exemplo.com.br`).
- Navega????es e redirecionamentos para fora da allowlist s??o bloqueados (hosts `.gov.br` s??o sempre aceitos).
- Um dom??nio sem curinga cobre apenas o host exato; para subdom??nios, use `*.exemplo.com.br`.
- O servi??o pode ser desabilitado, favoritado, duplicado ou exclu??do.

## 7. Abrir uma sess??o

### Por Acessos (certificado primeiro)

1. Abra **Acessos** no menu.
2. Selecione o certificado e clique em **Avan??ar para os portais**.
3. Se o certificado atender mais de um cliente, escolha o cliente no topo da tela.
4. Use **Entrar** no portal. Se houver janela aberta deste certificado, ela ?? focada.
5. Se n??o houver, o portal abre reutilizando a **parti????o persistente por cliente e certificado**: se j?? houver cookies salvos, ele abre **j?? logado** (sujeito ?? expira????o da sess??o do portal).

Na tela de portais, os cart??es nativos e adicionados mostram **J?? logado** quando a janela aberta daquele certificado j?? foi autenticada, **Dispon??vel** quando ainda n??o h?? sess??o, e o erro de login quando a ??ltima tentativa falhou. A inje????o mTLS usa somente o certificado selecionado, sem prompt, independentemente do portal.

### Por certificado (Store)

1. Na Store, clique em **Abrir** no servi??o.
2. Escolha o m??todo **Certificado**.
3. Selecione o cliente.
4. Selecione o certificado vinculado.
5. Marque **For??ar nova sess??o** apenas se quiser ignorar a sess??o existente.
6. Clique em **Abrir portal**.

O aplicativo:

- valida o v??nculo e o status do certificado;
- instala o PFX no Windows se necess??rio;
- cria uma parti????o isolada por cliente e certificado;
- abre o portal em uma janela pr??pria;
- no handshake TLS, apresenta somente o certificado daquela sess??o, e apenas para dom??nios permitidos.

Se o portal n??o oferecer o certificado, a autentica????o ?? cancelada e o erro ?? auditado. Verifique instala????o, cadeia, validade e se o portal aceita A1.

Se a sess??o exibir **???O portal tentou autenticar em um dominio fora da allowlist???**, o portal pediu o certificado em um endere??o que n??o ?? `.gov.br` e n??o est?? na allowlist do servi??o. Portais v??lidos do governo autenticam em subdom??nios de `.gov.br` (por exemplo, `certificado.sso.acesso.gov.br`) e s??o aceitos automaticamente. Se isso acontecer mesmo assim, anote o dom??nio exibido na auditoria (evento `certificate.not_offered`) e relate o problema. Para um portal pr??prio hospedado fora de `.gov.br`, edite o servi??o e inclua o dom??nio de SSO na allowlist (por exemplo, `*.empresa.com.br`).

Certificados de cliente nunca s??o enviados por conex??o sem criptografia (**HTTPS**); se a p??gina estiver em `http://`, o certificado n??o ?? apresentado.

### Por senha

1. Escolha o m??todo **Senha**.
2. Selecione o cliente e a credencial.
3. Abra o portal.

A automa????o pode preencher usu??rio e senha. O envio ?? sempre manual; captcha, MFA e confirma????es continuam sob controle do usu??rio. Portais adicionados pelo "Novo site" recebem a automa????o automaticamente; se o site mudar, use **Regenerar automa????o** em Op????es avan??adas.

### Reutiliza????o de sess??o

Uma sess??o existente ?? focada quando cliente, servi??o, m??todo e certificado/credencial coincidem. Para abrir outra, marque **For??ar nova sess??o**.

### Janela da sess??o

- A barra superior identifica cliente, servi??o, m??todo e certificado.
- H?? controles de navega????o, recarregar, parar, zoom e abrir no navegador externo.
- O conte??do remoto roda em `WebContentsView` isolado, sem Node.js e sem acesso ao IPC da UI.
- Popups de OAuth herdam a mesma parti????o e o contexto de certificado.
- Downloads de execut??veis e scripts perigosos s??o cancelados. Outros downloads v??o para a pasta padr??o de Downloads.
- Links externos saem da sess??o e abrem no navegador padr??o, com confirma????o quando configurado.
- Fechar a janela encerra a sess??o, mas **n??o apaga** cookies e storage da parti????o persistente.

### Limite de sess??es

O padr??o ?? 20 sess??es simult??neas, configur??vel entre 2 e 40. Ao atingir o limite, feche uma sess??o ou aumente o valor em Configura????es.

## 8. Sess??es abertas

A tela **Sess??es** mostra cliente, servi??o, m??todo, certificado, URL, status e tempo. Use:

- **Focar** para trazer a janela para frente;
- **Encerrar** para fechar a sess??o e registrar o evento.

Encerrar n??o limpa a parti????o. Para remover cookies/storage, ?? necess??rio limpar a pasta de dados ou a parti????o correspondente fora do aplicativo; n??o h?? bot??o de limpeza por sess??o nesta vers??o.

## 9. Auditoria

A tela **Auditoria** permite filtrar por tipo, entidade e per??odo. Cada evento mostra data, tipo, entidade, id e metadados redigidos.

Eventos comuns:

- `client.created`, `client.updated`, `client.archived`, `client.consent_recorded`;
- `certificate.imported`, `certificate.installed`, `certificate.removed`, `certificate.linked`;
- `certificate.selected`, `certificate.not_offered`, `certificate.test_completed`;
- `credential.created`, `credential.revealed`, `credential.copied`;
- `session.opened`, `session.closed`, `session.auth_detected`;
- `settings.updated`, `audit.exported`, `app.locked`.

Exporte em CSV ou JSON. O arquivo ?? gravado no local escolhido e o evento de exporta????o tamb??m ?? auditado.

> A configura????o `retainAuditDays` existe, mas a vers??o 0.1.x **n??o purga** eventos automaticamente. A reten????o efetiva depende de interven????o manual ou remo????o da pasta de dados.

## 10. Configura????es

| Op????o | Padr??o | Efeito |
| --- | --- | --- |
| Tema | Seguir o Windows | Apar??ncia clara, escura ou do sistema. |
| Mascarar senhas | Ativado | Exibe bullets at?? revela????o expl??cita. |
| Ocultar senha revelada em | 12 s | Tempo de exibi????o da senha. |
| Limpar ??rea de transfer??ncia em | 30 s | Tempo de limpeza ap??s c??pia. |
| Confirmar abertura de link externo | Ativado | Pede confirma????o antes de sair para o navegador. |
| Limite de sess??es simult??neas | 20 | Entre 2 e 40. |
| Bloquear ap??s inatividade | 0 (desativado) | Prefer??ncia armazenada; **n??o h?? bloqueio autom??tico implementado** nesta vers??o. |
| Ao fechar a ??ltima janela | Perguntar | Pergunta ou encerra direto. |
| Reten????o da auditoria | 365 dias | Prefer??ncia armazenada; **n??o h?? purga autom??tica**. |
| Verificar atualiza????es automaticamente | Desativado | Depende de servidor de updates configurado. |
| Canal de atualiza????o | Est??vel | Est??vel ou beta, quando o servidor existir. |
| Consultar dados publicos de CNPJ | Desativado | Se ativado, importa certificados CNPJ consultando brasilapi.com.br para preencher a raz??o social; do contr??rio, usa o nome do titular do certificado. |

A tela **Sobre e diagn??stico** mostra vers??o, Electron, Chromium, Node, plataforma, caminho do banco, tamanho, pasta de logs, contagem de auditoria e disponibilidade do `safeStorage/DPAPI`.

## 11. Obrigações

O módulo **Obrigações** controla rotinas recorrentes por cliente (SPED, DCTF, FGTS, eSocial etc.), com avisos de vencimento na **central de avisos** (sino no topo da janela, ao lado da contagem de sessões).

### Visão do mês (calendário e baixas)

A aba padrão do módulo, **Obrigações**, mostra a competência do mês:

- **À esquerda**, a lista de empresas em ordem alfabética (com busca). Ao expandir uma empresa (dropdown), aparecem as obrigações vinculadas dela no mês, com as datas de vencimento e a situação (**Pendente**, **Vence hoje**, **Atrasada**, **Entregue**).
- **À direita**, o calendário do mês. Cada dia com obrigações mostra um número (quantidade de obrigações a vencer). O dia fica **verde** quando todas foram baixadas, **amarelo** quando há pendências e **vermelho** quando há atrasadas; bolinhas e cores seguem a legenda do rodapé do calendário.
- **Clique em qualquer dia** para abrir o modal. Sem vencimentos, ele mostra "Tudo tranquilo neste dia" — e, se for feriado, o nome dele com ícone e cor próprios. Com vencimentos, mostra as empresas que devem entregar e permite marcar o **check** de cada baixa (ou desmarcar). Feriados cadastrados aparecem no dia com o ícone e a cor escolhidos, e o modal oferece **Adicionar feriado** direto a partir do calendário.
- Use as setas para navegar entre os meses e **Hoje** para voltar ao mês atual.

**Competência do vínculo:** um vínculo novo vale a partir da competência em que foi criado. Se o vencimento do dia/mês já passou pela data de início do vínculo, a obrigação só conta a partir da competência seguinte (nunca “nasce atrasada”). Obrigações **eventuais** não têm vencimento e, por isso, não recebem baixa.

### Catálogo (departamentos e obrigações)

1. Abra **Obrigações → Departamentos** e cadastre as áreas (Fiscal, Trabalhista, Contábil…). Um departamento com obrigações vinculadas não pode ser excluído — inative-o.
2. Em **Obrigações → Catálogo**, cadastre cada rotina com nome, sigla (única por departamento), departamento, recorrência e regra de vencimento:
   - **Dia fixo do mês** (1–31) — em mês curto, vence no último dia;
   - **N-ésimo dia útil do mês** — desconsidera fins de semana e feriados (nacionais + extras de Configurações);
   - **Antecedência do aviso** — quantos dias antes do vencimento o aviso aparece na central.
3. Recorrências: mensal, bimestral, trimestral, semestral, anual (com mês de referência) e eventual (sem aviso automático).

### Matriz Clientes × Obrigações

- **Linhas**: clientes ativos; **colunas**: obrigações ativas (sigla). Passe o mouse sobre a sigla para ver nome completo e departamento.
- **Filtros**: departamentos (marque/desmarque vários), busca de cliente, grupo de obrigações e status do vínculo.
- Clique na célula para vincular; para desvincular, confirme — o vínculo fica **inativo** (histórico preservado). As ações de cada cliente (copiar/colar vínculos, **Gerenciar vínculos**, abrir ficha) aparecem **abaixo do nome do cliente** ao passar o mouse (ou ao focar com Tab). Em **Gerenciar vínculos** também se editam data de início/fim.

### Copiar e colar vínculos entre clientes

1. Passe o mouse sobre a linha de um cliente e clique em **Copiar vínculos** (ícone de cópia). O conteúdo fica só na memória de sessão.
2. Passe o mouse sobre outro cliente e clique em **Colar vínculos**: o sistema cria vínculos individuais, ignora os que já existem e informa o resumo (“X copiados, Y já existiam”). Reaplicar um vínculo inativo o reativa.

### Grupos de obrigações

Em **Obrigações → Grupos**, monte templates (ex.: “Lucro Presumido”) selecionando obrigações por checkbox. **Aplicar a clientes…** gera vínculos individuais por cliente — nunca um vínculo compartilhado. Vínculos já existentes são ignorados; inativos são reativados.

### Avisos de vencimento

O aplicativo confere diariamente (ao abrir e a cada 6 horas enquanto aberto) quais obrigações vencem na antecedência configurada e deposita o aviso na **central de avisos**. Não há e-mail nem usuários: o aviso é in-app, destinado ao operador. Clique em um aviso para marcá-lo como lido. Competências anteriores à criação do vínculo não geram aviso.

### Feriados

Em **Configurações → Feriados e dias não úteis**, adicione feriados municipais/estaduais escolhendo **ícone e cor** próprios (bandeira, bolo, igreja, palmeira…) — eles aparecem assim no calendário de Obrigações. Os nacionais (incluindo Carnaval, Sexta-feira da Paixão e Corpus Christi) são calculados automaticamente. Todos valem para o cálculo do N-ésimo dia útil. Também é possível cadastrar um feriado diretamente pelo **modal de um dia** no calendário ("Adicionar feriado"), com os mesmos seletores.


## 12. Backup e migra????o

### Backup de certificado

1. Abra **Certificados**.
2. Clique no ??cone de backup do certificado com PFX no cofre.
3. Defina uma frase-senha com pelo menos 12 caracteres.
4. Salve o arquivo `.pvbackup` cifrado em local seguro.

O backup cont??m o PFX cifrado com Argon2id + AES-256-GCM. Ele n??o cont??m a chave-mestra do cofre. Guarde a frase-senha separadamente. A vers??o 0.1.x apenas exporta esse envelope; n??o h?? importa????o/restaura????o de `.pvbackup` na interface.

### Backup dos demais dados

N??o h?? backup autom??tico do banco. Para preservar cadastros, credenciais e auditoria:

1. Feche o aplicativo.
2. Copie `%APPDATA%\AurumBit Portal\aurumbit-portal.db` e, se existir, `aurumbit-portal.db-wal`.
3. Proteja a c??pia com criptografia de disco e controle de acesso.

A c??pia do banco n??o ?? suficiente para abrir o cofre em outra m??quina: a chave `vault.key` est?? vinculada ao DPAPI do perfil. Para migrar, exporte os PFX individualmente e recadastre as credenciais, ou planeje a migra????o com o suporte.

### Restaura????o

- **Certificado:** a vers??o 0.1.x n??o restaura `.pvbackup` pela interface. Mantenha o PFX original para reimportar; o envelope cifrado s?? ?? ??til com decifra????o t??cnica externa usando a frase-senha.
- **Dados:** restaure o banco com o aplicativo fechado e mantenha o mesmo perfil Windows/chave.
- **Teste:** ap??s restaurar, execute o teste de inje????o e abra uma sess??o de teste.

## 13. Seguran??a no dia a dia

- Use um perfil Windows exclusivo e bloqueie a tela ao se afastar.
- Ative BitLocker.
- N??o use certificados de produ????o em spike, VM ou m??quina de terceiros.
- Confira o titular e o thumbprint antes de autenticar.
- N??o compartilhe senhas por chat, e-mail ou planilha.
- Limpe a ??rea de transfer??ncia ap??s copiar segredos.
- Feche sess??es que n??o est??o em uso.
- Revogue certificados comprometidos na AC e troque as senhas.
- Exporte a auditoria periodicamente e proteja os arquivos.
- Antes de descartar a esta????o, remova certificados e a pasta `%APPDATA%\AurumBit Portal`.

## 14. Perguntas frequentes

**O AurumBit Portal guarda minhas senhas na nuvem?**
N??o. Tudo fica na esta????o. N??o h?? backend nem telemetria.

**Posso usar certificado A3?**
N??o. A3, token, smart card e PIN n??o s??o suportados nesta vers??o.

**Por que o portal n??o aceita meu certificado?**
Verifique validade, chave privada, cadeia ICP-Brasil, v??nculo com o cliente, instala????o em `CurrentUser\My` e se o portal aceita A1. Rode o teste de inje????o.

**Fechar a sess??o apaga os cookies?**
N??o. A parti????o ?? persistente. O aplicativo n??o limpa cookies/storage ao fechar a janela.

**O bloqueio por inatividade funciona?**
A op????o ?? armazenada, mas o bloqueio autom??tico n??o est?? implementado na vers??o 0.1.x. Use o bloqueio do Windows.

**A auditoria ?? apagada ap??s o prazo configurado?**
N??o automaticamente. A purga precisa ser feita manualmente.

**O que acontece se eu perder o `vault.key`?**
O cofre n??o abre. Restaure um backup ou recadastre os dados. N??o h?? recupera????o pela equipe do AurumBit Portal.

**Posso abrir dois clientes no mesmo portal ao mesmo tempo?**
Sim, em janelas e parti????es separadas, desde que cada um tenha certificado/credencial e limite dispon??vel.

**O aplicativo funciona offline?**
Cadastro, consulta e auditoria sim. Os portais exigem rede.

**O link externo ?? seguro?**
Ele sai do isolamento e abre no navegador padr??o. Confirme a URL e mantenha a op????o de confirma????o ativada.

Para problemas, consulte [SUPPORT.md](SUPPORT.md).


## 15. Assinaturas digitais (PAdES-B-T)

Assine PDFs com certificado ICP-Brasil A1 do cofre. O documento original nunca e sobrescrito: e gerado <nome>-assinado.pdf ao lado dele. A assinatura e PAdES-B-T (com carimbo de tempo RFC 3161) e pode ser verificada em https://validar.iti.gov.br e no Adobe Acrobat/Reader (com raizes ICP-Brasil instaladas).

O carimbo visual e premium: cabe??alho azul-marinho com t??tulo "ASSINADO DIGITALMENTE", selo do ITI, filete dourado e QR para o validador do ITI. Exibe nome, documento, emissor do certificado (AC) e data ??? sem localiza????o. Os textos quebram/encolhem automaticamente para nunca estourarem o quadro; o bloco adota exatamente o tamanho desenhado (piso absoluto de 40 x 16 pt); abaixo do tamanho natural (140 x 104 pt) o conteudo encolhe proporcionalmente para caber, como o Adobe Reader escala a aparencia do carimbo. A pr??via tem zoom (50%???400%) e a posi????o do carimbo acompanha o zoom na mesma propor????o do documento.

Passos:
1. Abra Assinaturas no menu.
2. Escolha um certificado A1 com PFX no cofre (nao vencido).
3. Clique em Escolher PDF e selecione um arquivo (ate 50 MB). O original nao sera alterado.
4. Posicione o carimbo arrastando-o sobre a pagina e ajuste o tamanho (o tamanho do bloco desenhado e o tamanho do carimbo; conteudo encolhe proporcionalmente para caber). Use o zoom na barra inferior para ampliar e assinar onde desejar.
5. Revise e clique em Assinar PDF. Aguarde o carimbo de tempo.

A assinatura usa o PFX do cofre e nao depende do repositorio do Windows. Apenas o hash SHA-256 do valor da assinatura e enviado a TSA configurada (padrao DigiCert publica); o documento nunca sai da estacao. A TSA pode ser trocada em Configuracoes (com botao Testar TSA).

Para problemas, consulte SUPPORT.md.
