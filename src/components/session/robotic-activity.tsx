'use client'

import { Bot } from 'lucide-react'
import './boot-loader.css'

/**
 * Faixa fina animada exibida no cabeçalho enquanto a automação está rodando.
 * O WebContentsView nativo cobre a área do portal, então qualquer animação no
 * conteúdo da página fica invisível neste modo; a moldura do app (header) é
 * onde a atividade do robô precisa viver.
 */
export function RoboticActivity({ label }: { label?: string }): React.JSX.Element {
  const text = label ?? 'Acessando portal'
  return (
    <div
      role="status"
      className="flex h-7 shrink-0 items-center justify-center gap-2.5 border-b border-[var(--pv-accent-soft-border)] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--pv-accent-solid)_6%,transparent)_0%,color-mix(in_srgb,var(--pv-accent-solid)_16%,transparent)_50%,color-mix(in_srgb,var(--pv-accent-solid)_6%,transparent)_100%)] px-3"
    >
      <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--pv-accent)]" aria-hidden="true" />
      <span className="pv-line-label text-[10px] font-semibold text-[var(--pv-accent)]">
        {text}
      </span>
      <span className="pv-shimmer-track h-[2px] w-36 overflow-hidden rounded-full">
        <span className="pv-shimmer-bar block h-full w-full" />
      </span>
    </div>
  )
}
