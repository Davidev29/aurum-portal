#!/usr/bin/env node
/**
 * N4 — gate de release (C6): o bundle de produção NÃO pode conter "autopilot".
 *
 * Varre `dist-electron/` e `out/` (arquivos .js/.cjs/.mjs/.html/.css)
 * procurando a string `autopilot` (case-insensitive). Imprime a contagem
 * total e os arquivos com ocorrências. Sai com código 1 se houver qualquer
 * ocorrência ou se algum root estiver ausente (fail-closed); 0 caso contrário.
 * Sem dependências — só node:fs/node:path/node:url.
 *
 * Uso: node scripts/verify-release.mjs   (após `npm run build` em produção)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOTS = ['dist-electron', 'out']
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.html', '.css'])
const NEEDLE = 'autopilot'

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(full))
      continue
    }
    if (!entry.isFile()) continue
    if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    files.push(full)
  }
  return files
}

function countOccurrences(haystack) {
  const lower = haystack.toLowerCase()
  let count = 0
  let index = lower.indexOf(NEEDLE)
  while (index !== -1) {
    count += 1
    index = lower.indexOf(NEEDLE, index + NEEDLE.length)
  }
  return count
}

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const hits = []
let total = 0
for (const root of ROOTS) {
  const absolute = path.join(rootDir, root)
  if (!existsSync(absolute)) {
    // Fail-closed: um gate de release que "aprova vazio" porque a build não
    // rodou não é gate — reprova explicitamente.
    console.error(
      `[verify-release] ERRO: ${root} não existe — a build de produção rodou antes deste passo?`,
    )
    process.exit(1)
  }
  for (const file of walk(absolute)) {
    const count = countOccurrences(readFileSync(file, 'utf8'))
    if (count > 0) {
      hits.push({ file: path.relative(rootDir, file), count })
      total += count
    }
  }
}

if (total > 0) {
  console.error(`[verify-release] FALHOU: ${total} ocorrência(s) de "${NEEDLE}" encontradas:`)
  for (const hit of hits.sort((a, b) => b.count - a.count)) {
    console.error(`  - ${hit.file}: ${hit.count}`)
  }
  process.exit(1)
}

console.log(`[verify-release] OK: 0 ocorrências de "${NEEDLE}" em ${ROOTS.join(' e ')}.`)
process.exit(0)
