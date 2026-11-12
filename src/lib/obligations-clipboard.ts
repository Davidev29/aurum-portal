'use client'

import { create } from 'zustand'

/**
 * Área de transferência em memória de sessão para os vínculos cliente ↔
 * obrigação ("Copiar vínculos" / "Colar vínculos"). Nada é persistido em
 * disco: ao fechar o aplicativo, o conteúdo é descartado — exatamente o
 * comportamento esperado de um clipboard de trabalho.
 */

export interface ObligationClipboard {
  /** Cliente de origem (apenas para exibição; a colagem não depende dele). */
  sourceClientId: string | null
  sourceClientName: string | null
  obligationIds: string[]
  copiedAt: string | null
  copy: (input: { clientId: string; clientName: string; obligationIds: string[] }) => void
  clear: () => void
}

export const useObligationClipboard = create<ObligationClipboard>((set) => ({
  sourceClientId: null,
  sourceClientName: null,
  obligationIds: [],
  copiedAt: null,
  copy: ({ clientId, clientName, obligationIds }) =>
    set({
      sourceClientId: clientId,
      sourceClientName: clientName,
      obligationIds: [...new Set(obligationIds)],
      copiedAt: new Date().toISOString(),
    }),
  clear: () =>
    set({ sourceClientId: null, sourceClientName: null, obligationIds: [], copiedAt: null }),
}))
