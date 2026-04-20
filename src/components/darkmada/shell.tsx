'use client'

import type { ReactNode } from 'react'

export function DmShell({
  eyebrow,
  title,
  subtitle,
  icon,
  actions,
  children,
}: {
  eyebrow: string
  title: string
  subtitle: string
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="h-full overflow-y-auto bg-background relative">
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8 relative">
        <header className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4">
            {icon && (
              <div className="glass shrink-0 h-12 w-12 rounded-2xl flex items-center justify-center text-foreground/85">
                {icon}
              </div>
            )}
            <div className="space-y-1.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-void-cyan">{eyebrow}</div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">{subtitle}</p>
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  )
}

export function Card({ title, eyebrow, children, accent = 'cyan' }: { title?: string; eyebrow?: string; children: ReactNode; accent?: 'cyan' | 'mint' | 'amber' | 'violet' | 'crimson' }) {
  const tone: Record<string, string> = {
    cyan: 'border-void-cyan/20',
    mint: 'border-void-mint/20',
    amber: 'border-void-amber/20',
    violet: 'border-void-violet/20',
    crimson: 'border-void-crimson/20',
  }
  const text: Record<string, string> = {
    cyan: 'text-void-cyan',
    mint: 'text-void-mint',
    amber: 'text-void-amber',
    violet: 'text-void-violet',
    crimson: 'text-void-crimson',
  }
  return (
    <div className={`glass rounded-xl border ${tone[accent]} p-5`}>
      {(eyebrow || title) && (
        <div className="mb-4">
          {eyebrow && <div className={`font-mono text-[10px] uppercase tracking-[0.18em] ${text[accent]}`}>{eyebrow}</div>}
          {title && <div className="text-base font-medium mt-1">{title}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Stat({ label, value, hint, accent = 'cyan' }: { label: string; value: string; hint?: string; accent?: 'cyan' | 'mint' | 'amber' | 'violet' }) {
  const text: Record<string, string> = {
    cyan: 'text-void-cyan',
    mint: 'text-void-mint',
    amber: 'text-void-amber',
    violet: 'text-void-violet',
  }
  return (
    <div className="glass rounded-lg border border-border p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1.5 ${text[accent]} font-mono tabular-nums`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

export function Pill({ children, accent = 'cyan' }: { children: ReactNode; accent?: 'cyan' | 'mint' | 'amber' | 'violet' | 'crimson' | 'muted' }) {
  const tone: Record<string, string> = {
    cyan: 'border-void-cyan/30 text-void-cyan bg-void-cyan/[0.06]',
    mint: 'border-void-mint/30 text-void-mint bg-void-mint/[0.06]',
    amber: 'border-void-amber/30 text-void-amber bg-void-amber/[0.06]',
    violet: 'border-void-violet/30 text-void-violet bg-void-violet/[0.06]',
    crimson: 'border-void-crimson/30 text-void-crimson bg-void-crimson/[0.06]',
    muted: 'border-border text-muted-foreground bg-muted/30',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone[accent]}`}>
      {children}
    </span>
  )
}
