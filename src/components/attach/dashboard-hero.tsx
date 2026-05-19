/* attach-os override — Dashboard Home Hero (Apple-style) */
'use client'

export interface DashboardHeroProps {
  userName: string
  activeAgents: number
  reviewTasks: number
  dailySpend: number
}

function greetingByHour(hour: number): string {
  if (hour >= 6 && hour < 12) return 'Buen día'
  if (hour >= 12 && hour < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

export function DashboardHero({ userName, activeAgents, reviewTasks, dailySpend }: DashboardHeroProps) {
  const hour = new Date().getHours()
  const greeting = greetingByHour(hour)
  const formattedSpend = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(dailySpend)

  return (
    <section className="relative px-1 pt-6 pb-4 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse at top right, #223ED7 0%, transparent 60%)' }}
      />
      <div className="relative">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Mission Control
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] text-foreground">
          {greeting}, {userName}.
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {activeAgents} agentes activos · {reviewTasks} tareas en review · {formattedSpend} hoy
        </p>
      </div>
    </section>
  )
}