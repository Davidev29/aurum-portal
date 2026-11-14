import { defineConfig } from 'tsup'
import { rmSync } from 'node:fs'
import path from 'node:path'

const alias = {
  '@shared': path.resolve('shared'),
}

// tsup builda os configs do array em paralelo (Promise.all) e todos compartilham
// `dist-electron` — um `clean: true` dentro de um deles poderia apagar a saída de
// outro no meio da build. A limpeza acontece aqui, uma única vez, antes de
// qualquer config buildar (o config file é carregado por completo primeiro).
rmSync(path.resolve('dist-electron'), { recursive: true, force: true })

export default defineConfig([
  {
    entry: {
      main: 'electron/main/index.ts',
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
    // C6/N4: só o bundle `main` ganha o define+minify. Em produção o ramo
    // `NODE_ENV === 'test'` (autopilot e2e) é eliminado e nem chega ao binário.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    minify: true,
    esbuildOptions(options) {
      options.alias = alias
    },
  },
  {
    entry: {
      preload: 'electron/preload/index.ts',
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
