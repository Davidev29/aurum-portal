# Termos de uso

**AurumBit Portal — versão 0.1.x**

Estes termos regulam o uso do aplicativo desktop AurumBit Portal (“Aplicativo”). Ao instalar, copiar ou utilizar o Aplicativo, o usuário e a organização responsável (“Usuário”) declaram que leram e aceitaram estas condições. Se não concordarem, não utilizem o Aplicativo.

> Este documento é um modelo operacional. Ele deve ser revisado pelo jurídico da organização e adaptado ao contrato, à política interna e à legislação aplicável antes de distribuição externa.

## 1. Objeto

O AurumBit Portal é uma ferramenta local para Windows que organiza clientes, credenciais e certificados digitais A1 e abre portais públicos em sessões isoladas. O Aplicativo não é um serviço de nuvem, não hospeda dados e não presta consultoria jurídica, contábil ou de segurança.

## 2. Licença e uso permitido

A organização detentora do repositório concede ao Usuário uma licença limitada, não exclusiva, não transferível e revogável para instalar e usar o Aplicativo em estações sob seu controle, exclusivamente para fins profissionais internos.

Salvo autorização escrita, o Usuário não pode:

- redistribuir, vender, sublicenciar ou disponibilizar o Aplicativo a terceiros;
- remover avisos de autoria, versão ou segurança;
- usar o Aplicativo para operar em nome de titulares sem autorização;
- contornar controles de segurança, isolamento, allowlist ou seleção de certificado;
- realizar engenharia reversa para obter segredos ou chaves, exceto quando a lei permitir expressamente.

## 3. Responsabilidades do Usuário

O Usuário é responsável por:

1. manter a estação atualizada, protegida por senha, bloqueio de tela, antivírus e criptografia de disco;
2. usar um perfil Windows dedicado e não compartilhar a sessão com terceiros;
3. obter base legal, consentimento e autorização para tratar dados de clientes e usar certificados digitais;
4. conferir titular, documento, validade, cadeia e thumbprint do certificado antes de autenticar;
5. manter backups seguros e preservar o PFX original para restauração;
6. definir retenção, descarte e resposta a incidentes conforme a LGPD e as normas aplicáveis;
7. não usar certificados A3, token, smart card ou PIN, que não são suportados;
8. não usar o Aplicativo em máquina pública, compartilhada ou de terceiros sem controle de acesso;
9. cumprir os termos dos portais acessados e a legislação aplicável.

## 4. Certificados digitais

O Aplicativo pode instalar e remover certificados em `Cert:\CurrentUser\My`. Essas operações alteram o repositório do Windows, exigem ação explícita e a remoção pede confirmação literal.

O Usuário declara que:

- tem autorização do titular para importar e usar o certificado;
- o certificado é A1, válido, com chave privada e cadeia adequada;
- não usará o Aplicativo para autenticar em nome de pessoa ou empresa sem poderes;
- removerá o certificado do Windows quando não for mais necessário;
- entende que o teste de injeção local não garante aceitação por um portal específico.

O AurumBit Portal não emite, renova, revoga ou valida juridicamente certificados. A responsabilidade pela cadeia, revogação e conformidade com a ICP-Brasil é do titular e da autoridade certificadora.

## 5. Condutas proibidas

É proibido usar o Aplicativo para:

- acessar portais ou contas sem autorização;
- fraude, falsidade ideológica, apropriação de dados ou atuação em nome de terceiros sem poderes;
- burlar autenticação, captcha, MFA, limites de sessão ou controles de segurança;
- interceptar, descriptografar ou alterar tráfego de terceiros;
- instalar certificados em máquinas de terceiros sem consentimento;
- armazenar dados ilícitos, excessivos ou incompatíveis com a finalidade;
- distribuir malware ou contornar a allowlist de domínios.

## 6. Portais de terceiros

Os portais acessados são serviços independentes. O AurumBit Portal não controla disponibilidade, conteúdo, políticas, captcha, mudanças de layout ou requisitos de autenticação. O Usuário é responsável por cumprir os termos de cada portal e por verificar a legitimidade da URL antes de inserir credenciais.

Links externos abrem no navegador padrão e deixam o ambiente isolado do Aplicativo.

## 7. Disponibilidade e atualizações

O Aplicativo é fornecido “como está” e pode apresentar indisponibilidades, erros, mudanças de comportamento ou incompatibilidades com portais. Atualizações podem ser manuais ou automáticas, conforme configuração. A URL de atualização do repositório é um placeholder e deve ser substituída por um servidor confiável antes de uso em produção.

O Usuário deve validar cada nova versão em ambiente de teste e manter uma cópia do instalador anterior.

## 8. Privacidade e proteção de dados

O tratamento de dados é descrito em [PRIVACY.md](PRIVACY.md). O Aplicativo não opera backend nem telemetria. A organização controladora responde por bases legais, consentimentos, retenção, atendimento a titulares e incidentes.

O Usuário não deve inserir dados pessoais sensíveis além do necessário para a finalidade profissional.

## 9. Limitação de responsabilidade

Na máxima extensão permitida pela lei, a organização fornecedora não responde por:

- perda de dados, lucros, contratos ou oportunidades;
- danos decorrentes de certificado vencido, revogado, incorreto ou usado sem autorização;
- atuação de malware, acesso físico, comprometimento do perfil Windows ou de credenciais;
- indisponibilidade, mudança ou bloqueio de portais de terceiros;
- uso indevido por operador, cliente ou terceiro;
- falha de backup, restauração ou descarte;
- danos indiretos, incidentais, especiais ou punitivos.

Nada nestes termos exclui responsabilidade que não possa ser excluída por lei, inclusive em matéria de proteção de dados, quando aplicável.

## 10. Suspensão e encerramento

O uso pode ser suspenso ou encerrado em caso de violação destes termos, risco de segurança, determinação legal ou fim do projeto. Ao encerrar, o Usuário deve:

- exportar e preservar dados necessários;
- revogar certificados e trocar senhas afetadas;
- remover o Aplicativo e, se aplicável, a pasta `%APPDATA%\AurumBit Portal`;
- manter registros de auditoria conforme obrigação legal.

## 11. Alterações

Estes termos podem ser atualizados. A versão vigente deve acompanhar o instalador ou ser disponibilizada no repositório interno. O uso após a atualização implica aceitação, salvo disposição legal em contrário.

## 12. Legislação e foro

Aplica-se a legislação brasileira. Fica eleito o foro da sede da organização fornecedora, salvo norma de proteção ao consumidor ou de proteção de dados que determine outro foro. Antes de qualquer medida judicial, as partes devem tentar solução amigável pelo canal de suporte.

## 13. Contato

Canal interno configurado no projeto: `suporte@aurumbit.local`. Substitua pelo contato oficial, pelo encarregado de dados e pelo responsável jurídico antes de distribuir o Aplicativo.

**Última atualização:** 4 de novembro de 2026.
