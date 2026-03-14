import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'OpenClaw Agent Orchestration Dashboard',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mission Control',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${outfit.variable} ${jetbrains.variable}`}>
      <body className="antialiased selection:bg-primary/30 selection:text-primary-foreground" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="relative h-screen overflow-hidden bg-background text-foreground">
            {/* Tactical Grain Filter */}
            <div className="pointer-events-none fixed inset-0 z-50 opacity-[0.03] mix-blend-overlay brightness-100 contrast-150 grayscale noise-bg"></div>

            {/* Ambient Background Glows */}
            <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full pointer-events-none"></div>
            <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full pointer-events-none"></div>

            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
