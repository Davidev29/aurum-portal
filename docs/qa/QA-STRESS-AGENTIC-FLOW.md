# Fluxo Agêntico de QA — Testes de Stress do AurumBit Portal

**Versão:** 1.0 · **Data:** 2026-11-12 · **Escopo:** validação de todos os fluxos da aplicação
sob fluxo de trabalho pesado (carga local, Windows, aplicação desktop local-only).

---

## 1. Objetivo

Garantir que o AurumBit Portal (Electron + Next.js + SQLite local) **funciona localmente e
sustenta um fluxo de trabalho pesado**: centenas de clientes, milhares de segredos, lotes de
assinaturas de PDF, matrizes de obrigações cliente × obrigação, auditoria volumosa e abertura/
reuso de sessões — sem corrupção de dados, sem vazamento de segredos, sem estouro de tempo/
memória e com degradação previsível.

Não substitui a suíte unitária existente (497 testes) nem os E2E; adiciona a **camada de
stress/carga** e o **ritual agêntico** que a executa e a julga.

## 2. Inventário de fluxos → subsistemas → evidência

| # | Fluxo (tela) | Subsistema | Camada de stress |
|---|--------------|------------|------------------|
| F1 | Store de serviços / "Novo site" | `db/repositories/services.ts`, `seed.ts`, `builtins.ts` | cobertura indireta (seed + listagem em todo teste de DB) |
| F2 | Clientes PF/PJ (cadastro, busca, CSV, honorários, notas, arquivo) | `repositories/clients.ts` | **clients-credentials-stress** |
| F3 | Credenciais (CRUD, reveal, default, fingerprint, reuso) | `repositories/credentials.ts`, `vault/` | **clients-credentials-stress** + **vault-pdf-stress** |
| F4 | Certificados A1 (PFX, thumbprint, vínculo cliente, renovação) | `certificates/`, `repositories/certificates.ts` | parcial (parse/validação via fixtures; janela Windows não é stressável sem loja real) |
| F5 | Assinatura digital de PDFs (PAdES-B-T) | `pdf/sign.ts`, `pdf/stamp.ts`, `workers/` | **vault-pdf-stress** |
| F6 | Obrigações recorrentes (matriz, grupos, scheduler, visão mensal) | `repositories/obligations.ts`, `notifications/obligations-scheduler.ts` | **obligations-audit-sessions-stress** |
| F7 | Sessões isoladas (partição, reuse key, allowlist, registry) | `sessions/partition.ts`, `sessions/context-registry.ts`, `certificates/core.ts` | **obligations-audit-sessions-stress** (partição/registry) |
| F8 | Auditoria local (append, redaction, export) | `repositories/audit.ts`, `security/redaction.ts` | **obligations-audit-sessions-stress** |
| F9 | Backup `.pvbackup` (Argon2id) | `vault/backup.ts` | **vault-pdf-stress** |
| F10 | Vault (AES-256-GCM, HKDF, fingerprint) | `vault/crypto.ts`, `vault/service.ts` | **vault-pdf-stress** |
| F11 | E2E de fluxo completo com volume | Playwright + Electron real | **tests/e2e/stress-volume.spec.ts** |
| F12 | Gate de regressão (typecheck/lint/unitário) | CI existente | executado como baseline |

## 3. Arquitetura agêntica (papéis)

| Agente | Papel | Saída |
|--------|-------|-------|
| **Orquestrador / QA Lead** | Coordena fases e gates; consolida métricas; emite veredito | `docs/qa/QA-STRESS-REPORT.md` |
| **Mapeador de Fluxos** | Inventaria telas → IPC → repositórios → serviços | §2 (feito via leitura direta nesta execução) |
| **Engenheiro de Stress A** (`general`) | Domínio cofre/PDF: AES-GCM, fingerprint, PFX seal/open, backup Argon2id, batch de assinaturas, geometria do carimbo | `tests/stress/vault-pdf-stress.test.ts` |
| **Engenheiro de Stress B** (`general`) | Domínio clientes/credenciais: CRUD em volume, busca, CSV, notas, honorários, reuso de senha, curva de escala | `tests/stress/clients-credentials-stress.test.ts` |
| **Engenheiro de Stress C** (`general`) | Domínio obrigações/auditoria/sessões: matriz 60×15, scheduler 12 competências, redaction em volume, partições ×2000, registry | `tests/stress/obligations-audit-sessions-stress.test.ts` |
| **Executor** | Roda `npm run test:stress`, `npm test`, Playwright; captura timings e falhas | logs + JSON de métricas no relatório |
| **Analista de Performance** | Compara tempos com os orçamentos (§5); aponta gargalos (ex.: escrita O(N²)) | seção "Achados" do relatório |
| **Relator** | Redige o veredito no formato §7 | `docs/qa/QA-STRESS-REPORT.md` |

Cada agente recebe **brief destilado** (APIs exatas, estilo de teste, proibições) e um
**contrato de retorno**: caminho escrito + ≤8 bullets + BLOCKED/CONCERNS em uma linha.
O orquestrador **verifica o artefato no disco** antes de aceitar a fase (erro-recovery: artefato
sumindo = fase falhou; resume ou reescreve o domínio).

## 4. Fases e gates

| Fase | Conteúdo | Gate de saída |
|------|----------|----------------|
| 0 — Baseline | `npm run typecheck`, `npm run lint`, `npm test` | tudo verde (obrigatório para prosseguir) |
| 1 — Inventário | Mapear fluxos F1–F12 | §2 completo |
| 2 — Design | Briefs A/B/C com orçamentos | briefs versionados neste doc |
| 3 — Implementação | 3 agentes em paralelo + E2E volume | `tsc`/`vitest --list` sem erro de import |
| 4 — Execução | `npm run test:stress` (Vitest) | 0 falhas; métricas capturadas |
| 5 — E2E com volume | `playwright test tests/e2e/stress-volume.spec.ts` (+ suíte existente) | spec verde |
| 6 — Análise | Comparar com orçamentos §5 | gargalos listados com evidência |
| 7 — Veredito | Relatório em `docs/qa/` | APPROVED / APPROVED WITH CONDITIONS / NOT APPROVED / NOT ASSESSED |

**Regra de veredito:** qualquer falha em fluxo F2–F11 sem workaround documentado ⇒ NOT APPROVED.
Falha de orçamento (lento, mas correto) ⇒ APPROVED WITH CONDITIONS. Suites não executadas ⇒
NOT ASSESSED (nunca APPROVED por vacuosidade).

## 5. Orçamentos de desempenho (máquina de referência: Windows x64, Node 22, better-sqlite3)

| Métrica | Orçamento (pesado) | Alvo |
|---------|--------------------|------|
| 1.000× seal+open AES-GCM | < 10 s | < 5 s |
| 5.000× fingerprint HMAC | < 5 s | < 2 s |
| 500× PFX seal/open (2 KB) | < 10 s | < 5 s |
| 8× backup Argon2id (1 KB) | < 60 s | < 30 s |
| Batch 12 assinaturas PAdES (offline, 1–20 páginas) | < 90 s | < 45 s |
| 500 clientes PJ criados | < 15 s | < 8 s |
| 400 credenciais criadas | < 120 s | < 60 s |
| Matriz obrigações 60 clientes × 10 obrigações (applyGroup) | < 20 s | < 10 s |
| `listMonthOverview` × 12 meses | < 30 s | < 15 s |
| 1.500 eventos de auditoria append | < 10 s | < 5 s |
| 2.000 `buildPartition`/validações | < 5 s | < 1 s |
| E2E volume (30 clientes + 60 credenciais via IPC na UI) | < 120 s | < 60 s |

Orçamentos são **tetos de regressão**, não SLA; a métrica real é registrada no relatório.
Folga de ~2× cobre variação de máquina; estouros são investigados, não silenciados.

## 6. Política de hermetismo e segurança

- **Rede:** zero. TSA usa URL inválida de propósito (`not-a-url` ⇒ assinatura offline PAdES-B-B,
  mesmo caminho de fail-closed do app). BrasilAPI nunca é chamada (opt-in + rede).
- **Dados:** `:memory:` para SQLite; diretório de dados E2E em `os.tmpdir()` com remoção no
  `finally`. O PFX do spike (`scripts/spike/.certs/spike-a1-test.pfx`, senha `SpikeSenha123!`) é
  gerado sob demanda pelo `tests/setup/global-fixture.ts` — nunca commitado, sem validade legal.
- **Segredos:** senhas sintéticas (`Stress!2026-…`); nenhum documento real (CPF/CNPJ gerados com
  dígitos verificadores válidos, base 00000000000/…).
- **Nenhum teste modifica o código da aplicação.** Achados viram seção no relatório + issue.
- **Timeouts:** `testTimeout` 180 s na config de stress; E2E com `timeout: 90 s` por teste.

## 7. Formato do veredito (relatório)

`docs/qa/QA-STRESS-REPORT.md` contém: baseline, tabela de resultados por fluxo F1–F12 (PASS/
FAIL/NOT ASSESSED + tempo medido vs orçamento), achados com severidade, limitações e o
**Veredito** conforme §4. Todo fluxo não executado aparece como NOT ASSESSED, com o motivo.

## 8. Execução (comandos)

```powershell
npm run typecheck
npm run lint
npm test                    # baseline
npm run test:stress         # nova suíte (tests/stress/, vitest.stress.config.ts)
npm run test:e2e            # suíte existente (build + Playwright)
npx playwright test tests/e2e/stress-volume.spec.ts   # fluxo F11 isolado
```

## 9. Limitações conhecidas

- Fluxos que dependem de hardware real (loja do Windows, mTLS em portal `.gov.br`, Windows
  Certificate Store, instalador NSIS) **não** são exercitados em stress — apenas a lógica
  pura/local; o que existe de integração Windows permanece coberto pelos testes existentes.
- O scheduler de obrigações é validado por chamadas diretas a `generateDueNotifications` com
  relógio fixo, não pelo timer real do processo.
- Assinatura com TSA real (RFC 3161) não é stressada offline; o caminho fail-closed é o testado.
- Métricas de tempo variam por máquina; orçamentos (§5) carregam folga proposital.
