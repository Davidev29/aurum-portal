import { describe, expect, it } from 'vitest'
import { createDatabase } from '../../electron/main/db/database'
import { createClient, getClient, findClientByDocument, setClientStatus } from '../../electron/main/db/repositories/clients'
import { certificates, certificateClients } from '../../electron/main/db/schema'
import {
  applyCompanyDataToClient,
  fetchCompanyByCnpj,
  isPlaceholderClientName,
  refreshAllClientsFromBrasilApi,
} from '../../electron/main/clients/enrichment'
import { CertificateService } from '../../electron/main/certificates/service'
import type { CompanyLookupFn } from '../../electron/main/clients/enrichment'
import type { WindowsCertificateRecord } from '../../electron/main/certificates/windows-store'
import type { VaultService } from '../../electron/main/vault/service'

const CNPJ_OK = '11222333000181'
const CNPJ_HISTORICO = '22233344472000'
const CNPJ_INDISPONIVEL = '33355566678060'
const CPF_OK = '52998224725'

function stubLookup(mapping: Record<string, { name: string; email?: string | null; phone?: string | null } | null>) {
  return async (cnpj: string) => {
    const found = mapping[`${cnpj}`]
    if (!found) return null
    return {
      name: found.name,
      tradeName: null,
      email: found.email ?? null,
      phone: found.phone ?? null,
    }
  }
}

describe('enriquecimento Brasil API — apenas CNPJ', () => {
  it('fetchCompanyByCnpj chama a API apenas com 14 dígitos e rejeita CPF', async () => {
    const calls: string[] = []
    const lookup = async (cnpj: string) => {
      calls.push(cnpj)
      return { name: 'EMPRESA LTDA', tradeName: null, email: null, phone: null }
    }
    expect(await fetchCompanyByCnpj(CNPJ_OK, lookup)).toMatchObject({ name: 'EMPRESA LTDA' })
    expect(calls).toEqual([CNPJ_OK])
    expect(await fetchCompanyByCnpj(CPF_OK, lookup)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('isPlaceholderClientName detecta nomes gerados automaticamente', () => {
    expect(isPlaceholderClientName(`Cliente ${CNPJ_OK}`, CNPJ_OK)).toBe(true)
    expect(isPlaceholderClientName('Cliente importado do certificado', CNPJ_OK)).toBe(true)
    expect(isPlaceholderClientName('Titular', CNPJ_OK)).toBe(true)
    expect(isPlaceholderClientName('Titular sem nome', CNPJ_OK)).toBe(true)
    expect(isPlaceholderClientName('Empresa Nome Real LTDA', CNPJ_OK)).toBe(false)
    expect(isPlaceholderClientName('', CNPJ_OK)).toBe(true)
  })

  it('applyCompanyDataToClient altera apenas nome/e-mail/telefone', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, {
        type: 'PJ',
        name: `Cliente ${CNPJ_OK}`,
        document: CNPJ_OK,
        email: null,
        phone: null,
        consent: true,
      })
      const { adjusted, changed } = (() => {
        const result = applyCompanyDataToClient(db, client, {
          name: 'OFICIAL LTDA',
          tradeName: 'Oficial',
          email: 'a@b.com.br',
          phone: '11999999999',
        })
        return { adjusted: result.client, changed: result.changed }
      })()
      expect(changed).toBe(true)
      expect(adjusted.name).toBe('OFICIAL LTDA')
      expect(adjusted.email).toBe('a@b.com.br')
      expect(adjusted.phone).toBe('11999999999')
      // Apenas cadastro: documento, status e tags intactos.
      expect(adjusted.document).toBe(CNPJ_OK)
      expect(adjusted.status).toBe('active')
      // Sem dados novos, não muda.
      const again = applyCompanyDataToClient(db, adjusted, {
        name: 'OFICIAL LTDA',
        tradeName: null,
        email: 'a@b.com.br',
        phone: '11999999999',
      })
      expect(again.changed).toBe(false)
    } finally {
      close()
    }
  })

  it('refreshAll atualiza todos os PJ, ignora PF e tolera indisponível', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const pjOk = createClient(db, { type: 'PJ', name: `Cliente ${CNPJ_OK}`, document: CNPJ_OK, consent: true })
      const pjHist = createClient(db, { type: 'PJ', name: 'Nome Antigo', document: CNPJ_HISTORICO, consent: true })
      const pjDown = createClient(db, { type: 'PJ', name: 'Sem Resposta', document: CNPJ_INDISPONIVEL, consent: true })
      const pf = createClient(db, { type: 'PF', name: 'Fulano', document: CPF_OK, consent: true })
      const lookup = stubLookup({
        [CNPJ_OK]: { name: 'ACME LTDA', email: 'contato@acme.com.br', phone: '1133334444' },
        [CNPJ_HISTORICO]: { name: 'HISTORICA LTDA' },
      })
      const report = await refreshAllClientsFromBrasilApi(db, { lookup })
      expect(report.total).toBe(4)
      expect(report.updated).toBe(2)
      expect(report.skipped).toBe(1)
      expect(report.errors).toBe(1)
      expect(getClient(db, pjOk.id)?.name).toBe('ACME LTDA')
      expect(getClient(db, pjOk.id)?.email).toBe('contato@acme.com.br')
      expect(getClient(db, pjHist.id)?.name).toBe('HISTORICA LTDA')
      expect(getClient(db, pjDown.id)?.name).toBe('Sem Resposta')
      expect(getClient(db, pf.id)?.name).toBe('Fulano')
      expect(report.items.find((item) => item.clientId === pf.id)?.status).toBe('skipped')
      expect(report.items.find((item) => item.clientId === pjDown.id)?.status).toBe('error')
    } finally {
      close()
    }
  })

  it('refreshAll atualiza o nome do CPF a partir do certificado digital vinculado', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const pf = createClient(db, {
        type: 'PF',
        name: `Cliente ${CPF_OK}`,
        document: CPF_OK,
        consent: true,
      })
      // Insere um certificado vinculado ao cliente PF com nome real do titular.
      const certId = 'cert-cpf-' + CPF_OK
      db.insert(certificates)
        .values({
          id: certId,
          clientId: pf.id,
          label: 'Certificado PF',
          holderName: 'MARIA DA SILVA SOUZA',
          document: CPF_OK,
          documentType: 'CPF',
          subjectDn: 'CN=MARIA DA SILVA SOUZA',
          issuerDn: 'CN=AC',
          serialHex: certId.toUpperCase(),
          thumbprintSha1: 'A'.repeat(40),
          thumbprintSha256: 'B'.repeat(64),
          validFrom: '2025-01-01T00:00:00.000Z',
          validTo: '2027-01-01T00:00:00.000Z',
          source: 'pfx',
          installed: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        })
        .run()
      db.insert(certificateClients)
        .values({ certificateId: certId, clientId: pf.id, createdAt: '2025-01-01T00:00:00.000Z' })
        .run()

      const report = await refreshAllClientsFromBrasilApi(db, { lookup: stubLookup({}) })
      expect(report.total).toBe(1)
      expect(report.updated).toBe(1)
      expect(report.skipped).toBe(0)
      expect(report.errors).toBe(0)
      expect(getClient(db, pf.id)?.name).toBe('MARIA DA SILVA SOUZA')
      const item = report.items.find((i) => i.clientId === pf.id)
      expect(item?.status).toBe('updated')
      expect(item?.message).toBe('MARIA DA SILVA SOUZA')
    } finally {
      close()
    }
  })

  it('refreshAll CPF sem certificado vinculado fica como skipped', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const pf = createClient(db, {
        type: 'PF',
        name: 'Fulano',
        document: CPF_OK,
        consent: true,
      })
      const report = await refreshAllClientsFromBrasilApi(db, { lookup: stubLookup({}) })
      expect(report.total).toBe(1)
      expect(report.updated).toBe(0)
      expect(report.skipped).toBe(1)
      expect(report.errors).toBe(0)
      expect(getClient(db, pf.id)?.name).toBe('Fulano')
      const item = report.items.find((i) => i.clientId === pf.id)
      expect(item?.status).toBe('skipped')
      expect(item?.message).toContain('Sem certificado vinculado')
    } finally {
      close()
    }
  })

  it('refreshAll CPF com nome já igual ao certificado fica como skipped', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const pf = createClient(db, {
        type: 'PF',
        name: 'MARIA DA SILVA SOUZA',
        document: CPF_OK,
        consent: true,
      })
      const certId = 'cert-cpf-2-' + CPF_OK
      db.insert(certificates)
        .values({
          id: certId,
          clientId: pf.id,
          label: 'Certificado PF',
          holderName: 'MARIA DA SILVA SOUZA',
          document: CPF_OK,
          documentType: 'CPF',
          subjectDn: 'CN=MARIA DA SILVA SOUZA',
          issuerDn: 'CN=AC',
          serialHex: certId.toUpperCase(),
          thumbprintSha1: 'C'.repeat(40),
          thumbprintSha256: 'D'.repeat(64),
          validFrom: '2025-01-01T00:00:00.000Z',
          validTo: '2028-01-01T00:00:00.000Z',
          source: 'pfx',
          installed: true,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        })
        .run()
      db.insert(certificateClients)
        .values({ certificateId: certId, clientId: pf.id, createdAt: '2025-01-01T00:00:00.000Z' })
        .run()

      const report = await refreshAllClientsFromBrasilApi(db, { lookup: stubLookup({}) })
      expect(report.updated).toBe(0)
      expect(report.skipped).toBe(1)
      expect(getClient(db, pf.id)?.name).toBe('MARIA DA SILVA SOUZA')
    } finally {
      close()
    }
  })

  it('refreshAll emite progresso com processados e restantes até o fim', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      createClient(db, { type: 'PJ', name: `Cliente ${CNPJ_OK}`, document: CNPJ_OK, consent: true })
      createClient(db, { type: 'PF', name: 'Fulano', document: CPF_OK, consent: true })
      createClient(db, { type: 'PJ', name: 'Sem Resposta', document: CNPJ_INDISPONIVEL, consent: true })
      const events: Array<{
        total: number
        completed: number
        remaining: number
        updated: number
        skipped: number
        errors: number
        stage: string
      }> = []
      const lookup = stubLookup({ [CNPJ_OK]: { name: 'ACME LTDA' } })
      const report = await refreshAllClientsFromBrasilApi(db, {
        lookup,
        onProgress: (progress) => events.push({ ...progress }),
      })
      expect(report.total).toBe(3)
      // starting + 3 itens + done
      expect(events).toHaveLength(5)
      expect(events[0]).toMatchObject({ total: 3, completed: 0, remaining: 3, stage: 'starting' })
      expect(events.at(-1)).toMatchObject({ total: 3, completed: 3, remaining: 0, stage: 'done' })
      for (const event of events) {
        expect(event.completed + event.remaining).toBe(event.total)
        expect(event.updated + event.skipped + event.errors).toBe(event.completed === 0 && event.stage === 'starting' ? 0 : event.completed)
      }
      const completedSequence = events.map((event) => event.completed)
      expect(completedSequence).toEqual([0, 1, 2, 3, 3])
    } finally {
      close()
    }
  })

  it('refreshAll de lista vazia emite starting/done com total 0 sem quebrar a UI', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const events: Array<{ total: number; completed: number; remaining: number }> = []
      const report = await refreshAllClientsFromBrasilApi(db, {
        lookup: stubLookup({}),
        onProgress: (progress) => events.push({ ...progress }),
      })
      expect(report.total).toBe(0)
      expect(events).toHaveLength(2)
      expect(events[0]).toMatchObject({ total: 0, completed: 0, remaining: 0 })
      expect(events.at(-1)).toMatchObject({ total: 0, completed: 0, remaining: 0 })
    } finally {
      close()
    }
  })

  it('refreshAll de arquivado atualiza cadastro sem reativar', async () => {
    const { db, close } = createDatabase(':memory:')
    try {
      const client = createClient(db, { type: 'PJ', name: 'Velho', document: CNPJ_OK, consent: true })
      const archived = setClientStatus(db, client.id, 'archived')
      expect(archived.status).toBe('archived')
      const lookup = stubLookup({ [CNPJ_OK]: { name: 'ACME ARQUIVO LTDA' } })
      const report = await refreshAllClientsFromBrasilApi(db, { lookup })
      expect(report.updated).toBe(1)
      const current = getClient(db, client.id)
      expect(current?.name).toBe('ACME ARQUIVO LTDA')
      expect(current?.status).toBe('archived')
    } finally {
      close()
    }
  })
})

function windowsRecord(overrides: Partial<WindowsCertificateRecord> = {}): WindowsCertificateRecord {
  return {
    thumbprintSha1: overrides.thumbprintSha1 ?? 'A'.repeat(40),
    thumbprintSha256: overrides.thumbprintSha256 ?? 'B'.repeat(64),
    subject: 'CN=IGNORADO:11222333000181, O=ICP-Brasil',
    issuer: 'CN=AC Teste, O=ICP-Brasil',
    holderName: overrides.holderName ?? 'IGNORADO',
    document: overrides.document ?? CNPJ_OK,
    documentType: 'CNPJ',
    notBefore: '2025-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    serialNumber: '01AC',
    hasPrivateKey: true,
    ...overrides,
  }
}

function makeService(records: WindowsCertificateRecord[], lookup: CompanyLookupFn) {
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
    lookupCompany: lookup,
  })
  return { db, close, service }
}

describe('importação de certificado — cadastro completo via Brasil API', () => {
  it('novo cliente recebe razão social/e-mail/telefone, usando apenas o CNPJ', async () => {
    const calls: Array<{ cnpj: string; enabled: boolean }> = []
    const { db, close, service } = makeService(
      [windowsRecord({ holderName: 'Nome Errado Do Certificado' })],
      async (cnpj, options) => {
        calls.push({ cnpj, enabled: options.enabled })
        return { name: 'OFICIAL DO CNPJ LTDA', tradeName: 'Oficial', email: 'oficial@empresa.com.br', phone: '1130000000' }
      },
    )
    try {
      const result = await service.importFromWindows({ importAll: true, consent: true })
      expect(result.imported).toBe(1)
      expect(calls).toEqual([{ cnpj: CNPJ_OK, enabled: true }])
      const client = findClientByDocument(db, CNPJ_OK)
      expect(client?.name).toBe('OFICIAL DO CNPJ LTDA')
      expect(client?.email).toBe('oficial@empresa.com.br')
      expect(client?.phone).toBe('1130000000')
      expect(client?.type).toBe('PJ')
      // Certificado mantém o nome do titular; o cadastro usa a razão social.
      expect(result.certificates[0]?.holderName).toBe('Nome Errado Do Certificado')
    } finally {
      close()
    }
  })

  it('Brasil API indisponível usa fallback do certificado sem travar a importação', async () => {
    const { db, close, service } = makeService(
      [windowsRecord({ holderName: 'Nome Do Certificado' })],
      async () => null,
    )
    try {
      const result = await service.importFromWindows({ importAll: true, consent: true })
      expect(result.imported).toBe(1)
      expect(findClientByDocument(db, CNPJ_OK)?.name).toBe('Nome Do Certificado')
    } finally {
      close()
    }
  })

  it('cliente existente com nome incorreto é corrigido na importação', async () => {
    const { db, close, service } = makeService(
      [windowsRecord({ holderName: 'Outro Nome' })],
      stubLookup({ [CNPJ_OK]: { name: 'RAZAO CORRETA LTDA' } }),
    )
    try {
      createClient(db, { type: 'PJ', name: 'Nome Errado', document: CNPJ_OK, consent: true })
      const result = await service.importFromWindows({ importAll: true, consent: true })
      expect(result.imported).toBe(1)
      expect(findClientByDocument(db, CNPJ_OK)?.name).toBe('RAZAO CORRETA LTDA')
    } finally {
      close()
    }
  })

  it('sem consentimento não consulta a API nem cria cliente', async () => {
    let calls = 0
    const { db, close, service } = makeService([windowsRecord()], async () => {
      calls += 1
      return { name: 'NAO DEVE USAR', tradeName: null, email: null, phone: null }
    })
    try {
      await service.importFromWindows({ importAll: true, consent: false })
      expect(calls).toBe(0)
      expect(findClientByDocument(db, CNPJ_OK)).toBeNull()
    } finally {
      close()
    }
  })

  it('CPF não consulta a Brasil API', async () => {
    let calls = 0
    const { db, close, service } = makeService(
      [windowsRecord({ document: CPF_OK, documentType: 'CPF', holderName: 'Fulano Silva' })],
      async () => {
        calls += 1
        return null
      },
    )
    try {
      await service.importFromWindows({ importAll: true, consent: true })
      expect(calls).toBe(0)
      const client = findClientByDocument(db, CPF_OK)
      expect(client?.name).toBe('Fulano Silva')
      expect(client?.type).toBe('PF')
    } finally {
      close()
    }
  })
})
