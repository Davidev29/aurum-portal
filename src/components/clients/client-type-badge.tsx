import * as React from 'react'
import { Building2, User } from 'lucide-react'
import type { ClientType } from '@shared/types'
import { clientTypeLabel } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

/**
 * Badge de tipo do cliente (PF/PJ) com rótulo completo, ícone e cor
 * distintos para diferenciar Pessoa Física de Pessoa Jurídica na tabela
 * e nas telas de detalhe.
 */
export function ClientTypeBadge({ type }: { type: ClientType }) {
  const isPf = type === 'PF'
  const Icon = isPf ? User : Building2
  return (
    <Badge
      variant={isPf ? 'info' : 'teal'}
      title={isPf ? 'Pessoa Física (CPF)' : 'Pessoa Jurídica (CNPJ)'}
      aria-label={isPf ? 'Tipo: Pessoa Física' : 'Tipo: Pessoa Jurídica'}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {clientTypeLabel(type)}
    </Badge>
  )
}
