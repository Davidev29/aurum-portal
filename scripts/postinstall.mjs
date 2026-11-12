/*
 * better-sqlite3 13 usa Node-API e publica binarios pre-compilados para Windows x64.
 * Nao e necessario recompilar para o ABI do Electron. O script apenas confirma que
 * o binario nativo esta presente e orienta em caso de instalacao incompleta.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

const prebuilt = path.join('node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node')
if (!existsSync(prebuilt)) {
  console.warn(
    '[aurumbit-portal] Aviso: prebuild do better-sqlite3 nao encontrado. Rode npm install novamente.',
  )
} else {
  console.log('[aurumbit-portal] Dependencias nativas verificadas (better-sqlite3 N-API).')
}
