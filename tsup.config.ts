import { defineConfig } from 'tsup'
import path from 'node:path'

const alias = {
  '@shared': path.resolve('shared'),
}

export default defineConfig([
  {
    entry: {
      main: 'electron/main/index.ts',
      preload: 'electron/preload/index.ts',
    },
    outDir: 'dist-electron',
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    bundle: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    outExtension: () => ({ js: '.cjs' }),
    external: ['electron', 'better-sqlite3'],
    esbuildOptions(options) {
      options.alias = alias
    },
  },
  {
    entry: {
      'pfx-worker': 'electron/main/workers/pfx-worker.ts',
      'pdf-sign-worker': 'electron/main/workers/pdf-sign-worker.ts',
    },
    outDir: 'dist-electron',
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    bundle: true,
    sourcemap: true,
    splitting: false,
    outExtension: () => ({ js: '.cjs' }),
    external: ['electron', 'better-sqlite3'],
    esbuildOptions(options) {
      options.alias = alias
    },
  },
])
