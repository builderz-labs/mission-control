'use client'

/**
 * PromoBanner — top-of-main-content strip
 * Showcases Mantu Group branding + upcoming products.
 * Intentionally lightweight: no state, no fetches.
 */

const PRODUCTS = [
  {
    label: 'DictX',
    href: 'https://dictx.splitlabs.io',
    badge: 'Beta',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  },
  {
    label: 'Flight Deck Pro',
    href: 'https://mantu.group',
    badge: 'Soon',
    badgeClass: 'bg-void-cyan/15 text-void-cyan border border-void-cyan/25',
  },
] as const

export function PromoBanner() {
  return (
    <div className="mx-4 mt-3 mb-0 rounded-lg border border-white/[0.06] bg-gradient-to-r from-white/[0.03] via-white/[0.05] to-white/[0.02] px-4 py-2.5 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">

        {/* Brand mark */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Animated pulse — signals live AI infrastructure */}
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <a
            href="https://mantu.group"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-baseline gap-1 group"
          >
            <span className="text-xs font-bold tracking-tight text-foreground/90 group-hover:text-foreground transition-colors">
              Mantu Group
            </span>
            <span className="text-[9px] font-mono px-1 py-px rounded bg-primary/15 text-primary border border-primary/20 leading-none">
              AI
            </span>
          </a>
        </div>

        {/* Separator */}
        <span className="hidden sm:block w-px h-3 bg-white/10 shrink-0" />

        {/* Tagline */}
        <p className="text-[10px] text-muted-foreground/60 shrink-0 hidden sm:block">
          AI orchestration by{' '}
          <span className="text-muted-foreground/90 font-medium">Tony W.</span>
        </p>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Upcoming products */}
        <div className="flex items-center gap-2">
          {PRODUCTS.map(p => (
            <a
              key={p.label}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 hover:bg-white/[0.06] hover:border-white/[0.12] transition-all duration-150 group"
            >
              <span className="text-[10px] font-medium text-foreground/70 group-hover:text-foreground/90 transition-colors">
                {p.label}
              </span>
              <span className={`text-[8px] font-semibold px-1 py-px rounded-sm leading-none ${p.badgeClass}`}>
                {p.badge}
              </span>
            </a>
          ))}

          {/* Contact */}
          <a
            href="https://mantu.group"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-medium text-muted-foreground/50 hover:text-muted-foreground/90 transition-colors px-1.5"
          >
            Contact
          </a>
        </div>

      </div>
    </div>
  )
}
