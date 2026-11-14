import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  createPfxCertificate,
  createWindowsCertificate,
  getCertificateLinks,
  linkClientToCertificate,
  listCertificates,
  unlinkClientFromCertificate,
} from '../../electron/main/db/repositories/certificates'
import { createClient, setClientStatus } from '../../electron/main/db/repositories/clients'
import { createDatabase } from '../../electron/main/db/database'
import { certificateClients } from '../../electron/main/db/schema'
import type { VaultService } from '../../electron/main/vault/service'
import type { ParsedPfx } from '../../electron/main/certificates/parse'
import type { WindowsCertificate } from '../../shared/types'

/**
 * Regressão do fluxo de Acessos: um certificado RENOVADO (mesmo CPF/CNPJ,
 * nova validade) importado sem consentimento/explícito não pode ficar sem os
 * vínculos já consentidos do certificado anterior — caso contrário, a
 * colapse de renovação da listagem oculta o anterior vinculado e o cliente
 * some do fluxo de abertura de sessão mesmo com certificado válido.
 */

const vault = {
  sealPfx: (_id: string, _pfx: Buffer, password: string) => ({
    pfxEnc: `pfx-enc:${password.length}`,
    passwordEnc: `pwd-enc:${password.length}`,
  }),
} as unknown as VaultService

let counter = 0
function nextHex(length: number): string {
  counter += 1
  return String(counter.toString(16).toUpperCase()).padStart(length, '0').slice(-length)
}

function parsed(overrides: Partial<ParsedPfx> = {}): ParsedPfx {
  return {
    holderName: 'MARIANA COSTA',
    document: '12345678909',
    documentType: 'CPF',
    subjectDn: 'CN=MARIANA COSTA:12345678909',
    issuerDn: 'CN=AC Teste, O=ICP-Brasil',
    serialHex: nextHex(8),
    thumbprintSha1: nextHex(40),
    thumbprintSha256: nextHex(64),
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2028-01-01T00:00:00.000Z',
    isExpired: false,
    certificateCount: 1,
    hasPrivateKey: true,
    ...overrides,
  }
}

function pfxInput(overrides: Partial<Parameters<typeof createPfxCertificate>[2]> = {}) {
  return {
    parsed: parsed(),
    pfx: Buffer.from('pfx-bytes'),
    password: 'senha-secreta',
    clientId: null as string | null,
    consent: undefined as boolean | undefined,
    install: false,
    installed: false,
    ...overrides,
  }
}

describe('herança de vínculos na renovação de certificado', () => {
  it('importar a renovação sem consentimento herda o vínculo consentido do certificado anterior', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Mariana',
        document: '12345678909',
        consent: true,
      })
      const before = createPfxCertificate(
        db,
        vault,
        pfxInput({ clientId: client.id, consent: true }),
      )
      expect(before.row.clientId).toBe(client.id)

      // Renovação chega sem consentimento e sem cliente: antes da correção,
      // o vínculo era perdido e o cliente sumia dos Acessos.
      const renewed = createPfxCertificate(
        db,
        vault,
        pfxInput({
          parsed: parsed({
            validFrom: '2027-06-01T00:00:00.000Z',
            validTo: '2030-06-01T00:00:00.000Z',
          }),
          clientId: null,
          consent: false,
        }),
      )
      expect(renewed.inheritedClientIds).toEqual([client.id])
      expect(renewed.row.clientId).toBe(client.id)
      expect(getCertificateLinks(db, renewed.row.id).map((link) => link.id)).toContain(client.id)

      // A listagem padrão colapsa para o certificado atual da cadeia (a
      // renovação) — e ele ESTÁ vinculado ao cliente.
      const visible = listCertificates(db, {})
      expect(visible.map((item) => item.id)).toEqual([renewed.row.id])
      expect(visible[0]?.clients.map((link) => link.id)).toContain(client.id)
      const full = listCertificates(db, { includeHistory: true })
      expect(full.map((item) => item.id).sort()).toEqual([before.row.id, renewed.row.id].sort())
    } finally {
      close()
    }
  })

  it('herança de Windows: reimportar o certificado restaura vínculos removidos numa cadeia', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Mariana',
        document: '12345678909',
        consent: true,
      })
      const first = createPfxCertificate(
        db,
        vault,
        pfxInput({ clientId: client.id, consent: true }),
      )
      const renewed = createPfxCertificate(
        db,
        vault,
        pfxInput({
          parsed: parsed({
            validFrom: '2027-06-01T00:00:00.000Z',
            validTo: '2030-06-01T00:00:00.000Z',
          }),
        }),
      )
      expect(renewed.inheritedClientIds).toEqual([client.id])

      // Remove o vínculo da renovação (operador desvinculou por engano).
      unlinkClientFromCertificate(db, renewed.row.id, client.id)
      expect(getCertificateLinks(db, renewed.row.id)).toHaveLength(0)

      // Reimportação do mesmo certificado Windows repara a cadeia.
      const windowsRecord: WindowsCertificate = {
        thumbprintSha1: renewed.row.thumbprintSha1,
        thumbprintSha256: renewed.row.thumbprintSha256,
        subject: 'CN=MARIANA COSTA:12345678909, O=ICP-Brasil',
        issuer: 'CN=AC Teste, O=ICP-Brasil',
        holderName: 'MARIANA COSTA',
        document: '12345678909',
        notBefore: renewed.row.validFrom,
        notAfter: renewed.row.validTo,
        serialNumber: renewed.row.serialHex,
        hasPrivateKey: true,
        alreadyImported: true,
        certificateId: renewed.row.id,
      }
      const again = createWindowsCertificate(db, windowsRecord, null, false)
      expect(again.row.id).toBe(renewed.row.id)
      expect(again.inheritedClientIds).toEqual([client.id])
      expect(getCertificateLinks(db, renewed.row.id).map((link) => link.id)).toContain(client.id)
      expect(getCertificateLinks(db, first.row.id).map((link) => link.id)).toContain(client.id)
    } finally {
      close()
    }
  })

  it('vínculo sem consentimento registrado não é herdado', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Sem Consentir',
        document: '12345678909',
        consent: true,
      })
      const other = createClient(db, {
        type: 'PF',
        name: 'Consentiu',
        document: '98765432100',
        consent: true,
      })
      const before = createPfxCertificate(
        db,
        vault,
        pfxInput({ clientId: client.id, consent: true }),
      )
      // Simula vínculo legado SEM consentimento gravado (consentAt nulo).
      db.insert(certificateClients)
        .values({
          certificateId: before.row.id,
          clientId: other.id,
          consentAt: null,
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .run()

      const renewed = createPfxCertificate(
        db,
        vault,
        pfxInput({
          parsed: parsed({
            validFrom: '2027-06-01T00:00:00.000Z',
            validTo: '2030-06-01T00:00:00.000Z',
          }),
        }),
      )
      expect(renewed.inheritedClientIds).toEqual([client.id])
      expect(renewed.inheritedClientIds).not.toContain(other.id)
      expect(getCertificateLinks(db, renewed.row.id).map((link) => link.id)).toEqual([client.id])
    } finally {
      close()
    }
  })

  it('cliente arquivado não recebe vínculo herdado', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Arquivado',
        document: '12345678909',
        consent: true,
      })
      createPfxCertificate(db, vault, pfxInput({ clientId: client.id, consent: true }))
      setClientStatus(db, client.id, 'archived')

      const renewed = createPfxCertificate(
        db,
        vault,
        pfxInput({
          parsed: parsed({
            validFrom: '2027-06-01T00:00:00.000Z',
            validTo: '2030-06-01T00:00:00.000Z',
          }),
        }),
      )
      expect(renewed.inheritedClientIds).toEqual([])
      expect(getCertificateLinks(db, renewed.row.id)).toHaveLength(0)
      expect(renewed.row.clientId).toBeNull()
    } finally {
      close()
    }
  })

  it('importação com cliente explícito vincula o escolhido E herda os demais da cadeia', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const first = createClient(db, {
        type: 'PF',
        name: 'Primeiro',
        document: '12345678909',
        consent: true,
      })
      const second = createClient(db, {
        type: 'PF',
        name: 'Segundo',
        document: '98765432100',
        consent: true,
      })
      const before = createPfxCertificate(
        db,
        vault,
        pfxInput({ clientId: first.id, consent: true }),
      )
      linkClientToCertificate(db, before.row.id, second.id, true)

      const renewed = createPfxCertificate(
        db,
        vault,
        pfxInput({
          parsed: parsed({
            validFrom: '2027-06-01T00:00:00.000Z',
            validTo: '2030-06-01T00:00:00.000Z',
          }),
          clientId: first.id,
          consent: true,
        }),
      )
      expect(renewed.inheritedClientIds).toEqual([second.id])
      expect(renewed.inheritedClientIds).not.toContain(first.id)
      expect(
        getCertificateLinks(db, renewed.row.id)
          .map((link) => link.id)
          .sort(),
      ).toEqual([first.id, second.id].sort())
    } finally {
      close()
    }
  })

  it('consentimento herdado preserva a data original do vínculo anterior', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PF',
        name: 'Mariana',
        document: '12345678909',
        consent: true,
      })
      const before = createPfxCertificate(
        db,
        vault,
        pfxInput({ clientId: client.id, consent: true }),
      )
      const original = db
        .select({ consentAt: certificateClients.consentAt })
        .from(certificateClients)
        .where(eq(certificateClients.certificateId, before.row.id))
        .get()
      expect(original?.consentAt).toBeTruthy()

      const renewed = createPfxCertificate(
        db,
        vault,
        pfxInput({
          parsed: parsed({
            validFrom: '2027-06-01T00:00:00.000Z',
            validTo: '2030-06-01T00:00:00.000Z',
          }),
        }),
      )
      // O consentimento herdado é o MESMO registrado no vínculo anterior —
      // a data não é recriada.
      const inheritedRow = db
        .select({ consentAt: certificateClients.consentAt })
        .from(certificateClients)
        .where(eq(certificateClients.certificateId, renewed.row.id))
        .get()
      expect(inheritedRow?.consentAt).toBe(original?.consentAt)
      expect(before.row.id).not.toBe(renewed.row.id)
    } finally {
      close()
    }
  })
})
