'use client'

import type { JSX } from 'react'
import type { Session } from './types'

interface SessionSidebarProps {
  sessions: Session[]
  parseTokenUsage: (tokens: string) => { percentage: number }
  getModelInfo: (model: string) => { alias: string }
}

export function SessionSidebar({
  sessions,
  parseTokenUsage,
  getModelInfo,
}: SessionSidebarProps): JSX.Element {
  const activeCount = sessions.filter((s) => s.active).length
  const idleCount = sessions.filter((s) => !s.active).length
  const subagentCount = sessions.filter((s) => s.key.includes(':subagent:')).length
  const cronCount = sessions.filter((s) => s.key.includes(':cron:')).length

  // Compute distribution without mutating — use a Map to accumulate counts
  const modelDistribution = sessions.reduce<Record<string, number>>((acc, session) => {
    const alias = getModelInfo(session.model).alias
    return { ...acc, [alias]: (acc[alias] ?? 0) + 1 }
  }, {})

  const highUsageSessions = sessions.filter((s) => parseTokenUsage(s.tokens).percentage > 80)

  return (
    <div className="space-y-6">
      {/* Overview */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Session Overview</h2>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Sessions:</span>
            <span className="font-medium text-foreground">{sessions.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Active:</span>
            <span className="font-medium text-green-400">{activeCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Idle:</span>
            <span className="font-medium text-muted-foreground">{idleCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sub-agents:</span>
            <span className="font-medium text-foreground">{subagentCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cron Jobs:</span>
            <span className="font-medium text-foreground">{cronCount}</span>
          </div>
        </div>
      </div>

      {/* Model Distribution */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">Model Distribution</h2>
        <div className="space-y-3">
          {Object.entries(modelDistribution).map(([model, count]) => (
            <div key={model} className="flex items-center justify-between">
              <span className="text-foreground">{model}</span>
              <div className="flex items-center space-x-2">
                <span className="text-muted-foreground">{count}</span>
                <div className="w-16 bg-secondary rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full"
                    style={{ width: `${sessions.length > 0 ? (count / sessions.length) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* High Token Usage Alert */}
      {highUsageSessions.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <h3 className="font-medium text-yellow-400 mb-2">High Token Usage</h3>
          <div className="text-sm text-muted-foreground">
            {highUsageSessions.length} session{highUsageSessions.length !== 1 ? 's' : ''} {highUsageSessions.length === 1 ? 'is' : 'are'} using more than 80% of
            their token limit.
          </div>
        </div>
      )}
    </div>
  )
}
