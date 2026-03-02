import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { Agentation } from 'agentation'
import './globals.css'

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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="h-screen overflow-hidden bg-background text-foreground">
            {children}
            {process.env.NODE_ENV === 'development' && <Agentation />}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
