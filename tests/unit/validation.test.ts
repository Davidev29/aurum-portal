import { describe, expect, it } from 'vitest'
import {
  findDocumentInText,
  formatDocument,
  getDocumentType,
  isValidCNPJ,
  isValidCPF,
  isValidDocument,
  maskDocument,
  normalizeDocument,
  onlyDigits,
} from '../../shared/validation'
import { coerceSettings, DEFAULT_SETTINGS } from '../../shared/settings'
import { BUILTIN_SERVICES } from '../../shared/builtins'
import { BUILTIN_SERVICE_IDS } from '../../shared/constants'

describe('validation de documentos', () => {
  it('normaliza apenas digitos', () => {
    expect(onlyDigits('529.982.247-25')).toBe('52998224725')
    expect(normalizeDocument('11.222.333/0001-81')).toBe('11222333000181')
    expect(onlyDigits('')).toBe('')
  })

  it('valida CPF com digitos verificadores', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true)
    expect(isValidCPF('52998224724')).toBe(false)
    expect(isValidCPF('111.111.111-11')).toBe(false)
    expect(isValidCPF('123')).toBe(false)
  })

  it('valida CNPJ com digitos verificadores', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true)
    expect(isValidCNPJ('11222333000180')).toBe(false)
    expect(isValidCNPJ('00000000000000')).toBe(false)
    expect(isValidCNPJ('123')).toBe(false)
  })

  it('identifica e formata CPF/CNPJ', () => {
    expect(isValidDocument('529.982.247-25')).toBe(true)
    expect(isValidDocument('11.222.333/0001-81')).toBe(true)
    expect(isValidDocument('123')).toBe(false)
    expect(getDocumentType('529.982.247-25')).toBe('CPF')
    expect(getDocumentType('11.222.333/0001-81')).toBe('CNPJ')
    expect(getDocumentType('123')).toBeNull()
    expect(formatDocument('52998224725')).toBe('529.982.247-25')
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81')
    expect(formatDocument('abc')).toBe('abc')
    expect(maskDocument('52998224725')).toBe('***.***.***-25')
    expect(maskDocument('11222333000181')).toBe('**.***.***/****-81')
    expect(maskDocument('abc')).toBe('***')
  })

  it('encontra documento em textos de certificado', () => {
    expect(findDocumentInText('FULANO: 529.982.247-25')?.type).toBe('CPF')
    expect(findDocumentInText('EMPRESA: 11.222.333/0001-81')?.document).toBe('11222333000181')
    expect(findDocumentInText('sem documento valido')).toBeNull()
    expect(findDocumentInText('')).toBeNull()
  })
})

describe('configuracoes', () => {
  it('aceita objeto vazio e devolve padroes', () => {
    expect(coerceSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('mescla chaves conhecidas e ignora desconhecidas', () => {
    const result = coerceSettings({
      theme: 'dark',
      sessionLimit: 10,
      intruso: true,
      clipboardClearSeconds: undefined,
    })
    expect(result.theme).toBe('dark')
    expect(result.sessionLimit).toBe(10)
    expect(result.clipboardClearSeconds).toBe(DEFAULT_SETTINGS.clipboardClearSeconds)
    expect('intruso' in result).toBe(false)
  })

  it('cai para padroes quando o objeto e invalido', () => {
    expect(coerceSettings({ theme: 'neon', sessionLimit: 999 })).toEqual(DEFAULT_SETTINGS)
    expect(coerceSettings('nao-e-objeto')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('servicos nativos', () => {
  it('mantem ids estaveis e receitas coerentes', () => {
    const ids = BUILTIN_SERVICES.map((service) => service.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(Object.values(BUILTIN_SERVICE_IDS))
    for (const service of BUILTIN_SERVICES) {
      expect(service.baseUrl.startsWith('https://')).toBe(true)
      expect(service.allowedDomains.length).toBeGreaterThan(0)
      expect(service.authMethods).toContain(service.defaultAuth)
      expect(service.recipe.version).toBe(1)
      expect(service.recipe.postLogin.selectors.length).toBeGreaterThan(0)
    }
  })
})
