import { describe, expect, it } from 'vitest'
import {
  chainEffectiveValidTo,
  computeRenewalInfo,
  certificateEffectiveValidToOf,
  getEffectiveExpiryInfo,
  getExpiryInfo,
  renewalDocumentKey,
  renewalHistoryFor,
} from '../../shared/certificate-renewal'
import {
  getCertificateDetails,
  listCertificates,
} from '../../electron/main/db/repositories/certificates'
import { createDatabase } from '../../electron/main/db/database'
import { createClient } from '../../electron/main/db/repositories/clients'
import { certificates } from '../../electron/main/db/schema'

const NOW = new Date('2026-06-01T00:00:00.000Z')

function cert(overrides: {
  id: string
  holderName?: string
  document?: string | null
  validFrom: string
  validTo: string
  createdAt?: string
  source?: 'pfx' | 'windows'
}) {
  return {
    id: overrides.id,
    holderName: overrides.holderName ?? 'MARIA SILVA',
    document: overrides.document === undefined ? '12345678909' : overrides.document,
    documentType: 'CPF' as const,
    validFrom: overrides.validFrom,
    validTo: overrides.validTo,
    createdAt: overrides.createdAt ?? '2025-01-01T00:00:00.000Z',
    source: overrides.source ?? 'pfx',
  }
}

describe('certificate renewal', () => {
  it('agrupa pelo documento apenas digitos', () => {
    const a = cert({
      id: 'a',
      document: '123.456.789-09',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
    })
    const b = cert({
      id: 'b',
      document: '12345678909',
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
    })
    const other = cert({
      id: 'c',
      document: '98765432100',
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
    })
    expect(renewalDocumentKey(a)).toBe(renewalDocumentKey(b))
    expect(renewalDocumentKey(a)).not.toBe(renewalDocumentKey(other))
    expect(renewalHistoryFor(a, [b, a, other]).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('marca renovado quando ha sucessor com data valida', () => {
    const oldCert = cert({
      id: 'old',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
    })
    const renewed = cert({
      id: 'new',
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
      createdAt: '2025-01-02T00:00:00.000Z',
    })
    const info = computeRenewalInfo(oldCert, [renewed, oldCert], NOW)
    expect(info.isRenewed).toBe(true)
    expect(info.hasNewerValid).toBe(true)
    expect(info.renewedBy?.id).toBe('new')
    expect(info.hasHistory).toBe(true)
    const currentInfo = computeRenewalInfo(renewed, [renewed, oldCert], NOW)
    expect(currentInfo.isRenewed).toBe(false)
    expect(currentInfo.previous?.id).toBe('old')
    expect(currentInfo.next).toBeNull()
  })

  it('sucessor tambem vencido nao conta como renovacao', () => {
    const oldCert = cert({
      id: 'old',
      validFrom: '2023-01-01T00:00:00.000Z',
      validTo: '2024-01-01T00:00:00.000Z',
    })
    const alsoExpired = cert({
      id: 'exp',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
      createdAt: '2024-01-02T00:00:00.000Z',
    })
    // Ambos vencidos em 2026-06-01: nao ha "novo com data valida"
    const info = computeRenewalInfo(oldCert, [oldCert, alsoExpired], NOW)
    expect(info.isRenewed).toBe(false)
    expect(info.hasNewerValid).toBe(false)
    expect(info.next?.id).toBe('exp')
  })

  it('sem documento agrupa por titular', () => {
    const a = cert({
      id: 'a',
      holderName: 'EMPRESA LTDA',
      document: null,
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
    })
    const b = cert({
      id: 'b',
      holderName: 'empresa  ltda',
      document: null,
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
    })
    expect(renewalHistoryFor(a, [a, b]).map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('agrupa certificados do mesmo CPF de emissoras diferentes no historico', () => {
    const a = cert({
      id: 'a',
      document: '12345678909',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
      source: 'pfx' as const,
    })
    const b = cert({
      id: 'b',
      document: '12345678909',
      validFrom: '2025-02-01T00:00:00.000Z',
      validTo: '2026-02-01T00:00:00.000Z',
      source: 'windows' as const,
    })
    const c = cert({
      id: 'c',
      document: '12345678909',
      validFrom: '2026-03-01T00:00:00.000Z',
      validTo: '2027-03-01T00:00:00.000Z',
      source: 'pfx' as const,
    })
    const history = renewalHistoryFor(a, [a, b, c])
    expect(history.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    // Cada certificado mantem sua emissora (source) especifica no historico.
    expect(history.find((item) => item.id === 'b')?.source).toBe('windows')
    expect(history.find((item) => item.id === 'c')?.source).toBe('pfx')
  })

  it('multiplos validos simultaneos mesmo CPF: nao marca como renovado enquanto ha sucessor valido', () => {
    const a = cert({
      id: 'a',
      document: '12345678909',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-01-01T00:00:00.000Z',
    })
    const b = cert({
      id: 'b',
      document: '12345678909',
      validFrom: '2025-01-01T00:00:00.000Z',
      validTo: '2026-12-01T00:00:00.000Z',
      createdAt: '2025-01-02T00:00:00.000Z',
    })
    const c = cert({
      id: 'c',
      document: '12345678909',
      validFrom: '2025-06-01T00:00:00.000Z',
      validTo: '2027-06-01T00:00:00.000Z',
      createdAt: '2025-06-02T00:00:00.000Z',
    })
    // 'a' tem sucessores validos (b e c): esta renovado, o renewedBy eh o mais antigo valido (b).
    const infoA = computeRenewalInfo(a, [a, b, c], NOW)
    expect(infoA.isRenewed).toBe(true)
    expect(infoA.renewedBy?.id).toBe('b')
    expect(infoA.history.map((item) => item.id)).toEqual(['a', 'b', 'c'])
    // 'c' eh o mais recente e valido: nao esta renovado.
    const infoC = computeRenewalInfo(c, [a, b, c], NOW)
    expect(infoC.isRenewed).toBe(false)
    expect(infoC.previous?.id).toBe('b')
  })

  it('getExpiryInfo classifica vencido / a vencer / em vigor', () => {
    const expired = getExpiryInfo(
      { validTo: '2026-05-01T00:00:00.000Z', daysUntilExpiry: -31 },
      NOW,
    )
    expect(expired.expired).toBe(true)
    expect(expired.tone).toBe('danger')
    expect(expired.label).toContain('Vencido')
    const expiring = getExpiryInfo({ validTo: '2026-06-10T00:00:00.000Z', daysUntilExpiry: 9 }, NOW)
    expect(expiring.expiring).toBe(true)
    expect(expiring.tone).toBe('warning')
    const ok = getExpiryInfo({ validTo: '2027-06-01T00:00:00.000Z', daysUntilExpiry: 365 }, NOW)
    expect(ok.expired).toBe(false)
    expect(ok.tone).toBe('success')
  })

  it('alerta de vencimento so comeca 30 dias antes (1 mes)', () => {
    // NOW = 2026-06-01. 30 dias => 2026-07-01, 31 dias => 2026-07-02.
    const in31 = getExpiryInfo({ validTo: '2026-07-02T00:00:00.000Z', daysUntilExpiry: 31 }, NOW)
    expect(in31.expiring).toBe(false)
    expect(in31.tone).toBe('success')
    const in30 = getExpiryInfo({ validTo: '2026-07-01T00:00:00.000Z', daysUntilExpiry: 30 }, NOW)
    expect(in30.expiring).toBe(true)
    expect(in30.tone).toBe('warning')
    const in11 = getExpiryInfo({ validTo: '2026-06-12T00:00:00.000Z', daysUntilExpiry: 11 }, NOW)
    expect(in11.expiring).toBe(true)
    const in0 = getExpiryInfo({ validTo: '2026-06-01T00:00:00.000Z', daysUntilExpiry: 0 }, NOW)
    expect(in0.expiring).toBe(true)
    expect(in0.expired).toBe(false)
  })

  it('chainEffectiveValidTo retorna o fim da validade do ultimo certificado da cadeia', () => {
    const a = cert({
      id: 'a',
      validFrom: '2023-01-01T00:00:00.000Z',
      validTo: '2024-01-01T00:00:00.000Z',
    })
    const b = cert({
      id: 'b',
      validFrom: '2024-01-01T00:00:00.000Z',
      validTo: '2025-06-01T00:00:00.000Z',
      createdAt: '2024-01-02T00:00:00.000Z',
    })
    const c = cert({
      id: 'c',
      validFrom: '2025-06-01T00:00:00.000Z',
      validTo: '2028-01-01T00:00:00.000Z',
      createdAt: '2025-06-02T00:00:00.000Z',
    })
    const chain = renewalHistoryFor(a, [a, b, c])
    expect(chainEffectiveValidTo(a, chain)).toBe(c.validTo)
    expect(chainEffectiveValidTo(b, chain)).toBe(c.validTo)
    expect(chainEffectiveValidTo(c, chain)).toBe(c.validTo)
    // Cadeia totalmente vencida: usa a maio data conhecida (o "ultimo" da cadeia).
    const only = cert({
      id: 'only',
      validFrom: '2023-01-01T00:00:00.000Z',
      validTo: '2024-01-01T00:00:00.000Z',
    })
    expect(chainEffectiveValidTo(only, [only])).toBe(only.validTo)
  })

  it('getEffectiveExpiryInfo conta a partir do fim da cadeia, nao do sucessor imediato', () => {
    // NOW = 2026-06-01. Cadeia A(vencido) -> B(vencido) -> C(valido ate 2027-06-01, +365d).
    const c = cert({
      id: 'c',
      validFrom: '2026-06-01T00:00:00.000Z',
      validTo: '2027-06-01T00:00:00.000Z',
    })
    const expiry = getEffectiveExpiryInfo(
      { validTo: '2024-01-01T00:00:00.000Z', daysUntilExpiry: -518 },
      c.validTo,
      NOW,
    )
    expect(expiry.expired).toBe(false)
    expect(expiry.daysUntilExpiry).toBeGreaterThan(360)
    // Sem cadeia mais distante, cai para o validTo proprio.
    const alone = getEffectiveExpiryInfo(
      { validTo: '2024-01-01T00:00:00.000Z', daysUntilExpiry: -518 },
      '2024-01-01T00:00:00.000Z',
      NOW,
    )
    expect(alone.expired).toBe(true)
  })

  it('certificateEffectiveValidToOf prefere o efetivo e cai para o validTo proprio', () => {
    expect(
      certificateEffectiveValidToOf({
        validTo: '2024-01-01T00:00:00.000Z',
        effectiveValidTo: '2028-01-01T00:00:00.000Z',
      }),
    ).toBe('2028-01-01T00:00:00.000Z')
    expect(
      certificateEffectiveValidToOf({
        validTo: '2024-01-01T00:00:00.000Z',
        effectiveValidTo: null,
      }),
    ).toBe('2024-01-01T00:00:00.000Z')
    expect(certificateEffectiveValidToOf({ validTo: '2024-01-01T00:00:00.000Z' })).toBe(
      '2024-01-01T00:00:00.000Z',
    )
  })
})

describe('certificate details (db)', () => {
  function seedCertificate(
    db: ReturnType<typeof createDatabase>['db'],
    id: string,
    validFrom: string,
    validTo: string,
    createdAt: string,
  ) {
    // Insercao direta para nao depender do parse de PFX nos testes de renovacao.
    db.insert(certificates)
      .values({
        id,
        clientId: null,
        label: `Cert ${id}`,
        holderName: 'MARIA SILVA',
        document: '12345678909',
        documentType: 'CPF',
        subjectDn: `CN=${id}`,
        issuerDn: 'CN=AC',
        serialHex: id.toUpperCase(),
        thumbprintSha1: `AA${id}`.slice(0, 40).padEnd(40, '0'),
        thumbprintSha256: `BB${id}`.slice(0, 64).padEnd(64, '0'),
        validFrom,
        validTo,
        source: 'pfx',
        installed: true,
        createdAt,
        updatedAt: createdAt,
      })
      .run()
  }

  it('getCertificateDetails retorna historico ordenado e renovacao', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, { type: 'PF', name: 'Maria', document: '12345678909' })
      expect(client.id).toBeTruthy()
      seedCertificate(
        db,
        'old0000000000000000000000000001',
        '2024-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      )
      seedCertificate(
        db,
        'new0000000000000000000000000002',
        '2025-01-01T00:00:00.000Z',
        '2027-06-01T00:00:00.000Z',
        '2025-01-02T00:00:00.000Z',
      )
      const detailsOld = getCertificateDetails(
        db,
        'old0000000000000000000000000001',
        new Date('2026-06-01T00:00:00.000Z'),
      )
      expect(detailsOld.certificate.id).toBe('old0000000000000000000000000001')
      expect(detailsOld.isRenewed).toBe(true)
      expect(detailsOld.renewedBy?.id).toBe('new0000000000000000000000000002')
      expect(detailsOld.history.map((entry) => entry.id)).toEqual([
        'old0000000000000000000000000001',
        'new0000000000000000000000000002',
      ])
      expect(detailsOld.hasHistory).toBe(true)
      const current = getCertificateDetails(
        db,
        'new0000000000000000000000000002',
        new Date('2026-06-01T00:00:00.000Z'),
      )
      expect(current.isRenewed).toBe(false)
      expect(current.previous?.id).toBe('old0000000000000000000000000001')
      // O certificado antigo foi renovado: nao deve aparecer como vencido (falso positivo eliminado).
      // Seu status efetivo agora eh baseado na data do sucessor (valido por 365 dias).
      const expiredList = listCertificates(
        db,
        { status: 'expired', includeHistory: true },
        new Date('2026-06-01T00:00:00.000Z'),
      )
      expect(
        expiredList.find((item) => item.id === 'old0000000000000000000000000001'),
      ).toBeUndefined()
      // Aparece na lista de validos (com historico), marcado como renovado.
      const validList = listCertificates(
        db,
        { status: 'valid', includeHistory: true },
        new Date('2026-06-01T00:00:00.000Z'),
      )
      const oldInValid = validList.find((item) => item.id === 'old0000000000000000000000000001')
      expect(oldInValid?.isRenewed).toBe(true)
      expect(oldInValid?.renewedById).toBe('new0000000000000000000000000002')
      expect(oldInValid?.daysUntilExpiry).toBeGreaterThan(0)
      // Data exibida/efetiva = fim da cadeia (data do sucessor), nao a data crua do antigo.
      expect(oldInValid?.effectiveValidTo).toBe('2027-06-01T00:00:00.000Z')
      expect(oldInValid?.validTo).toBe('2025-01-01T00:00:00.000Z')
      const newInValid = validList.find((item) => item.id === 'new0000000000000000000000000002')
      expect(newInValid?.effectiveValidTo).toBe('2027-06-01T00:00:00.000Z')
      expect(newInValid?.daysUntilExpiry).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  it('cadeia de 3: vencimento efetivo de A e B e o fim da validade de C (o ultimo valido)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      seedCertificate(
        db,
        'cha0000000000000000000000000001',
        '2023-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
        '2023-01-01T00:00:00.000Z',
      )
      seedCertificate(
        db,
        'chb0000000000000000000000000002',
        '2024-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z',
        '2024-01-02T00:00:00.000Z',
      )
      seedCertificate(
        db,
        'chc0000000000000000000000000003',
        '2025-01-01T00:00:00.000Z',
        '2027-06-01T00:00:00.000Z',
        '2025-01-02T00:00:00.000Z',
      )
      const now = new Date('2026-06-01T00:00:00.000Z')
      const list = listCertificates(db, { includeHistory: true }, now)
      const byId = new Map(list.map((item) => [item.id, item]))
      expect(byId.get('cha0000000000000000000000000001')?.effectiveValidTo).toBe(
        '2027-06-01T00:00:00.000Z',
      )
      expect(byId.get('chb0000000000000000000000000002')?.effectiveValidTo).toBe(
        '2027-06-01T00:00:00.000Z',
      )
      expect(byId.get('chc0000000000000000000000000003')?.effectiveValidTo).toBe(
        '2027-06-01T00:00:00.000Z',
      )
      // Nenhum deles aparece como vencido: a cadeia inteira segue a validade de C.
      expect(listCertificates(db, { status: 'expired' }, now)).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('listagem padrao mostra apenas o certificado atual de cada documento (historicos so no modal)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      seedCertificate(
        db,
        'his0000000000000000000000000001',
        '2023-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
        '2023-01-01T00:00:00.000Z',
      )
      seedCertificate(
        db,
        'his0000000000000000000000000002',
        '2024-01-01T00:00:00.000Z',
        '2025-01-01T00:00:00.000Z',
        '2024-01-02T00:00:00.000Z',
      )
      seedCertificate(
        db,
        'cur0000000000000000000000000003',
        '2025-01-01T00:00:00.000Z',
        '2027-06-01T00:00:00.000Z',
        '2025-01-02T00:00:00.000Z',
      )
      const now = new Date('2026-06-01T00:00:00.000Z')
      // Padrão: apenas o certificado atual da cadeia.
      const list = listCertificates(db, {}, now)
      expect(list.map((item) => item.id)).toEqual(['cur0000000000000000000000000003'])
      // includeHistory: universo completo, para o histórico do modal.
      const full = listCertificates(db, { includeHistory: true }, now)
      expect(full.map((item) => item.id)).toEqual([
        'his0000000000000000000000000001',
        'his0000000000000000000000000002',
        'cur0000000000000000000000000003',
      ])
      // O histórico do modal continua completo para qualquer membro da cadeia.
      const details = getCertificateDetails(db, 'his0000000000000000000000000001', now)
      expect(details.history.map((entry) => entry.id)).toEqual([
        'his0000000000000000000000000001',
        'his0000000000000000000000000002',
        'cur0000000000000000000000000003',
      ])
    } finally {
      close()
    }
  })

  it('cadeia a 20 dias do fim vira "a vencer" (limite de 30 dias)', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      seedCertificate(
        db,
        'exp0000000000000000000000000001',
        '2025-06-01T00:00:00.000Z',
        '2026-06-21T00:00:00.000Z',
        '2025-06-01T00:00:00.000Z',
      )
      const now = new Date('2026-06-01T00:00:00.000Z')
      const list = listCertificates(db, {}, now)
      expect(list[0]?.status).toBe('expiring')
      expect(list[0]?.daysUntilExpiry).toBe(20)
    } finally {
      close()
    }
  })
})
