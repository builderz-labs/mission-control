import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { getLocale, getMessages } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { headers } from 'next/headers'
import { THEME_IDS } from '@/lib/themes'
import { ThemeBackground } from '@/components/ui/theme-background'
import { JarvisGlobal } from '@/components/voice/jarvis-global'
import './globals.css'

// RTL languages that require dir="rtl" on the html element
const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur'])

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

function resolveMetadataBase(): URL {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.MC_PUBLIC_BASE_URL,
    process.env.APP_URL,
    process.env.MISSION_CONTROL_PUBLIC_URL,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    try {
      return new URL(candidate)
    } catch {
      // Ignore invalid URL values and continue fallback chain.
    }
  }

  // Prevent localhost fallback in production metadata when env is unset.
  return new URL('https://ultron.local')
}

const metadataBase = resolveMetadataBase()

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Ultron Mission Control',
  description: 'Autonomous Agent Orchestration Dashboard — Built by Tony W. for Mantu Group',
  metadataBase,
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '256x256' },
      { url: '/brand/mantu-logo-128.png', type: 'image/png', sizes: '128x128' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icon.png'],
  },
  openGraph: {
    title: 'Ultron Mission Control',
    description: 'Autonomous Agent Orchestration Dashboard — Built by Tony W. for Mantu Group',
    images: [{ url: '/brand/mantu-logo-512.png', width: 512, height: 512, alt: 'Ultron Mission Control' }],
  },
  twitter: {
    card: 'summary',
    title: 'Ultron Mission Control',
    description: 'Autonomous Agent Orchestration Dashboard — Built by Tony W. for Mantu Group',
    images: ['/brand/mantu-logo-512.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Ultron Mission Control',
  },
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getLocale()
  const dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
  // Fetch messages server-side so NextIntlClientProvider can pass them to all
  // client components using useTranslations — without this, any 'use client'
  // panel that calls useTranslations() throws a missing-context error.
  const messages = await getMessages()
  // Read nonce injected by the proxy middleware so the FOUC-prevention inline script
  // passes the CSP nonce check — without it the script is blocked by strict-dynamic.
  const headerStore = await headers()
  const nonce = headerStore.get('x-nonce') ?? undefined

  return (
    <html lang={locale} dir={dir} className="dark" suppressHydrationWarning>
      <head>
        {/* Blocking script to set 'dark' class before first paint, preventing FOUC.
            Content is a static string literal — no user input, no XSS vector.
            nonce is required by the per-request CSP set in src/proxy.ts.
            suppressHydrationWarning: nonce is per-request so it legitimately differs
            between SSR and client hydration — this suppresses the expected mismatch. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'void';var light=['light','paper'];if(light.indexOf(t)===-1)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`} suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="void"
            themes={THEME_IDS}
            enableSystem={false}
            disableTransitionOnChange
            nonce={nonce}
          >
            <ThemeBackground />
            <div className="h-screen overflow-hidden bg-background text-foreground">
              {children}
            </div>
            <JarvisGlobal />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
