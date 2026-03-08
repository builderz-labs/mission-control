'use client'

import { LogRow, type DashboardData } from '../widget-primitives'

export function EventStreamWidget({ data }: { data: DashboardData }) {
  const { isLocal, mergedRecentLogs, recentErrorLogs, isSessionsLoading } = data

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">{isLocal ? 'Local Event Stream' : 'Incident Stream'}</h3>
        <span className="text-2xs text-muted-foreground font-mono-tight">
          {isLocal ? mergedRecentLogs.length : `${recentErrorLogs} errors`}
        </span>
      </div>
      <div className="divide-y divide-border/50 max-h-80 overflow-y-auto">
        {mergedRecentLogs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-muted-foreground">
              {isSessionsLoading ? 'Loading logs...' : 'No logs yet'}
            </p>
            <p className="text-2xs text-muted-foreground/60 mt-1">
              {isLocal ? 'Local Claude/Codex events stream here.' : 'Gateway incidents and warnings stream here.'}
            </p>
          </div>
        ) : (
          mergedRecentLogs.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  )
}
