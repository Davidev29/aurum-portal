# ADR 0002 — Electron + Next.js com export estático

- **Status:** Aceita
- **Data:** 2026-11-04
- **Decisores:** Equipe AurumBit Portal

## Contexto

O produto precisa de uma interface rica, componentes acessíveis e um processo nativo capaz de acessar SQLite, DPAPI, o repositório de certificados do Windows e o motor Chromium com partições isoladas. Também precisa ser distribuído como aplicativo Windows instalável, sem exigir servidor web.

As opções avaliadas foram Electron + Next.js, Tauri + frontend web, Electron com HTML/JS puro e um aplicativo .NET/WPF.

## Decisão

Usar **Electron** como shell desktop e **Next.js 16 (App Router)** como renderer, com `output: 'export'`:

- O Next.js gera arquivos estáticos em `out/`.
- Em produção, o processo principal serve esses arquivos pelo protocolo próprio `app://aurumbit-portal`.
- Em desenvolvimento, o Electron carrega `http://localhost:3002`.
- O preload expõe uma API tipada via `contextBridge`; o renderer nunca importa módulos Node.js.
- O processo principal e o preload são compilados com `tsup` para CommonJS, com `electron` e `better-sqlite3` como externos.
- A janela principal e as janelas de sessão usam `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` e `webSecurity: true`.
- O protocolo `app://` aplica CSP restritiva, `nosniff`, `no-referrer` e bloqueio de path traversal.

## Consequências

**Positivas**

- Uma única base de código TypeScript para main, preload, renderer e contratos compartilhados.
- Componentes de UI maduros (Radix, Tailwind, React Query, React Hook Form, Zod).
- Chromium fornece TLS, seleção de certificado cliente, partições e `WebContentsView`, que são centrais para o produto.
- Export estático elimina a necessidade de um servidor Next.js em produção.
- CSP e protocolo customizado reduzem a exposição do renderer.

**Negativas**

- Sem SSR, server actions ou rotas dinâmicas do Next.js em produção; toda a lógica privilegiada fica no processo principal.
- O binário Electron é grande e consome mais memória que alternativas nativas.
- É necessário manter dois alvos de build (`out/` e `dist-electron/`) e empacotar dependências nativas corretamente.
- Recursos do Next.js que dependem de servidor não podem ser usados no renderer.

## Alternativas consideradas

1. **Tauri.** Menor binário, mas o suporte a seleção de certificado cliente, partições e comportamento de Chromium seria diferente e exigiria mais trabalho de integração no Windows.
2. **Electron + SPA sem Next.js.** Viável, mas perderia a estrutura de App Router, convenções de layout e ecossistema já adotados pela equipe.
3. **.NET/WPF + WebView2.** Boa integração com Windows e certificados, porém exigiria reescrever a UI e a camada de contratos, com menor reaproveitamento de código.
