'use client'

import type { DashboardData, LogLike } from '../widget-primitives'

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function getSourceLabel(source: string): string {
  if (source.includes('claude')) return 'Claude'
  if (source.includes('codex')) return 'Codex'
  if (source.includes('hermes')) return 'Hermes'
  if (source.includes('gateway')) return 'Gateway'
  if (source.includes('mc') || source.includes('mission')) return 'MC'
  return source.length > 10 ? source.slice(0, 10) : source
}

function getStatusBadge(log: LogLike): { label: string; className: string } {
  if (log.level === 'error') return { label: 'Error', className: 'text-red-400 bg-red-500/10 border-red-500/20' }
  if (log.message.toLowerCase().includes('completed') || log.message.toLowerCase().includes('done'))
    return { label: 'Done', className: 'text-green-400 bg-green-500/10 border-green-500/20' }
  if (log.message.toLowerCase().includes('started') || log.message.toLowerCase().includes('running') || log.message.toLowerCase().includes('active'))
    return { label: 'Running', className: 'text-blue-400 bg-blue-500/10 border-blue-500/20' }
  if (log.message.toLowerCase().includes('idle') || log.message.toLowerCase().includes('waiting'))
    return { label: 'Idle', className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' }
  if (log.level === 'warn')
    return { label: 'Warning', className: 'text-amber-400 bg-amber-500/10 border-amber-500/20' }
  return { label: 'Info', className: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20' }
}

export function ActivityTimelineWidget({ data }: { data: DashboardData }) {
  const { mergedRecentLogs, isSessionsLoading } = data

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">Activity</h3>
        <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>
      <div className="max-h-[340px] overflow-y-auto">
        {mergedRecentLogs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {isSessionsLoading ? 'Loading activity...' : 'No activity yet'}
            </p>
            <p className="text-2xs text-muted-foreground/60 mt-1">Agent events and task updates will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {mergedRecentLogs.map((log) => {
              const badge = getStatusBadge(log)
              return (
                <div key={log.id} className="px-4 py-2.5 hover:bg-secondary/30 transition-smooth group">
                  <div className="flex items-start gap-3">
                    {/* Time column */}
                    <span className="text-2xs text-muted-foreground/60 font-mono-tight w-14 shrink-0 pt-0.5">
                      {timeAgo(log.timestamp)}
                    </span>

                    {/* Source badge */}
                    <span className="text-2xs font-medium text-foreground/60 w-14 shrink-0 pt-0.5">
                      {getSourceLabel(log.source)}
                    </span>

                    {/* Message */}
                    <p className="flex-1 text-xs text-foreground/80 min-w-0 wrap-break-word leading-relaxed">
                      {log.message.length > 120 ? log.message.slice(0, 120) + '...' : log.message}
                    </p>

                    {/* Status badge */}
                    <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
