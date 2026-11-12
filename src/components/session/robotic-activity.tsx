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
      className="flex h-7 shrink-0 items-center justify-center gap-2.5 border-b border-emerald-700/25 bg-[linear-gradient(90deg,rgba(16,185,129,0.06)_0%,rgba(16,185,129,0.14)_50%,rgba(16,185,129,0.06)_100%)] px-3"
    >
      <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
      <span className="pv-line-label text-[10px] font-semibold text-emerald-300/90">
        {text}
      </span>
      <span className="pv-shimmer-track h-[2px] w-36 overflow-hidden rounded-full">
        <span className="pv-shimmer-bar block h-full w-full" />
      </span>
    </div>
  )
}
