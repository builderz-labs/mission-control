import Link from 'next/link'
import type { ReactNode } from 'react'

const sections = [
  { href: '/atlas', label: 'Overview', code: '00' },
  { href: '/atlas/system', label: 'Full system', code: '01' },
  { href: '/atlas/execution', label: 'Execution flow', code: '02' },
  { href: '/atlas/memory', label: 'Memory + data', code: '03' },
  { href: '/atlas/org', label: 'Agent org chart', code: '04' },
  { href: '/atlas/mcp', label: 'MCP architecture', code: '05' },
  { href: '/atlas/runtime', label: 'Runtime + models', code: '06' },
  { href: '/atlas/compute', label: 'Compute + accounts', code: '07' },
  { href: '/atlas/network', label: 'Network + security', code: '08' },
  { href: '/atlas/scale', label: 'Future scale', code: '09' },
  { href: '/atlas/ui-map', label: 'UI page map', code: '10' },
]

export default function AtlasLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="w-[260px] shrink-0 border-r border-border bg-card/40 backdrop-blur">
        <div className="px-5 py-5 border-b border-border">
          <Link href="/" className="block group">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground group-hover:text-void-cyan transition">
              ← DarkMada
            </div>
            <div className="mt-1 text-base font-semibold">System Atlas</div>
            <div className="text-xs text-muted-foreground mt-0.5">DarkMada</div>
          </Link>
        </div>
        <nav className="p-3 space-y-0.5 overflow-y-auto h-[calc(100vh-92px)]">
          {sections.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent/50 transition group"
            >
              <span className="font-mono text-[10px] text-muted-foreground/60 group-hover:text-void-cyan">{s.code}</span>
              <span className="text-foreground/80 group-hover:text-foreground">{s.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-10 space-y-10">
          {children}
        </div>
      </main>
    </div>
  )
}
