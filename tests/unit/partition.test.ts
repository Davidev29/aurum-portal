import { describe, expect, it } from 'vitest'
import {
  buildPartition,
  isPartitionForClient,
  sanitizePartitionSegment,
  sessionReuseKey,
} from '../../electron/main/sessions/partition'

describe('particoes de sessao', () => {
  it('sanitiza segmentos removendo caracteres perigosos', () => {
    expect(sanitizePartitionSegment('abc-123_XYZ')).toBe('abc-123_XYZ')
    expect(sanitizePartitionSegment('a b/c:d')).toBe('a_b_c_d')
    expect(sanitizePartitionSegment('../../etc')).toBe('______etc')
    expect(sanitizePartitionSegment('x'.repeat(200))).toHaveLength(96)
    expect(() => sanitizePartitionSegment('')).toThrow(/inv/i)
    expect(() => sanitizePartitionSegment('!!!')).not.toThrow()
  })

  it('monta particao persistente por cliente e metodo', () => {
    expect(buildPartition({ clientId: 'client-1', authMethod: 'password' })).toBe(
      'persist:client:client-1',
    )
    expect(
      buildPartition({
        clientId: 'client-1',
        certificateId: 'cert-9',
        authMethod: 'certificate',
      }),
    ).toBe('persist:client:client-1:cert:cert-9')
  })

  it('monta particao descartavel sem prefixo persist', () => {
    expect(buildPartition({ clientId: 'c1', authMethod: 'password', disposable: true })).toBe(
      'client:c1',
    )
    expect(
      buildPartition({
        clientId: 'c1',
        certificateId: 'cert-1',
        authMethod: 'certificate',
        disposable: true,
      }),
    ).toBe('client:c1:cert:cert-1')
  })

  it('exige certificado quando o metodo e certificado', () => {
    expect(() => buildPartition({ clientId: 'c1', authMethod: 'certificate' })).toThrow(
      /certificado/i,
    )
    expect(() =>
      buildPartition({ clientId: 'c1', authMethod: 'certificate', certificateId: null }),
    ).toThrow(/certificado/i)
  })

  it('nao inclui certificado em particao por senha', () => {
    expect(
      buildPartition({
        clientId: 'c1',
        certificateId: 'ignorado',
        authMethod: 'password',
      }),
    ).toBe('persist:client:c1')
  })

  it('isola clientes diferentes em particoes diferentes', () => {
    const a = buildPartition({ clientId: 'cliente-a', authMethod: 'password' })
    const b = buildPartition({ clientId: 'cliente-b', authMethod: 'password' })
    expect(a).not.toBe(b)
    expect(isPartitionForClient(a, 'cliente-a')).toBe(true)
    expect(isPartitionForClient(a, 'cliente-b')).toBe(false)
  })

  it('distingue certificados na chave de reuso', () => {
    expect(
      sessionReuseKey({
        clientId: 'c1',
        serviceId: 's1',
        authMethod: 'certificate',
        certificateId: 'cert-a',
      }),
    ).toBe('c1|s1|certificate|cert-a')
    expect(
      sessionReuseKey({
        clientId: 'c1',
        serviceId: 's1',
        authMethod: 'certificate',
        certificateId: null,
      }),
    ).toBe('c1|s1|certificate|none')
    expect(
      sessionReuseKey({
        clientId: 'c1',
        serviceId: 's1',
        authMethod: 'password',
        credentialId: 'cred-1',
      }),
    ).toBe('c1|s1|password|cred-1')
    expect(sessionReuseKey({ clientId: 'c1', serviceId: 's1', authMethod: 'password' })).toBe(
      'c1|s1|password|default',
    )
  })
})
