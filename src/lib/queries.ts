'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { aurumBitPortal } from './api'
import type {
  AuditFilter,
  CertificateFilter,
  ClientFilter,
  CredentialFilter,
  ServiceFilter,
} from '@shared/types'

export const queryKeys = {
  clients: (filter?: ClientFilter) => ['clients', filter ?? {}] as const,
  client: (id: string) => ['client', id] as const,
  clientNotes: (clientId: string) => ['clientNotes', clientId] as const,
  credentials: (filter?: CredentialFilter) => ['credentials', filter ?? {}] as const,
  certificates: (filter?: CertificateFilter) => ['certificates', filter ?? {}] as const,
  certificateStats: ['certificateStats'] as const,
  services: (filter?: ServiceFilter) => ['services', filter ?? {}] as const,
  sessions: ['sessions'] as const,
  settings: ['settings'] as const,
  audit: (filter?: AuditFilter) => ['audit', filter ?? {}] as const,
  appInfo: ['appInfo'] as const,
}

export function useClients(filter?: ClientFilter) {
  return useQuery({
    queryKey: queryKeys.clients(filter),
    queryFn: () => aurumBitPortal().clients.list(filter),
  })
}

export function useClient(id: string | null) {
  return useQuery({
    queryKey: queryKeys.client(id ?? ''),
    queryFn: () => aurumBitPortal().clients.get(id as string),
    enabled: Boolean(id),
  })
}

export function useClientNotes(clientId: string | null) {
  return useQuery({
    queryKey: queryKeys.clientNotes(clientId ?? ''),
    queryFn: () => aurumBitPortal().clients.listNotes(clientId as string),
    enabled: Boolean(clientId),
  })
}

export function useCredentials(filter?: CredentialFilter) {
  return useQuery({
    queryKey: queryKeys.credentials(filter),
    queryFn: () => aurumBitPortal().credentials.list(filter),
  })
}

export function useCertificates(filter?: CertificateFilter) {
  return useQuery({
    queryKey: queryKeys.certificates(filter),
    queryFn: () => aurumBitPortal().certificates.list(filter),
  })
}

export function useCertificateStats() {
  return useQuery({
    queryKey: queryKeys.certificateStats,
    queryFn: () => aurumBitPortal().certificates.stats(),
  })
}

export function useCertificateDetails(id: string | null) {
  return useQuery({
    queryKey: ['certificateDetails', id ?? ''],
    queryFn: () => aurumBitPortal().certificates.details(id as string),
    enabled: Boolean(id),
  })
}

export function useServices(filter?: ServiceFilter) {
  return useQuery({
    queryKey: queryKeys.services(filter),
    queryFn: () => aurumBitPortal().services.list(filter),
  })
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => aurumBitPortal().sessions.list(),
    refetchInterval: 15_000,
  })
}

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => aurumBitPortal().settings.get(),
    staleTime: 60_000,
  })
}

export function useAudit(filter?: AuditFilter) {
  return useQuery({
    queryKey: queryKeys.audit(filter),
    queryFn: () => aurumBitPortal().audit.list(filter),
  })
}

export function useAppInfo() {
  return useQuery({
    queryKey: queryKeys.appInfo,
    queryFn: () => aurumBitPortal().app.info(),
    staleTime: 30_000,
  })
}

export function useInvalidate() {
  const queryClient = useQueryClient()
  return {
    clients: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
    client: (id: string) => queryClient.invalidateQueries({ queryKey: ['client', id] }),
    clientNotes: (clientId: string) =>
      queryClient.invalidateQueries({ queryKey: ['clientNotes', clientId] }),
    credentials: () => queryClient.invalidateQueries({ queryKey: ['credentials'] }),
    certificates: () => queryClient.invalidateQueries({ queryKey: ['certificates'] }),
    certificateStats: () => queryClient.invalidateQueries({ queryKey: ['certificateStats'] }),
    services: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
    sessions: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    settings: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    audit: () => queryClient.invalidateQueries({ queryKey: ['audit'] }),
    appInfo: () => queryClient.invalidateQueries({ queryKey: ['appInfo'] }),
  }
}

export function useRefreshAll() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries()
}
