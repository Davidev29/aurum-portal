import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestTimestamp, testTsa } from '../../electron/main/pdf/timestamp'

afterEach(() => vi.unstubAllGlobals())

describe('requestTimestamp', () => {
  it('rejeita URL invalida', async () => {
    await expect(requestTimestamp('ftp://x', new Uint8Array([1, 2, 3]))).rejects.toThrow(
      /HTTP ou HTTPS/,
    )
  })

  it('falha com mensagem clara em timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init?: RequestInit) => {
        // Simula abort
        const err = new Error('aborted')
        err.name = 'TimeoutError'
        throw err
      }),
    )
    await expect(
      requestTimestamp('https://tsa.example', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/tempo limite/)
  })

  it('falha em HTTP nao-2xx sem expor corpo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('segredo-interno', { status: 500 })),
    )
    await expect(
      requestTimestamp('https://tsa.example', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(/HTTP 500/)
  })

  it('falha quando o corpo nao e um TimeStampResp', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('nao-der', {
            status: 200,
            headers: { 'content-type': 'application/timestamp-reply' },
          }),
      ),
    )
    await expect(
      requestTimestamp('https://tsa.example', new Uint8Array([1, 2, 3])),
    ).rejects.toThrow()
  })

  it('testTsa retorna ok=false em falha de rede sem vazar erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('rede down')
      }),
    )
    const r = await testTsa('https://tsa.example')
    expect(r.ok).toBe(false)
    expect(r.message).not.toContain('rede down')
  })
})
