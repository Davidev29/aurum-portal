import { parentPort, workerData } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { parsePfxSafe, type ParsedPfx } from '../certificates/parse'

interface WorkerFile {
  filePath: string
  password: string
}

export interface WorkerParseResult {
  filePath: string
  ok: boolean
  parsed: ParsedPfx | null
  error: string | null
}

async function run(): Promise<void> {
  const files = (workerData?.files ?? []) as WorkerFile[]
  const results: WorkerParseResult[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] as WorkerFile
    try {
      const buffer = await readFile(file.filePath)
      if (buffer.length > 20 * 1024 * 1024) {
        throw new Error('Arquivo maior que 20 MB')
      }
      const parsed = parsePfxSafe(buffer, file.password)
      results.push({
        filePath: file.filePath,
        ok: parsed.ok,
        parsed: parsed.ok ? parsed.value : null,
        error: parsed.ok ? null : parsed.error,
      })
    } catch (error) {
      results.push({
        filePath: file.filePath,
        ok: false,
        parsed: null,
        error: error instanceof Error ? error.message : 'Erro ao ler arquivo',
      })
    }
    parentPort?.postMessage({ type: 'progress', index, total: files.length })
  }
  parentPort?.postMessage({ type: 'result', results })
}

void run()
