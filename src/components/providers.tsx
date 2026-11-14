'use client'

import * as React from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { aurumBitPortal } from '@/lib/api'
import { APP_DISPLAY_NAME } from '@shared/constants'
import type { ImportProgressEvent } from '@shared/types'
import { useSettings } from '@/lib/queries'

// Antes da pintura no cliente (evita o "flash" de tema errado no 1º frame);
// useEffect no SSR (Next hidrata client components também no servidor).
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect

// View Transitions API (Chromium ≥111 / Electron): dissolução cross-fade da
// janela inteira na troca de tema. Sem suporte → troca instantânea (fallback).
type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void> }
}

function ThemeSync({ children }: { children: React.ReactNode }) {
  const { data } = useSettings()
  const theme = data?.theme ?? 'system'
  const firstRun = React.useRef(true)

  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      const first = firstRun.current
      firstRun.current = false
      // Sem mudança efetiva (refetch com a mesma classe) → nunca anima.
      if (root.classList.contains('dark') === dark) return

      // Montagem, reduced-motion ou sem suporte → troca seca (comportamento atual).
      if (
        first ||
        reducedMotion.matches ||
        !(document as DocumentWithViewTransition).startViewTransition
      ) {
        root.classList.toggle('dark', dark)
        return
      }

      // Troca de tema de fato: a janela dissolve (ver ::view-transition-* no globals.css).
      ;(document as DocumentWithViewTransition).startViewTransition(() => {
        root.classList.toggle('dark', dark)
      })
    }

    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  return <>{children}</>
}

function EventBridge() {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    const api = aurumBitPortal()
    const unsubscribers = [
      api.events.onSessionsChanged((sessions) => {
        queryClient.setQueryData(['sessions'], sessions)
        // Atualiza as telas de sessao (/session/:id) imediatamente — inclusive o
        // momento da revelacao do portal quando a autenticacao chega.
        void queryClient.invalidateQueries({ queryKey: ['session'] })
        void queryClient.invalidateQueries({ queryKey: ['services'] })
      }),
      api.events.onCertificatesChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['certificates'] })
        void queryClient.invalidateQueries({ queryKey: ['certificateStats'] })
        void queryClient.invalidateQueries({ queryKey: ['audit'] })
      }),
      api.events.onClientsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['clients'] })
        void queryClient.invalidateQueries({ queryKey: ['audit'] })
      }),
      api.events.onCredentialsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['credentials'] })
        void queryClient.invalidateQueries({ queryKey: ['audit'] })
      }),
      api.events.onObligationsChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['obligations'] })
        void queryClient.invalidateQueries({ queryKey: ['audit'] })
      }),
      api.events.onNotificationsChanged((payload) => {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        void queryClient.invalidateQueries({ queryKey: ['audit'] })
        if (payload?.created && payload.created > 0) {
          toast.info(
            payload.created === 1
              ? '1 obrigação a vencer foi adicionada à central de avisos.'
              : `${payload.created} obrigações a vencer foram adicionadas à central de avisos.`,
          )
        }
      }),
      api.events.onServicesChanged(() => {
        void queryClient.invalidateQueries({ queryKey: ['services'] })
      }),
      api.events.onImportProgress((progress: ImportProgressEvent) => {
        if (progress.stage === 'done') {
          toast.success(
            `Importação concluída: ${progress.success} sucesso(s), ${progress.duplicates} duplicado(s), ${progress.errors} erro(s).`,
          )
        }
      }),
      api.events.onDownloadProgress((progress) => {
        if (progress.state === 'completed') {
          toast.success(`Download concluído: ${progress.filename}`, {
            description: progress.savePath ?? undefined,
          })
        } else if (progress.state === 'cancelled') {
          toast.error(`Download bloqueado: ${progress.filename}`, {
            description: `Arquivos executáveis e scripts não são baixados pelo ${APP_DISPLAY_NAME}.`,
          })
        } else if (progress.state === 'interrupted') {
          toast.error(`Download interrompido: ${progress.filename}`)
        }
      }),
      api.events.onSessionError((event) => {
        toast.warning(event.message, { description: 'A sessão pode exigir atenção manual.' })
        void queryClient.invalidateQueries({ queryKey: ['session'] })
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      }),
      api.events.onAppLocked((locked) => {
        if (locked) toast.info('Sessões encerradas. O aplicativo foi bloqueado.')
      }),
      api.events.onUpdateStatus((result) => {
        if (result.status === 'available') toast.info(result.message)
      }),
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [queryClient])

  return null
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
          mutations: { retry: 0 },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync>
        <EventBridge />
        {children}
        <Toaster position="bottom-right" richColors={false} closeButton theme={undefined} />
      </ThemeSync>
    </QueryClientProvider>
  )
}
