import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Eden',
  description: 'OpenClaw Agent Orchestration Dashboard',
  icons: {
    icon: '/favicon-32.png',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Eden',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="h-screen overflow-hidden bg-background text-foreground">
            {children}
            <footer className="fixed bottom-0 inset-x-0 text-center text-[10px] text-muted-foreground opacity-[0.08] hover:opacity-30 transition-opacity duration-500 pointer-events-auto select-none z-0 pb-1">
              Built with love by Cri &amp; friends
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
