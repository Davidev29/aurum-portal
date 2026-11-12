'use client'

import * as React from 'react'
import './boot-loader.css'

/**
 * Tela de boot da sessão — cena única para TODAS as autenticações.
 * O portal é ocultado enquanto a automação roda (senha ou certificado) e,
 * ao concluir, é revelado de forma atômica. A única diferença entre sites é
 * o nome exibido ("Acessando {portal}…").
 */
export function BootLoader({ title }: { title?: string }): React.JSX.Element {
  const label = title ?? 'Acessando portal'
  return (
    <div className="runtime-backdrop" aria-hidden="true">
      <div className="runtime-grid" />
      <div className="runtime-aurora runtime-aurora-a" />
      <div className="runtime-aurora runtime-aurora-b" />

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-7 px-6">
        <svg
          viewBox="0 0 200 200"
          className="h-auto w-full max-w-[150px] md:max-w-[170px]"
          role="img"
          aria-label="Autenticando"
        >
          <defs>
            <radialGradient id="spinnerCore" cx="50%" cy="42%" r="62%">
              <stop offset="0%" stopColor="#828fff" stopOpacity="0.9" />
              <stop offset="55%" stopColor="#5e6ad2" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#5e6ad2" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="arcBright" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#c7c8ff" />
              <stop offset="55%" stopColor="#828fff" />
              <stop offset="100%" stopColor="#232552" />
            </linearGradient>
            <linearGradient id="arcFaint" x1="1" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#828fff" />
              <stop offset="50%" stopColor="#5e6ad2" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#5e6ad2" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* halo pulsante de fundo */}
          <circle className="spinner-core" cx="100" cy="100" r="46" fill="url(#spinnerCore)" />

          {/* spinner externo — tracejado, sentido horário, lento */}
          <g className="spinner-outer">
            <circle
              cx="100"
              cy="100"
              r="74"
              fill="none"
              stroke="#5e6ad2"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray="14 22"
              strokeOpacity="0.35"
            />
            <circle
              cx="100"
              cy="100"
              r="74"
              fill="none"
              stroke="#a5adff"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray="14 446"
              strokeDashoffset="-32"
              strokeOpacity="0.95"
            />
          </g>

          {/* spinner interno — arco brilhante, anti-horário, rápido */}
          <g className="spinner-inner">
            <circle
              cx="100"
              cy="100"
              r="42"
              fill="none"
              stroke="url(#arcFaint)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="70 194"
              strokeOpacity="0.9"
            />
            <circle
              cx="100"
              cy="100"
              r="42"
              fill="none"
              stroke="url(#arcBright)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray="46 218"
              strokeDashoffset="-108"
              strokeOpacity="1"
            />
          </g>

          {/* núcleo */}
          <circle cx="100" cy="100" r="10.5" fill="#c7c8ff" opacity="0.95" />
          <circle cx="100" cy="100" r="5" fill="#f2f2ff" />
        </svg>

        <div className="flex flex-col items-center gap-3">
          <p className="pv-line-label text-[11px] font-semibold text-indigo-100/90 md:text-[13px]">
            {label}
            <span className="pv-dot">.</span>
            <span className="pv-dot pv-dot-2">.</span>
            <span className="pv-dot pv-dot-3">.</span>
          </p>
          <div className="pv-shimmer-track h-[2.5px] w-56 overflow-hidden rounded-full">
            <div className="pv-shimmer-bar h-full w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
