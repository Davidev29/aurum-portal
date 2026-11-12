# ADR 0007 — Consulta externa de CNPJ somente com opt-in

- **Status:** Aceita
- **Data:** 2026-11-05
- **Decisores:** Equipe AurumBit Portal

## Contexto

Na importação de um certificado CNPJ, o aplicativo consultava silenciosamente `brasilapi.com.br` (serviço de terceiros) para descobrir a razão social do titular e preencher o cadastro automático do cliente. Isso contrariava dois compromissos do projeto:

1. **ADR 0001 (local-only):** a única comunicação externa deve ser com portais abertos pelo usuário e, opcionalmente, com o servidor de atualizações configurado.
2. **LGPD:** dados de cliente (ainda que registro público) eram enviados a um terceiro sem ciência ou consentimento claro do operador.

Além disso, a resposta não tinha limite de bytes (risco teórico de exaustão de memória) e não havia registro de auditoria da consulta.

## Decisão

1. **Desativado por padrão.** Novo setting `externalCnpjLookup` (padrão `false`), exposto em Configurações → Segurança e sessões → "Consultar dados publicos de CNPJ". Sem ativá-lo, nenhum CNPJ sai da estação — garantido no cliente HTTP (`lookupCompanyByCnpj` retorna `null` imediatamente sem `enabled: true`).
2. **Escopo mínimo.** A consulta só ocorre ao importar um certificado CNPJ para auto-criar o cliente; envia apenas o CNPJ (registro público, sem dados pessoais de PF). Timeout de 12 s.
3. **Limite de resposta.** O corpo é lido com teto de 64 KB: se `content-length` excede o limite, ou o corpo real excede durante o stream, a resposta é descartada.
4. **Auditoria.** Quando ativada, cada consulta gera evento `external.cnpj_lookup` com o provedor e o CNPJ mascarado e o resultado (`ok`/`unavailable`), sem dados da resposta.
5. **Falha silenciosa controlada.** Rede, timeout, HTTP não-2xx, JSON inválido ou payload não-objeto retornam `null` e o fluxo cai para o nome do titular no certificado, sem erro para o usuário.
6. **Sem telemetria adicional.** Nenhuma outra chamada a terceiros é feita pelo importador de certificados.

## Consequências

**Positivas**

- Conformidade com ADR 0001 e com o princípio LGPD de minimização: nada sai sem ativação explícita.
- Resposta limitada e auditável; falha de rede nunca bloqueia a importação.
- O operador decide conscientemente se o CNPJ do cliente pode ser consultado em serviço público de terceiros.

**Negativas**

- Por padrão, clientes criados a partir de certificado CNPJ recebem o nome do titular (do próprio certificado) em vez da razão social atualizada; o operador pode editar o nome ou ativar a consulta para importações futuras.
- O CNPJ consultado continua sendo público no Brasil; ainda assim, a ativação deve seguir a política interna do escritório (o dado é do cliente, não do operador).

## Alternativas consideradas

1. **Manter automático (sem setting).** Rejeitada: viola ADR 0001 e o consentimento claro exigido pela LGPD.
2. **Remover a integração de vez.** Considerada: elimina a funcionalidade de preenchimento automático, útil para cadastros em lote; em vez disso, tornou-se opcional e desligada por padrão.
3. **Consulta a uma fonte oficial do governo (ex.: ReceitaWS/AutoAtendimento).** Exige credenciais e integrações que extrapolam o escopo; a brasilapi.com.br permanece como provedor quando o operador optar por usá-la.
4. **Consentimento por importação.** Rejeitada: atrito a cada importação; o setting global com aviso claro é suficiente e auditável.
