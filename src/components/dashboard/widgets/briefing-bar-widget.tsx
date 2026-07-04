'use client'

import { formatTokensShort, type DashboardData } from '../widget-primitives'

export function BriefingBarWidget({ data }: { data: DashboardData }) {
  const {
    isLocal,
    activeSessions,
    onlineAgents,
    runningTasks,
    reviewCount,
    errorCount,
    claudeStats,
    memPct,
    sessions,
    connection,
    isSystemLoading,
    isClaudeLoading,
    subscriptionLabel,
    subscriptionPrice,
    navigateToPanel,
    dbStats,
    agents,
  } = data

  const totalTokens = (claudeStats?.total_input_tokens ?? 0) + (claudeStats?.total_output_tokens ?? 0)
  const costDisplay = subscriptionLabel
    ? (subscriptionPrice ? `$${subscriptionPrice}/mo` : 'Included')
    : `$${(claudeStats?.total_estimated_cost ?? 0).toFixed(2)}`

  const agentTotal = dbStats?.agents.total ?? agents.length

  return (
    <div className="rounded-xl border border-border bg-card/80 backdrop-blur-xs px-4 py-3">
      {/* Top row: key counts */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <BriefingItem
          dot="green"
          onClick={() => navigateToPanel(isLocal ? 'sessions' : 'agents')}
        >
          {isLocal
            ? <><b>{activeSessions}</b> active session{activeSessions !== 1 ? 's' : ''}</>
            : <><b>{onlineAgents}</b>/<b>{agentTotal}</b> agents online</>
          }
        </BriefingItem>

        <BriefingItem
          dot="blue"
          onClick={() => navigateToPanel('tasks')}
        >
          <b>{runningTasks}</b> task{runningTasks !== 1 ? 's' : ''} running
        </BriefingItem>

        {reviewCount > 0 && (
          <BriefingItem
            dot="amber"
            onClick={() => navigateToPanel('tasks')}
          >
            <b>{reviewCount}</b> need{reviewCount === 1 ? 's' : ''} review
          </BriefingItem>
        )}

        {errorCount > 0 && (
          <BriefingItem
            dot="red"
            onClick={() => navigateToPanel('logs')}
          >
            <b>{errorCount}</b> error{errorCount !== 1 ? 's' : ''}
          </BriefingItem>
        )}

        {!isLocal && (
          <BriefingItem dot={connection.isConnected ? 'green' : 'red'}>
            Gateway {connection.isConnected ? 'connected' : 'disconnected'}
            {connection.latency != null && <span className="text-muted-foreground/60 ml-1">{connection.latency}ms</span>}
          </BriefingItem>
        )}
      </div>

      {/* Bottom row: secondary metrics */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-1.5 text-2xs text-muted-foreground">
        <span>{sessions.length} session{sessions.length !== 1 ? 's' : ''} today</span>

        {isLocal && !isClaudeLoading && totalTokens > 0 && (
          <span>{formatTokensShort(totalTokens)} tokens</span>
        )}

        {isLocal && !isClaudeLoading && (
          <span>{costDisplay} spent</span>
        )}

        {!isSystemLoading && memPct != null && (
          <span className="inline-flex items-center gap-1.5">
            Memory {memPct}%
            <span className="inline-flex h-1.5 w-16 rounded-full bg-secondary overflow-hidden">
              <span
                className={`h-full rounded-full transition-all duration-500 ${
                  memPct > 90 ? 'bg-red-500' : memPct > 70 ? 'bg-amber-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(memPct, 100)}%` }}
              />
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

function BriefingItem({
  dot,
  onClick,
  children,
}: {
  dot: 'green' | 'blue' | 'amber' | 'red'
  onClick?: () => void
  children: React.ReactNode
}) {
  const dotColor = {
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
  }[dot]

  const Tag = onClick ? 'button' : 'span'

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs text-foreground/80 ${
        onClick ? 'hover:text-foreground cursor-pointer transition-colors' : ''
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
      <span className="[&>b]:font-semibold [&>b]:text-foreground">{children}</span>
    </Tag>
  )
}
