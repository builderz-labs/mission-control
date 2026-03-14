import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { VirtualOfficePanel } from '@/components/panels/virtual-office-panel'
import { TopologyPanel } from '@/components/panels/topology-panel'

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
            
            {/* Dynamic Content Panel */}
            <div className="flex-1 bg-background/50 relative overflow-hidden flex flex-col min-h-0">
              <div className="absolute inset-0 overflow-y-auto">
                {activeTab === 'dashboard' ? children :
                 activeTab === 'topology' ? <TopologyPanel /> :
                 activeTab === 'agents' ? <AgentsPanel /> :
                 activeTab === 'tasks' ? <TasksPanel /> :
                 activeTab === 'logs' ? <LogsPanel /> :
                 activeTab === 'audit' ? <AuditPanel /> :
                 activeTab === 'tokens' ? <TokensPanel /> :
                 activeTab === 'sessions' ? <SessionsPanel /> :
                 activeTab === 'history' ? <HistoryPanel /> :
                 activeTab === 'memory' ? <MemoryPanel /> :
                 activeTab === 'virtual-office' ? <VirtualOfficePanel /> :
                 <div className="p-8 text-center text-muted-foreground">Panel construction in progress</div>}
              </div>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
