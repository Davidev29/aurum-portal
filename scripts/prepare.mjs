#!/usr/bin/env node
/*
 * Prepara o ambiente de desenvolvimento local:
 *  - Instala `.githooks/` como `core.hooksPath` LOCAL do repositório,
 *    ativando o hook pre-push que espelha os gates rápidos do CI.
 *
 * Regras de segurança (nunca trava o `npm install`):
 *  - Fora de um repositório git (tarball, npm pack, Docker sem .git): no-op.
 *  - No CI (CI=true / GITHUB_ACTIONS=true): no-op (o gate lá é o Actions).
 *  - Idempotente: já configurado → sai sem fazer nada.
 *  - Já existe outro core.hooksPath: NÃO sobrescreve; avisa e sai.
 *  - Qualquer falha: apenas avisa (exit 0).
 */
import { spawnSync } from 'node:child_process'

const git = (args) => spawnSync('git', args, { encoding: 'utf8' })

// 1) Fora de git → silêncio.
const inside = git(['rev-parse', '--is-inside-work-tree'])
if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') {
  process.exit(0)
}

// 2) CI → no-op.
if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') {
  process.exit(0)
}

// 3) Idempotente: já configurado → sai.
const current = (git(['config', '--local', '--get', 'core.hooksPath']).stdout || '').trim()
if (current === '.githooks') {
  process.exit(0)
}

// 4) Já existe outro hooksPath → NÃO sobrescreve.
if (current) {
  console.warn(
    `[prepare] core.hooksPath='${current}' mantido. Para usar os hooks do repo: git config core.hooksPath .githooks`,
  )
  process.exit(0)
}

// 5) Configura local (nunca --global). Falha → só avisa.
const set = git(['config', '--local', 'core.hooksPath', '.githooks'])
if (set.status !== 0) {
  console.warn(
    '[prepare] Não consegui definir core.hooksPath; rode: git config core.hooksPath .githooks',
  )
} else {
  console.log('[prepare] core.hooksPath=.githooks (hook pre-push ativo)')
}
process.exit(0)
