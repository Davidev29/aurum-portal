'use client'

import * as React from 'react'
import type { Client } from '@shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ClientForm } from '@/components/clients/client-form'

/**
 * Dialog de cadastro/edicao usado na lista de clientes. Na tela de detalhe
 * o mesmo formulario aparece inline (client-form), conforme a tela de edicao.
 */
export function ClientFormDialog({
  open,
  onOpenChange,
  client,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client?: Client | null
  onSaved?: (client: Client) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{client ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
          <DialogDescription>
            Cadastre o titular dos certificados e credenciais. O documento e validado localmente.
          </DialogDescription>
        </DialogHeader>
        <ClientForm
          variant="dialog"
          client={client}
          onSaved={(saved) => {
            onSaved?.(saved)
            onOpenChange(false)
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
