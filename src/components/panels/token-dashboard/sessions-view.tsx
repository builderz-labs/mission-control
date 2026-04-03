'use client'

import type { JSX } from 'react'
import type { SessionCostEntry } from './types'
import { formatNumber, formatCost, getModelDisplayName } from './formatters'

interface SessionInfo {
  id: string
  key?: string
  active?: boolean
  kind?: string
}

interface SessionsViewProps {
  readonly sortedSessionCosts: SessionCostEntry[]
  readonly sessionSort: 'cost' | 'tokens' | 'requests' | 'recent'
  readonly onSortChange: (sort: 'cost' | 'tokens' | 'requests' | 'recent') => void
  readonly sessions: SessionInfo[]
}

export function SessionsView({
  sortedSessionCosts,
  sessionSort,
  onSortChange,
  sessions,
}: SessionsViewProps): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Sort by:</span>
        {(['cost', 'tokens', 'requests', 'recent'] as const).map(s => (
          <button
            key={s}
            onClick={() => onSortChange(s)}
            className={`px-2 py-1 text-xs rounded ${
              sessionSort === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {sortedSessionCosts.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <p className="text-lg mb-1">No session cost data</p>
          <p className="text-sm">Session-level breakdowns appear once usage is recorded.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedSessionCosts.map(entry => {
            const sessionInfo = sessions.find(s => s.id === entry.sessionId)
            return (
              <div key={entry.sessionId} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {entry.sessionKey || sessionInfo?.key || entry.sessionId}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      {sessionInfo?.active && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                      )}
                      <span>{sessionInfo?.active ? 'Active' : 'Inactive'}</span>
                      {entry.model && <span>| {getModelDisplayName(entry.model)}</span>}
                      {sessionInfo?.kind && <span>| {sessionInfo.kind}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-lg font-bold text-foreground">{formatCost(entry.totalCost)}</div>
                    <div className="text-xs text-muted-foreground">{formatNumber(entry.totalTokens)} tokens</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-xs text-muted-foreground border-t border-border/50 pt-2 mt-2">
                  <div><span className="font-medium text-foreground">{entry.requestCount}</span> requests</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.inputTokens || 0)}</span> in</div>
                  <div><span className="font-medium text-foreground">{formatNumber(entry.outputTokens || 0)}</span> out</div>
                  <div>
                    {entry.totalTokens > 0
                      ? <span className="font-medium text-foreground">{formatCost(entry.totalCost / entry.requestCount)}</span>
                      : '-'
                    }{' '}avg/req
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
