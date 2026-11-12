# ADR 0006 — Normalização de URLs e injeção de certificado em hosts gov.br

- **Status:** Aceita
- **Data:** 2026-11-05
- **Decisores:** Equipe AurumBit Portal

## Contexto

Usuários relataram que, ao abrir portais do governo (por exemplo, o SSO gov.br com certificado digital), o aplicativo exibia **“O portal tentou autenticar em um dominio fora da allowlist”** e a autenticação com certificado nunca completava. O `cert-debug.log` temporário registrou a sequência real de chamadas do Electron:

```
handler called url=certificado.sso.acesso.gov.br:443
```

O evento `select-client-certificate` do Electron entrega a URL **no formato `host:porta`, sem esquema**. A implementação anterior fazia `new URL(requestUrl)`; pelo padrão WHATWG, `certificado.sso.acesso.gov.br:443` é um esquema customizado válido (`protocol = "certificado.sso.acesso.gov.br:"`, `hostname = ""`). O bloco `catch { new URL(\`https://${url}\`) }` nunca era executado, porque não havia exceção. O hostname vazio falhava tanto no teste de host governamental quanto na allowlist, e **toda** requisição de certificado dos portais gov.br era recusada.

Dois detalhes agravavam o problema: hosts que começam com dígito (`127.0.0.1:56636`, nos testes locais) caíam no `catch` e funcionavam, mascarando o defeito; e existiam duas listas independentes de “domínios do governo” (`certificates/core.ts` e `sessions/manager.ts`), com uma regex que tentava remover o ponto final de FQDN mas estava escrita como `/\\.$/`, casando uma barra invertida seguida de qualquer caractere — ou seja, nunca removia nada.

## Decisão

1. **`shared/network.ts` é a única fonte de verdade** para parsing e comparação de hosts. `parseHttpUrl` normaliza entradas sem esquema (`host:porta`, `//host/path`, FQDN com ponto final, maiúsculas), rejeita esquemas diferentes de `http:`/`https:`, credenciais embutidas (`user:pass@host`), labels vazios e portas inválidas. `normalizeHostname`, `isGovernmentHost`, `matchesDomainPattern` e `isAllowedHost` aplicam a mesma normalização (minúsculas, sem ponto final de FQDN).
2. **Injeção de certificado exige HTTPS.** `http:` (ou qualquer outro esquema) nunca recebe o certificado de cliente.
3. **Hosts `.gov.br` continuam aceitos automaticamente** no fluxo de certificado e de navegação, porque o SSO governamental transita legitimamente por subdomínios (`sso.acesso.gov.br`, `certificado.sso.acesso.gov.br`, `cav.receita.fazenda.gov.br`). A lista foi reduzida a `gov.br` + sufixo `.gov.br` com validação de labels; `.rnp.br` e sufixos redundantes foram removidos.
4. **Qualquer outro host exige allowlist explícita** do serviço (com curinga `*.dominio` opcional). Parecidos com gov.br (`gov.br.evil.com`, `evil-gov.br`) são recusados.
5. **Sem logs de depuração com dados de certificado.** Removidos os `appendFileSync` de diagnóstico que gravavam thumbprints e URLs em `%TEMP%\opencode\cert-debug.log`; o teste de injeção mTLS não registra mais nada em disco.
6. **Testes de caos** (`tests/unit/chaos-certificate.test.ts`) cobrem o formato exato entregue pelo Electron, cadeias de redirecionamento, candidatos maliciosos, entradas lixo, lista de certificados malformada, fingerprints nos formatos Electron/PEM/DER e vazamento de dados em mensagens de erro.
7. **`npm run simulate:cert`** (`scripts/spike/simulate-cert-selection.ts`) reproduz o incidente contra o código real, sem rede, sem repositório de certificados e sem dados de produção.

## Consequências

**Positivas**

- A autenticação com certificado em portais gov.br volta a funcionar (o host `certificado.sso.acesso.gov.br:443`, presente nos logs do incidente, é aceito explicitamente).
- As regras de rede ficam centralizadas, determinísticas e cobertas por testes; não há mais listas divergentes nem regexes quebradas.
- Fail-closed para tudo que não seja `.gov.br` explicitamente enumerado ou presente na allowlist; sem esquema, sem usuário/senha embutidos, sem rótulos vazios.
- Auditoria e logs não expõem credenciais embutidas em URLs nem thumbprints em arquivos temporários.

**Negativas**

- Portais hospedados fora de `.gov.br` (ex.: intranet de prefeitura em domínio próprio) continuam exigindo que o administrador inclua o domínio de SSO na allowlist; são recusados por padrão, como sempre foram.
- `http://` nunca autentica com certificado, mesmo em um portal legado; o portal precisa oferecer HTTPS (todos os portais do governo suportam).
- Domínios fora de `.gov.br` que antes passavam por engano (nenhum, dado que o catch nunca disparava para hosts com letra inicial) — nenhum comportamento anterior válido é removido.

## Alternativas consideradas

1. **Manter o `catch` original.** Rejeitada: o modo de falha é silencioso (o parser WHATWG não lança para `host:porta`); corrigir apenas o catch deixaria esquemas desconhecidos e credenciais embutidas sem tratamento.
2. **Lista explícita de sufixos por portal.** Rejeitada: manutenção frágil e foi a origem das três listas divergentes; o sufixo `.gov.br` com validação de labels é estrito o bastante (o sufixo é registrado no NIC.br e sob gestão do governo).
3. **Allowlist de tudo para hosts governamentais, incluindo `.rnp.br`.** Rejeitada: `.rnp.br` é a rede acadêmica, não governamental; incluí-la alargaria a superfície de injeção de certificado sem necessidade.
4. **Proxy TLS local para reescrever a URL.** Rejeitada: violaria a invariante “sem proxy/MITM” (ver ADR 0003) e o modelo de confiança do Windows.
