import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../electron/main/db/database'
import {
  CertificateService,
  selectWindowsImportTargets,
} from '../../electron/main/certificates/service'
import type { WindowsCertificateRecord } from '../../electron/main/certificates/windows-store'
import type { VaultService } from '../../electron/main/vault/service'

function windowsRecord(
  overrides: Partial<WindowsCertificateRecord> = {},
): WindowsCertificateRecord {
  const sha1 = overrides.thumbprintSha1 ?? 'A'.repeat(40)
  return {
    thumbprintSha1: sha1,
    thumbprintSha256: overrides.thumbprintSha256 ?? 'B'.repeat(64),
    subject: 'CN=Fulano Teste:52998224725, O=ICP-Brasil',
    issuer: 'CN=AC Teste, O=ICP-Brasil',
    holderName: 'Fulano Teste',
    document: '52998224725',
    documentType: 'CPF',
    notBefore: '2025-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    serialNumber: '01AC',
    hasPrivateKey: true,
    ...overrides,
  }
}

function makeService(records: WindowsCertificateRecord[]) {
  const { db, close } = createDatabase(':memory:')
  const windows = {
    list: async () => records,
    install: async () => ({ ok: true, thumbprint: null, error: null }),
    remove: async () => ({ ok: true, error: null }),
  }
  const service = new CertificateService({
    db,
    vault: {} as unknown as VaultService,
    windows,
  })
  return { db, close, service }
}

describe('importação em lote do Windows', () => {
  it('importAll importa todos os certificados instalados de uma vez', async () => {
    const records = [
      windowsRecord({
        thumbprintSha1: 'A'.repeat(40),
        thumbprintSha256: 'B'.repeat(64),
        holderName: 'Um',
        document: '52998224725',
      }),
      windowsRecord({
        thumbprintSha1: 'C'.repeat(40),
        thumbprintSha256: 'D'.repeat(64),
        holderName: 'Dois',
        document: '11144477735',
      }),
    ]
    const { close, service } = makeService(records)
    try {
      const result = await service.importFromWindows({ importAll: true, consent: false })
      expect(result.total).toBe(2)
      expect(result.imported).toBe(2)
      expect(result.duplicates).toBe(0)
      expect(result.errors).toBe(0)
      expect(result.certificates).toHaveLength(2)
      expect(result.items).toHaveLength(2)
      expect(result.items.every((item) => item.status === 'imported')).toBe(true)
    } finally {
      close()
    }
  })

  it('importação repetida marca duplicados em vez de criar de novo', async () => {
    const records = [
      windowsRecord({ thumbprintSha1: 'A'.repeat(40), thumbprintSha256: 'B'.repeat(64) }),
    ]
    const { close, service } = makeService(records)
    try {
      const first = await service.importFromWindows({ importAll: true })
      expect(first.imported).toBe(1)
      const second = await service.importFromWindows({ importAll: true })
      expect(second.imported).toBe(0)
      expect(second.duplicates).toBe(1)
      expect(second.items[0]?.status).toBe('duplicate')
      expect(second.items[0]?.certificateId).toBe(first.items[0]?.certificateId)
    } finally {
      close()
    }
  })

  it('importação por thumbprints importa apenas a seleção', async () => {
    const records = [
      windowsRecord({ thumbprintSha1: 'A'.repeat(40), thumbprintSha256: 'B'.repeat(64) }),
      windowsRecord({
        thumbprintSha1: 'C'.repeat(40),
        thumbprintSha256: 'D'.repeat(64),
        holderName: 'Outro',
      }),
    ]
    const { close, service } = makeService(records)
    try {
      const result = await service.importFromWindows({ thumbprints: ['C'.repeat(40)] })
      expect(result.imported).toBe(1)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]?.thumbprintSha1).toBe('C'.repeat(40))
    } finally {
      close()
    }
  })

  it('um certificado sem SHA-256 não interrompe o lote', async () => {
    const records = [
      windowsRecord({ thumbprintSha1: 'A'.repeat(40), thumbprintSha256: '' }),
      windowsRecord({
        thumbprintSha1: 'C'.repeat(40),
        thumbprintSha256: 'D'.repeat(64),
        holderName: 'Bom',
      }),
    ]
    const { close, service } = makeService(records)
    try {
      const result = await service.importFromWindows({ importAll: true })
      expect(result.imported).toBe(1)
      expect(result.errors).toBe(1)
      expect(result.items.find((item) => item.status === 'error')?.thumbprintSha1).toBe(
        'A'.repeat(40),
      )
      expect(result.items.find((item) => item.status === 'imported')?.thumbprintSha1).toBe(
        'C'.repeat(40),
      )
    } finally {
      close()
    }
  })

  it('thumbprint ausente vira erro por item sem abortar', async () => {
    const records = [
      windowsRecord({ thumbprintSha1: 'A'.repeat(40), thumbprintSha256: 'B'.repeat(64) }),
    ]
    const { close, service } = makeService(records)
    try {
      const result = await service.importFromWindows({ thumbprints: ['F'.repeat(40)] })
      expect(result.imported).toBe(0)
      expect(result.errors).toBe(1)
      expect(result.items[0]?.status).toBe('error')
    } finally {
      close()
    }
  })

  it('exige seleção quando importAll não foi pedido', async () => {
    const { close, service } = makeService([windowsRecord()])
    try {
      await expect(service.importFromWindows({ thumbprints: [] })).rejects.toThrow(
        /Nenhum certificado/,
      )
      await expect(service.importFromWindows({})).rejects.toThrow(/Nenhum certificado/)
    } finally {
      close()
    }
  })

  it('certificado vencido é importado como registro com status expired', async () => {
    const records = [
      windowsRecord({
        thumbprintSha1: 'A'.repeat(40),
        thumbprintSha256: 'B'.repeat(64),
        notAfter: '2020-01-01T00:00:00.000Z',
      }),
    ]
    const { close, service } = makeService(records)
    try {
      const result = await service.importFromWindows({ importAll: true })
      expect(result.imported).toBe(1)
      expect(result.items[0]?.status).toBe('expired')
    } finally {
      close()
    }
  })

  it('consentimento com documento cria/vincula cliente automaticamente', async () => {
    const records = [
      windowsRecord({
        thumbprintSha1: 'A'.repeat(40),
        thumbprintSha256: 'B'.repeat(64),
        document: '52998224725',
      }),
    ]
    const { close, service } = makeService(records)
    try {
      const result = await service.importFromWindows({ importAll: true, consent: true })
      expect(result.imported).toBe(1)
      const created = result.certificates[0]
      expect(created?.document).toBe('52998224725')
      expect(created?.clientId).toBeTruthy()
      expect(created?.clients).toHaveLength(1)

      // Sem consentimento e sem cliente explícito: importa sem vincular.
      const second = await service.importFromWindows({ importAll: true, consent: false })
      expect(second.imported).toBe(0)
      expect(second.duplicates).toBe(1)
    } finally {
      close()
    }
  })

  it('selectWindowsImportTargets deduplica e ignora duplicados de entrada', () => {
    const records = [
      windowsRecord({ thumbprintSha1: 'A'.repeat(40), thumbprintSha256: 'B'.repeat(64) }),
      windowsRecord({ thumbprintSha1: 'A'.repeat(40), thumbprintSha256: 'B'.repeat(64) }),
    ]
    const all = selectWindowsImportTargets(records, { importAll: true })
    expect(all.targets).toHaveLength(1)

    const selected = selectWindowsImportTargets(records, {
      thumbprints: ['a'.repeat(40), 'A'.repeat(40), 'F'.repeat(40)],
    })
    expect(selected.targets).toHaveLength(1)
    expect(selected.missingThumbprints).toEqual(['F'.repeat(40)])

    const empty = selectWindowsImportTargets(records, { thumbprints: [] })
    expect(empty.targets).toEqual([])
  })
})
