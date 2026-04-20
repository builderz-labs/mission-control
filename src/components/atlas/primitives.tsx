import type { ReactNode } from 'react'

/** Atlas diagram primitives — dark-first, themable via CSS variables. */

export function AtlasShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="space-y-6">
      <header className="space-y-1.5">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-void-cyan">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">{subtitle}</p>
      </header>
      <div className="rounded-2xl border border-border bg-card/60 p-6 backdrop-blur shadow-[0_0_0_1px_hsl(var(--void-cyan)/0.04)]">
        {children}
      </div>
    </section>
  )
}

export function Lane({ label, accent = 'cyan', children }: { label: string; accent?: 'cyan' | 'mint' | 'amber' | 'violet' | 'crimson'; children: ReactNode }) {
  const tone: Record<string, string> = {
    cyan: 'border-l-void-cyan/70 text-void-cyan',
    mint: 'border-l-void-mint/70 text-void-mint',
    amber: 'border-l-void-amber/70 text-void-amber',
    violet: 'border-l-void-violet/70 text-void-violet',
    crimson: 'border-l-void-crimson/70 text-void-crimson',
  }
  return (
    <div className={`pl-4 border-l-2 ${tone[accent]} space-y-3`}>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-80">{label}</div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  )
}

export function Node({
  title,
  subtitle,
  meta,
  accent = 'cyan',
  emphasis,
}: {
  title: string
  subtitle?: string
  meta?: string
  accent?: 'cyan' | 'mint' | 'amber' | 'violet' | 'crimson' | 'muted'
  emphasis?: boolean
}) {
  const tone: Record<string, string> = {
    cyan: 'shadow-[0_0_0_1px_hsl(var(--void-cyan)/0.25),0_0_24px_-12px_hsl(var(--void-cyan)/0.5)]',
    mint: 'shadow-[0_0_0_1px_hsl(var(--void-mint)/0.25),0_0_24px_-12px_hsl(var(--void-mint)/0.5)]',
    amber: 'shadow-[0_0_0_1px_hsl(var(--void-amber)/0.25),0_0_24px_-12px_hsl(var(--void-amber)/0.5)]',
    violet: 'shadow-[0_0_0_1px_hsl(var(--void-violet)/0.25),0_0_24px_-12px_hsl(var(--void-violet)/0.5)]',
    crimson: 'shadow-[0_0_0_1px_hsl(var(--void-crimson)/0.25),0_0_24px_-12px_hsl(var(--void-crimson)/0.5)]',
    muted: 'shadow-[0_0_0_1px_hsl(var(--border))]',
  }
  return (
    <div
      className={`rounded-lg bg-background/70 px-4 py-3 ${tone[accent]} ${
        emphasis ? 'ring-1 ring-void-cyan/30' : ''
      }`}
    >
      <div className="text-sm font-medium text-foreground">{title}</div>
      {subtitle && <div className="text-xs text-muted-foreground mt-0.5 leading-snug">{subtitle}</div>}
      {meta && <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-2">{meta}</div>}
    </div>
  )
}

export function Bus({ label, accent = 'cyan' }: { label: string; accent?: 'cyan' | 'mint' | 'amber' | 'violet' }) {
  const tone: Record<string, string> = {
    cyan: 'from-void-cyan/0 via-void-cyan/40 to-void-cyan/0',
    mint: 'from-void-mint/0 via-void-mint/40 to-void-mint/0',
    amber: 'from-void-amber/0 via-void-amber/40 to-void-amber/0',
    violet: 'from-void-violet/0 via-void-violet/40 to-void-violet/0',
  }
  return (
    <div className="relative my-4">
      <div className={`h-px bg-gradient-to-r ${tone[accent]}`} />
      <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-card px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

export function Legend({ items }: { items: { label: string; accent: 'cyan' | 'mint' | 'amber' | 'violet' | 'crimson' }[] }) {
  const bg: Record<string, string> = {
    cyan: 'bg-void-cyan',
    mint: 'bg-void-mint',
    amber: 'bg-void-amber',
    violet: 'bg-void-violet',
    crimson: 'bg-void-crimson',
  }
  return (
    <div className="flex flex-wrap gap-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-sm ${bg[i.accent]}`} />
          {i.label}
        </div>
      ))}
    </div>
  )
}
