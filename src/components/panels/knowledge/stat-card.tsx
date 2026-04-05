'use client'

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  color: string
}

export function StatCard({ icon, label, value, sub, color }: StatCardProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <div
        className="p-2.5 rounded-lg border"
        style={{
          background: `color-mix(in srgb, ${color} 10%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 20%, transparent)`,
          color,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{label}</div>
        <div className="text-lg font-semibold text-foreground">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}
