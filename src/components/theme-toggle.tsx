'use client'

import * as React from 'react'
import { Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { aurumBitPortal, errorMessage } from '@/lib/api'
import { useSettings, useInvalidate } from '@/lib/queries'

/**
 * Toggle claro/escuro ao lado do sininho no header.
 *
 * Binário (claro ↔ escuro): grava o tema explícito em Configurações →Tema
 * (mesmo canal do select da página de Aparência) e invalida o cache, então o
 * ThemeSync aplica a classe `.dark` imediatamente. O modo "Seguir o Windows"
 * continua disponível apenas na página de Configurações — ao alternar por
 * aqui, o tema deixa de seguir o sistema (decisão consciente do toggle).
 *
 * O ícone mostra a ação (lua = ativar escuro, sol = ativar claro); o estado
 * atual é comunicado pelo `title`/`aria-label` e pelo próprio tema aplicado.
 */
export function ThemeToggle() {
  const { data: settings, isLoading } = useSettings()
  const invalidate = useInvalidate()
  const [saving, setSaving] = React.useState(false)

  // Resolução igual à do ThemeSync (providers.tsx): explícito ganha; senão, o SO.
  const [systemDark, setSystemDark] = React.useState(false)
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setSystemDark(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  const isDark = (settings?.theme ?? 'system') === 'dark' || ((settings?.theme ?? 'system') === 'system' && systemDark)

  const toggle = async () => {
    if (!settings || saving) return
    setSaving(true)
    const next = isDark ? 'light' : 'dark'
    try {
      await aurumBitPortal().settings.set({ ...settings, theme: next })
      await invalidate.settings()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const label = isDark ? 'Ativar modo claro' : 'Ativar modo escuro'

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={isLoading || !settings || saving}
      aria-label={label}
      title={label}
      className="pv-icon-btn flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--pv-border)] bg-[var(--pv-panel-2)] text-[var(--pv-muted)] transition-colors hover:text-[var(--pv-text)] focus-visible:ring-2 focus-visible:ring-brand-600/30 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  )
}
