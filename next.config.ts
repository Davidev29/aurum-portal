import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    // Avisos de segurança do Next.js (ex.: builds limpas param na 1ª execução
    // até o upgrade) — mantém a política usada para corrigir a 16.4.4→16.4.6.
    agentUpgrade: 'security',
  },
}

export default nextConfig
