'use client'

import { StatusBadge } from './status-badge'
import type { HandoffChainRunWithName } from './types'

interface RecentRunsSectionProps {
  runs: HandoffChainRunWithName[]
}

export function RecentRunsSection({ runs }: RecentRunsSectionProps): React.JSX.Element {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">Recent Runs</span>
      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground mt-1">No runs yet</p>
      ) : (
        <div className="mt-1.5 space-y-1">
          {runs.map(run => (
            <div key={run.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/30 text-xs">
              <StatusBadge status={run.status} />
              <span className="text-muted-foreground truncate flex-1">
                {run.chain_name ?? `Chain #${run.chain_id}`} — Run #{run.id}
              </span>
              <span className="text-muted-foreground/70 shrink-0">
                {new Date(run.started_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
