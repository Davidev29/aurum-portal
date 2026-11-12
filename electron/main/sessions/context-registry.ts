export interface SessionContext {
  sessionId: string
  clientId: string
  clientName: string
  clientDocument: string
  serviceId: string
  serviceName: string
  serviceSlug: string
  authMethod: 'certificate' | 'password'
  certificateId: string | null
  certificateLabel: string | null
  certificateHolderName?: string | null
  certificateValidTo?: string | null
  certificateThumbprintSha256: string | null
  certificateThumbprintSha1: string | null
  certificateSerialHex?: string | null
  certificateIssuerDn?: string | null
  certificateSubjectDn?: string | null
  allowedDomains: string[]
  partition: string
}

export class SessionContextRegistry {
  private readonly contexts = new WeakMap<object, SessionContext>()

  set(session: object, context: SessionContext): void {
    this.contexts.set(session, context)
  }

  get(session: object): SessionContext | undefined {
    return this.contexts.get(session)
  }

  has(session: object): boolean {
    return this.contexts.has(session)
  }

  delete(session: object): void {
    this.contexts.delete(session)
  }
}
