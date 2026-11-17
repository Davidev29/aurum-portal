/*
 * better-sqlite3 13 usa Node-API e publica binarios pre-compilados para Windows x64.
 * Nao e necessario recompilar para o ABI do Electron. Este script VERIFICA o
 * binario de verdade: se estiver ausente ou corrompido, a instalação FALHA
 * (antes o app passava no npm install e só quebrava em runtime, com o cofre
 * indisponivel).
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

if (process.platform !== 'win32') {
  console.log('[aurumbit-portal] Plataforma não-Windows: verificação adiada ao empacotamento.')
  process.exit(0)
}

const prebuilt = path.join('node_modules', 'better-sqlite3', 'prebuilds', 'win32-x64.node')
if (!existsSync(prebuilt)) {
  console.error(
    '[aurumbit-portal] ERRO: prebuild do better-sqlite3 (prebuilds/win32-x64.node) nao encontrado.',
  )
  console.error('Rode `npm install` novamente (ou restaure o lockfile e o cache do npm).')
  process.exit(1)
}

try {
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(':memory:')
  db.exec('SELECT 1')
  db.close()
  console.log('[aurumbit-portal] Dependencias nativas verificadas (better-sqlite3 N-API).')
} catch (error) {
  console.error('[aurumbit-portal] ERRO: better-sqlite3 prebuild presente mas não carrega:')
  console.error(error instanceof Error ? error.message : String(error))
  console.error('Rode `npm install` novamente.')
  process.exit(1)
}
