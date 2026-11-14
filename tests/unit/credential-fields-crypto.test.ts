import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { createDatabase } from '../../electron/main/db/database'
import {
  createCredential,
  listCredentials,
  revealCredential,
  updateCredential,
} from '../../electron/main/db/repositories/credentials'
import { VaultService } from '../../electron/main/vault/service'
import { clients, credentials, services } from '../../electron/main/db/schema'

const gateway = 7
const serviceId = 'svc-fields-crypto'

function seed(db: ReturnType<typeof createDatabase>['db']) {
  const now = new Date().toISOString()
  db.insert(clients)
    .values({
      id: 'c1',
      type: 'PJ',
      name: 'Cliente Teste',
      document: '12345678000199',
      email: null,
      phone: null,
      notes: null,
      status: 'active',
      tags: [],
      consentAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  db.insert(services)
    .values({
      id: serviceId,
      slug: 'portal-fields',
      name: 'Portal Fields',
      category: 'Outros',
      baseUrl: 'https://portal.fields.example/',
      allowedDomains: ['portal.fields.example'],
      authMethods: ['password'],
      defaultAuth: 'password',
      notes: null,
      isBuiltin: false,
      enabled: true,
      favorite: false,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

const input = (
  fields: Array<{ name: string; kind: 'username' | 'password' | 'text'; value?: string }>,
) => ({
  clientId: 'c1',
  serviceId,
  label: 'Principal',
  username: 'u',
  usernameType: 'cpf' as const,
  password: 'p@ssw0rd!',
  fields,
})

describe('credential fields — cifragem AAD e preservação', () => {
  it('valores são cifrados no banco, nunca plaintext', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      seed(db)
      const vault = new VaultService(Buffer.alloc(32, gateway))
      const created = createCredential(
        db,
        vault,
        input([{ name: 'f_codigo_empresa', kind: 'text', value: 'CODIGO-123' }]),
      )
      const row = db.select().from(credentials).get()!
      expect(JSON.stringify(row.fields)).not.toContain('CODIGO-123')
      expect(row.fields?.[0]?.enc).toBe('aes-256-gcm')

      // Renderer nunca recebe valores — nem cifrados:
      const view = listCredentials(db, {})
      expect(JSON.stringify(view)).not.toContain('CODIGO-123')

      // Replay resolve em memória:
      const revealed = revealCredential(db, vault, created.id)
      expect(revealed.extraValues['f_codigo_empresa']).toBe('CODIGO-123')
      expect(revealed.password).toBe('p@ssw0rd!')
      // Agente/gestor recebe o mapa legenda→papel (sem valores):
      expect(revealed.fieldSpecs).toEqual([{ name: 'f_codigo_empresa', kind: 'text' }])
    } finally {
      close()
    }
  })

  it('edição com campo vazio preserva o valor cifrado anterior', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      seed(db)
      const vault = new VaultService(Buffer.alloc(32, gateway))
      const created = createCredential(
        db,
        vault,
        input([{ name: 'f_inscricao', kind: 'text', value: 'IE-998877' }]),
      )
      // Edita sem reenviar o valor (UI não lê plaintext):
      updateCredential(db, vault, created.id, {
        fields: [{ name: 'f_inscricao', kind: 'text' }],
      })
      const revealed = revealCredential(db, vault, created.id)
      expect(revealed.extraValues['f_inscricao']).toBe('IE-998877')
    } finally {
      close()
    }
  })

  it('edição com novo valor rotaciona o envelope e não vaza o antigo', () => {
    const { db, close } = createDatabase(':memory:')
    try {
      seed(db)
      const vault = new VaultService(Buffer.alloc(32, gateway))
      const created = createCredential(
        db,
        vault,
        input([{ name: 'f_cnh', kind: 'text', value: '111222333' }]),
      )
      updateCredential(db, vault, created.id, {
        fields: [{ name: 'f_cnh', kind: 'text', value: '444555666' }],
      })
      const revealed = revealCredential(db, vault, created.id)
      expect(revealed.extraValues['f_cnh']).toBe('444555666')
      expect(JSON.stringify(db.select().from(credentials).get())).not.toContain('111222333')
    } finally {
      close()
    }
  })
})
