'use client'

import type { MissionControlUsageSummary } from '@/types/mission-control'

export function UsageMonitorPanel({ usage }: { usage: MissionControlUsageSummary }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">AI Usage Monitor</h2>
      </div>

      <div className="grid gap-3 px-4 pb-4 pt-1 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Input Tokens" value={usage.totalInputTokens.toLocaleString()} />
        <Metric label="Output Tokens" value={usage.totalOutputTokens.toLocaleString()} />
        <Metric label="Estimated Cost" value={`$${usage.totalEstimatedCost.toFixed(4)}`} />
        <Metric label="Calls / Min" value={usage.callsPerMinute.toString()} />
      </div>

      <div className="divide-y divide-border/40">
        {usage.models.map((model) => (
          <div key={model.model} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{model.model}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted-foreground">
                  <span>in {model.inputTokens.toLocaleString()}</span>
                  <span>out {model.outputTokens.toLocaleString()}</span>
                  <span>${model.estimatedCost.toFixed(4)}</span>
                </div>
              </div>
              <span className="text-2xs text-muted-foreground">{model.callsPerMinute}/min</span>
            </div>
          </div>
        ))}
        {usage.models.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No token usage recorded yet.
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold text-foreground">{value}</div>
    </div>
  )
}
