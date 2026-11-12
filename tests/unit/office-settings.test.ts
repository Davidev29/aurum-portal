import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '../../electron/main/db/database'
import { getSettings, saveSettings } from '../../electron/main/db/seed'
import { lookupCompanyByCnpj } from '../../electron/main/integrations/brasil-api'
import { coerceSettings, DEFAULT_OFFICE_PROFILE, DEFAULT_SETTINGS } from '../../shared/settings'
import { settingsUpdateSchema } from '../../shared/contracts'

const CNPJ = '11.222.333/0001-81'
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII='

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('perfil do escritório (office)', () => {
  it('banco sem office mantém padrões vazios (compatibilidade)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      expect(getSettings(db).office).toEqual(DEFAULT_OFFICE_PROFILE)
      expect(coerceSettings({})).toEqual(DEFAULT_SETTINGS)
    } finally {
      close()
    }
  })

  it('mescla parcial do office sem apagar os demais campos', () => {
    const result = coerceSettings({
      office: { legalName: '  Escritório Teste LTDA  ', cnpj: CNPJ },
    })
    expect(result.office.legalName).toBe('Escritório Teste LTDA')
    expect(result.office.cnpj).toBe('11222333000181')
    expect(result.office.managerName).toBe('')
    expect(result.office.logoBase64).toBeNull()
  })

  it('normaliza CPF do gestor para apenas dígitos', () => {
    const result = coerceSettings({
      office: { managerCpf: '529.982.247-25', managerName: 'Gestor Teste' },
    })
    expect(result.office.managerCpf).toBe('52998224725')
    expect(result.office.managerName).toBe('Gestor Teste')
  })

  it('rejeita CNPJ ou CPF inválido voltando aos padrões', () => {
    expect(coerceSettings({ office: { cnpj: '123' } })).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings({ office: { managerCpf: '123' } })).toEqual(DEFAULT_SETTINGS)
  })

  it('aceita logomarca PNG em Base64 e rejeita SVG e formatos inseguros', () => {
    expect(coerceSettings({ office: { logoBase64: PNG_DATA_URL } }).office.logoBase64).toBe(
      PNG_DATA_URL,
    )
    expect(
      coerceSettings({ office: { logoBase64: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }),
    ).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings({ office: { logoBase64: 'javascript:alert(1)' } })).toEqual(
      DEFAULT_SETTINGS,
    )
    expect(coerceSettings({ office: { logoBase64: '' } })).toEqual(DEFAULT_SETTINGS)
  })

  it('settingsUpdate aceita atualização parcial só do office', () => {
    const parsed = settingsUpdateSchema.parse({
      office: { legalName: 'Escritório LTDA', cnpj: '11.222.333/0001-81' },
    })
    expect(parsed.office).toMatchObject({
      legalName: 'Escritório LTDA',
      cnpj: '11222333000181',
    })
    expect(parsed.theme).toBeUndefined()
  })

  it('saveSettings mescla office parcial preservando tema e logomarca', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      saveSettings(db, {
        theme: 'dark',
        office: { legalName: 'Escritório A', logoBase64: PNG_DATA_URL },
      })
      const next = saveSettings(db, { office: { managerName: 'Gestora' } })
      expect(next.theme).toBe('dark')
      expect(next.office.legalName).toBe('Escritório A')
      expect(next.office.managerName).toBe('Gestora')
      expect(next.office.logoBase64).toBe(PNG_DATA_URL)
      expect(getSettings(db).office.legalName).toBe('Escritório A')
    } finally {
      close()
    }
  })
})

describe('Brasil API — inscrições municipal e estadual', () => {
  it('mapeia inscricao_municipal e inscricao_estadual', async () => {
    const payload = {
      razao_social: 'ESCRITORIO TESTE LTDA',
      nome_fantasia: 'Escritório Teste',
      inscricao_municipal: '12345',
      inscricao_estadual: '67890',
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const result = await lookupCompanyByCnpj(CNPJ, { enabled: true })
    expect(result?.name).toBe('ESCRITORIO TESTE LTDA')
    expect(result?.municipalRegistration).toBe('12345')
    expect(result?.stateRegistration).toBe('67890')
  })

  it('aceita inscrição em formato de array sem quebrar', async () => {
    const payload = {
      razao_social: 'ESCRITORIO TESTE LTDA',
      inscricao_estadual: ['67890', '67890'],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    )
    const result = await lookupCompanyByCnpj(CNPJ, { enabled: true })
    expect(result?.stateRegistration).toBe('67890')
    expect(result?.municipalRegistration).toBeNull()
  })
})
