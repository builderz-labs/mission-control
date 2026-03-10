'use client'

import type { MissionControlHeartbeatRow } from '@/types/mission-control'

export function HeartbeatMonitorPanel({ heartbeat }: { heartbeat: MissionControlHeartbeatRow[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-sm font-semibold text-foreground">Agent Heartbeat Monitor</h2>
        <span className="text-2xs font-medium text-muted-foreground">{heartbeat.length} agents</span>
      </div>

      <div className="max-h-[22rem] overflow-y-auto divide-y divide-border/40">
        {heartbeat.map((row) => (
          <div key={row.agentId} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">{row.agentName}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-2xs text-muted-foreground">
                  <span>{formatRelative(row.lastHeartbeatTs)}</span>
                  {row.memoryUsage && <span>mem {row.memoryUsage}</span>}
                  {row.cpuUsage && <span>cpu {row.cpuUsage}</span>}
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-2xs uppercase ${
                row.status === 'active'
                  ? 'bg-green-500/10 text-green-400'
                  : row.status === 'idle'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-secondary text-muted-foreground'
              }`}>
                {row.status}
              </span>
            </div>
          </div>
        ))}
        {heartbeat.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No heartbeat data available.
          </div>
        )}
      </div>
    </section>
  )
}

function formatRelative(ts?: string) {
  if (!ts) return '-'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
