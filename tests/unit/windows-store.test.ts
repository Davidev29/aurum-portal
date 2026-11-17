import { describe, expect, it } from 'vitest'
import {
  buildExportScript,
  normalizeSha1,
  parseWindowsCertificateRecords,
} from '../../electron/main/certificates/windows-store'

describe('windows-store: exportação transitória para assinatura', () => {
  it('normaliza thumbprint SHA-1 e rejeita inválido', () => {
    expect(normalizeSha1('ab cd-1234 5678 90ab cdef 1234 5678 90ab cdef 1234')).toBe(
      'ABCD1234567890ABCDEF1234567890ABCDEF1234',
    )
    expect(() => normalizeSha1('curto')).toThrow(/Thumbprint SHA-1 invalido/)
  })

  it('gera script de exportação que lê caminho/senha do ambiente (nunca em arquivo)', () => {
    const script = buildExportScript('abcd1234567890abcdef1234567890abcdef1234')
    expect(script).toContain('Export-PfxCertificate')
    expect(script).toContain('Cert:\\CurrentUser\\My\\ABCD1234567890ABCDEF1234567890ABCDEF1234')
    expect(script).toContain('HasPrivateKey')
    // Nada de caminho/senha persistidos no corpo do script:
    expect(script).toContain('$env:PV_PFX_PATH')
    expect(script).toContain('$env:PV_PFX_PASSWORD')
    expect(script).not.toMatch(/FromBase64String\('[^']{20,}'\)/)
  })

  it('script rejeita thumbprint inválido', () => {
    expect(() => buildExportScript('invalido')).toThrow(/Thumbprint SHA-1 invalido/)
  })

  it('parser ignora registros inválidos e mantém válidos', () => {
    const parsed = parseWindowsCertificateRecords({
      ok: true,
      certificates: [
        {
          thumbprintSha1: 'A'.repeat(40),
          thumbprintSha256: 'B'.repeat(64),
          subject: 'CN=Fulano:12345678909, O=ICP',
          issuer: 'CN=AC, O=ICP',
          notBefore: '2025-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z',
          serialNumber: 'ABC',
          hasPrivateKey: true,
        },
        {
          thumbprintSha1: 'curto',
          subject: 'CN=Ruim',
          issuer: 'CN=AC',
          notBefore: '2025-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z',
          serialNumber: 'X',
          hasPrivateKey: true,
        },
        null,
        'lixo',
      ],
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.holderName).toBe('Fulano')
    expect(parsed[0]?.document).toBe('12345678909')
  })

  it('parser retorna [] para payload inválido', () => {
    expect(parseWindowsCertificateRecords(null)).toEqual([])
    expect(parseWindowsCertificateRecords({ ok: false, certificates: [] })).toEqual([])
  })
})
