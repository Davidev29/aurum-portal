import { defineConfig } from 'vitest/config'
import path from 'node:path'

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
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'shared/**/*.ts',
        'electron/main/vault/**/*.ts',
        'electron/main/certificates/core.ts',
        'electron/main/certificates/parse.ts',
        'electron/main/sessions/partition.ts',
        'electron/main/recipes/core.ts',
        'electron/main/recipes/readiness.ts',
        'electron/main/security/**/*.ts',
      ],
      exclude: ['**/*.d.ts', '**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
})
