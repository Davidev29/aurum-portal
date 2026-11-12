'use client'

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { aurumBitPortal } from './api'
import type { ObligationFilter } from '@shared/types'

export const obligationKeys = {
  all: ['obligations'] as const,
  departments: ['obligations', 'departments'] as const,
  list: (filter?: ObligationFilter) => ['obligations', 'list', filter ?? {}] as const,
  groups: ['obligations', 'groups'] as const,
  links: ['obligations', 'links'] as const,
  linksByClient: (clientId: string) => ['obligations', 'links', 'client', clientId] as const,
  month: (month: string) => ['obligations', 'month', month] as const,
  notifications: ['notifications'] as const,
  holidays: ['obligations', 'holidays'] as const,
}

export function useDepartments() {
  return useQuery({
    queryKey: obligationKeys.departments,
    queryFn: () => aurumBitPortal().obligations.listDepartments(),
  })
}

export function useObligations(filter?: ObligationFilter) {
  return useQuery({
    queryKey: obligationKeys.list(filter),
    queryFn: () => aurumBitPortal().obligations.listObligations(filter),
  })
}

export function useObligationGroups() {
  return useQuery({
    queryKey: obligationKeys.groups,
    queryFn: () => aurumBitPortal().obligations.listGroups(),
  })
}

export function useClientObligationLinks() {
  return useQuery({
    queryKey: obligationKeys.links,
    queryFn: () => aurumBitPortal().obligations.listLinks(),
  })
}

export function useClientLinks(clientId: string | null) {
  return useQuery({
    queryKey: obligationKeys.linksByClient(clientId ?? ''),
    queryFn: () => aurumBitPortal().obligations.listLinksByClient(clientId as string),
    enabled: Boolean(clientId),
  })
}

export function useMonthOverview(month: string | null) {
  return useQuery({
    queryKey: obligationKeys.month(month ?? 'pending'),
    queryFn: () => aurumBitPortal().obligations.listMonth({ month: month as string }),
    enabled: month !== null,
    placeholderData: keepPreviousData,
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: obligationKeys.notifications,
    queryFn: () => aurumBitPortal().obligations.listNotifications(),
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function useHolidays() {
  return useQuery({
    queryKey: obligationKeys.holidays,
    queryFn: () => aurumBitPortal().obligations.listHolidays(),
    staleTime: 60_000,
  })
}

/** Invalida todo o domínio de obrigações (matriz, listas, grupos, avisos). */
export function useObligationsInvalidate() {
  const queryClient = useQueryClient()
  return {
    all: () => queryClient.invalidateQueries({ queryKey: obligationKeys.all }),
    notifications: () => queryClient.invalidateQueries({ queryKey: obligationKeys.notifications }),
    audit: () => queryClient.invalidateQueries({ queryKey: ['audit'] }),
  }
}
