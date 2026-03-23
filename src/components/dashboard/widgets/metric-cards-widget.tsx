'use client'

import {
  MetricCard,
  SessionIcon,
  GatewayIcon,
  AgentIcon,
  TaskIcon,
  ActivityIconMini,
  TokenIcon,
  CostIcon,
  formatTokensShort,
  type DashboardData,
} from '../widget-primitives'

export function MetricCardsWidget({ data }: { data: DashboardData }) {
  const {
    isLocal,
    isClaudeLoading,
    isSessionsLoading,
    isSystemLoading,
    claudeActive,
    codexActive,
    claudeStats,
    claudeLocalSessions,
    codexLocalSessions,
    systemLoad,
    memPct,
    diskPct,
    connection,
    activeSessions,
    sessions,
    onlineAgents,
    dbStats,
    agents,
    backlogCount,
    runningTasks,
    errorCount,
    subscriptionLabel,
    subscriptionPrice,
  } = data

  if (isLocal) {
    return (
      <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        <MetricCard
          label="Claude"
          value={isClaudeLoading ? '...' : claudeActive}
          total={isClaudeLoading ? undefined : (claudeStats?.total_sessions ?? claudeLocalSessions.length)}
          subtitle="active sessions"
          icon={<SessionIcon />}
          color="blue"
        />
        <MetricCard
          label="Codex"
          value={isSessionsLoading ? '...' : codexActive}
          total={isSessionsLoading ? undefined : codexLocalSessions.length}
          subtitle="active sessions"
          icon={<SessionIcon />}
          color="green"
        />
        <MetricCard
          label="System Load"
          value={isSystemLoading ? '...' : `${systemLoad}%`}
          subtitle={`mem ${memPct ?? '-'} · disk ${Number.isFinite(diskPct) ? `${diskPct}%` : '-'}`}
          icon={<ActivityIconMini />}
          color={systemLoad > 85 ? 'red' : 'purple'}
        />
        <MetricCard
          label="Tokens"
          value={isClaudeLoading ? '...' : formatTokensShort((claudeStats?.total_input_tokens ?? 0) + (claudeStats?.total_output_tokens ?? 0))}
          subtitle={isClaudeLoading ? undefined : `${formatTokensShort(claudeStats?.total_input_tokens ?? 0)} in · ${formatTokensShort(claudeStats?.total_output_tokens ?? 0)} out`}
          icon={<TokenIcon />}
          color="purple"
        />
        <MetricCard
          label="Cost"
          value={isClaudeLoading ? '...' : (subscriptionLabel ? (subscriptionPrice ? `$${subscriptionPrice}/mo` : 'Included') : `$${(claudeStats?.total_estimated_cost ?? 0).toFixed(2)}`)}
          subtitle={subscriptionLabel ? `${subscriptionLabel} plan` : 'estimated'}
          icon={<CostIcon />}
          color={errorCount > 0 ? 'red' : 'green'}
        />
      </section>
    )
  }

  return (
    <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">
      <MetricCard label="Gateway" value={connection.isConnected ? 'Online' : 'Offline'} subtitle="transport status" icon={<GatewayIcon />} color={connection.isConnected ? 'green' : 'red'} />
      <MetricCard label="Sessions" value={activeSessions} total={sessions.length} subtitle="active / total" icon={<SessionIcon />} color="blue" />
      <MetricCard label="Agent Capacity" value={onlineAgents} subtitle={`${dbStats?.agents.total ?? agents.length} total`} icon={<AgentIcon />} color="green" />
      <MetricCard label="Queue" value={backlogCount} subtitle={`${runningTasks} running`} icon={<TaskIcon />} color={backlogCount > 12 ? 'red' : 'purple'} />
      <MetricCard label="System Load" value={isSystemLoading ? '...' : `${systemLoad}%`} subtitle={`errors ${errorCount}`} icon={<ActivityIconMini />} color={systemLoad > 85 || errorCount > 0 ? 'red' : 'blue'} />
    </section>
  )
}
