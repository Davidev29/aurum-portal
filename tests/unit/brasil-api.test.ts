import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupCompanyByCnpj } from '../../electron/main/integrations/brasil-api'

const CNPJ = '11.222.333/0001-81'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('lookupCompanyByCnpj (opt-in)', () => {
  it('não chama a rede quando o setting está desativado (padrão)', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await lookupCompanyByCnpj(CNPJ)).toBeNull()
    expect(await lookupCompanyByCnpj(CNPJ, {})).toBeNull()
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: false })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('consulta e mapeia a resposta quando habilitado', async () => {
    const payload = {
      razao_social: 'EMPRESA TESTE LTDA',
      nome_fantasia: 'Empresa Teste',
      email: 'contato@empresa.com.br',
      ddd_telefone_1: '85999999999',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )
    const result = await lookupCompanyByCnpj(CNPJ, { enabled: true })
    expect(result?.name).toBe('EMPRESA TESTE LTDA')
    expect(result?.tradeName).toBe('Empresa Teste')
    expect(result?.email).toBe('contato@empresa.com.br')
  })

  it('rejeita CNPJ com tamanho diferente de 14 dígitos', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await lookupCompanyByCnpj('123', { enabled: true })).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('recusa resposta com content-length acima do limite', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(1024 * 1024) },
        }),
      ),
    )
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: true })).toBeNull()
  })

  it('recusa corpo que excede o limite durante a leitura do stream', async () => {
    const big = 'x'.repeat(128 * 1024)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(big, { status: 200 })))
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: true })).toBeNull()
  })

  it('lida com JSON inválido e status HTTP de erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>erro</html>', { status: 200 })))
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: true })).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('erro', { status: 500 })))
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: true })).toBeNull()
  })

  it('lida com falha de rede sem vazar erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('rede indisponível')
      }),
    )
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: true })).toBeNull()
  })

  it('rejeita array JSON no lugar de objeto', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[1,2,3]', { status: 200 })))
    expect(await lookupCompanyByCnpj(CNPJ, { enabled: true })).toBeNull()
  })
})
