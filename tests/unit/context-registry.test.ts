import { describe, expect, it } from 'vitest'
import {
  SessionContextRegistry,
  type SessionContext,
} from '../../electron/main/sessions/context-registry'

function context(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: 'session-1',
    clientId: 'client-1',
    clientName: 'Cliente Um',
    clientDocument: '52998224725',
    serviceId: 'service-1',
    serviceName: 'Portal',
    serviceSlug: 'portal',
    authMethod: 'certificate',
    certificateId: 'cert-1',
    certificateLabel: 'A1 Empresa',
    certificateHolderName: 'Empresa Exemplo',
    certificateValidTo: '2027-01-01T00:00:00.000Z',
    certificateThumbprintSha256: 'AABB',
    certificateThumbprintSha1: 'CCDD',
    allowedDomains: ['portal.gov.br'],
    partition: 'persist:client:client-1:cert:cert-1',
    ...overrides,
  }
}

describe('SessionContextRegistry', () => {
  it('associa contexto ao objeto de sessao', () => {
    const registry = new SessionContextRegistry()
    const session = {}
    expect(registry.has(session)).toBe(false)
    expect(registry.get(session)).toBeUndefined()
    const value = context()
    registry.set(session, value)
    expect(registry.has(session)).toBe(true)
    expect(registry.get(session)).toBe(value)
  })

  it('mantem contextos isolados por objeto', () => {
    const registry = new SessionContextRegistry()
    const first = {}
    const second = {}
    registry.set(first, context({ sessionId: 'a' }))
    registry.set(second, context({ sessionId: 'b', clientId: 'client-2' }))
    expect(registry.get(first)?.sessionId).toBe('a')
    expect(registry.get(second)?.clientId).toBe('client-2')
  })

  it('sobrescreve o contexto do mesmo objeto', () => {
    const registry = new SessionContextRegistry()
    const session = {}
    registry.set(session, context())
    registry.set(session, context({ clientId: 'client-2' }))
    expect(registry.get(session)?.clientId).toBe('client-2')
  })

  it('remove contexto', () => {
    const registry = new SessionContextRegistry()
    const session = {}
    registry.set(session, context())
    registry.delete(session)
    expect(registry.has(session)).toBe(false)
    expect(registry.get(session)).toBeUndefined()
    expect(() => registry.delete(session)).not.toThrow()
  })

  it('nao vaza referencias entre instancias do registro', () => {
    const first = new SessionContextRegistry()
    const second = new SessionContextRegistry()
    const session = {}
    first.set(session, context())
    expect(second.has(session)).toBe(false)
  })
})
