import type { ThresholdBreach } from './mac-cleanup-types'

function tone(severity: ThresholdBreach['severity']): string {
  if (severity === 'critical') return 'border-red-500/40 bg-red-500/10'
  if (severity === 'warn') return 'border-amber-500/40 bg-amber-500/10'
  return 'border-border bg-muted/30'
}

function valueClass(severity: ThresholdBreach['severity']): string {
  if (severity === 'critical') return 'text-red-400'
  if (severity === 'warn') return 'text-amber-400'
  return 'text-foreground'
}

function formatValue(breach: ThresholdBreach): string {
  if (breach.value == null) return 'n/a'
  if (breach.unit === 'GB') return `${breach.value} GB`
  return `${breach.value}${breach.unit}`
}

export function MacCleanupMeters({
  breaches,
  npmActive,
  pnpmActive,
}: {
  breaches: ThresholdBreach[]
  npmActive: boolean | null
  pnpmActive: boolean | null
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {breaches.map((breach) => (
          <div key={breach.id} className={`rounded-xl border p-3 ${tone(breach.severity)}`}>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{breach.label}</span>
              <span className="uppercase tracking-wide">{breach.severity}</span>
            </div>
            <div className={`text-2xl font-mono font-bold tabular-nums ${valueClass(breach.severity)}`}>
              {formatValue(breach)}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              trigger {breach.threshold}{breach.unit}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Package tools: npm {npmActive == null ? 'unknown' : npmActive ? 'busy' : 'idle'}
        {' · '}
        pnpm {pnpmActive == null ? 'unknown' : pnpmActive ? 'busy' : 'idle'}
      </p>
    </div>
  )
}
