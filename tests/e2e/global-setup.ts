import { existsSync } from 'node:fs'
import path from 'node:path'

export default function globalSetup(): void {
  const root = path.resolve(__dirname, '../..')
  const required = [
    'out/index.html',
    'out/session/index.html',
    'dist-electron/main.cjs',
    'dist-electron/preload.cjs',
  ]
  const missing = required.filter((file) => !existsSync(path.join(root, file)))
  if (missing.length > 0) {
    throw new Error(
      `Build ausente para E2E: ${missing.join(', ')}. Execute "npm run build" antes de "playwright test".`,
    )
  }
}
