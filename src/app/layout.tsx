import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers'
import { APP_DISPLAY_NAME } from '@shared/constants'

export const metadata: Metadata = {
  title: APP_DISPLAY_NAME,
  description: 'Cofre de acessos e sessões isoladas para portais públicos brasileiros',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
