import type { AuthMethod } from '../../../shared/constants'

export interface PartitionInput {
  clientId: string
  certificateId?: string | null
  authMethod: AuthMethod
  disposable?: boolean
}

export function sanitizePartitionSegment(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96)
  if (!sanitized) throw new Error('Identificador invalido para particao')
  return sanitized
}

export function buildPartition(input: PartitionInput): string {
  const client = sanitizePartitionSegment(input.clientId)
  const base = `client:${client}`
  let partition = base
  if (input.authMethod === 'certificate') {
    if (!input.certificateId) {
      throw new Error('Sessao por certificado exige um certificado')
    }
    partition = `${base}:cert:${sanitizePartitionSegment(input.certificateId)}`
  }
  if (input.disposable) return partition
  return `persist:${partition}`
}

export function sessionReuseKey(input: {
  clientId: string
  serviceId: string
  authMethod: AuthMethod
  certificateId?: string | null
  credentialId?: string | null
}): string {
  return [
    input.clientId,
    input.serviceId,
    input.authMethod,
    input.authMethod === 'certificate'
      ? (input.certificateId ?? 'none')
      : (input.credentialId ?? 'default'),
  ].join('|')
}

export function isPartitionForClient(partition: string, clientId: string): boolean {
  return partition.includes(`client:${sanitizePartitionSegment(clientId)}`)
}
