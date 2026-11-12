import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * Suíte de stress (tests/stress/) — não executada por `npm test`.
 *
 * Orçamentos de tempo são folgas de regressão, não SLA: ver
 * docs/qa/QA-STRESS-AGENTIC-FLOW.md §5. Timeout amplo porque os testes
 * medem e exercitam volume real (ex.: assinatura em lote, Argon2id).
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    globalSetup: ['tests/setup/global-fixture.ts'],
    include: ['tests/stress/**/*.test.ts'],
    exclude: ['node_modules/**'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // Stress mede tempo; não rodar em paralelo no mesmo processo evita ruído.
    pool: 'forks',
    maxWorkers: 1,
    minWorkers: 1,
  },
})
