'use client'

import { SessionKindAvatar } from '@/components/chat/session-kind-brand'
import { LlmLabel } from '@/components/brand/engine-logo'
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

const FLEET_COLOR: Record<string, 'blue' | 'green' | 'purple' | 'red'> = {
  'claude-code': 'blue',
  'codex-cli': 'green',
  grok: 'red',
  kimi: 'purple',
  hermes: 'purple',
  opencode: 'purple',
}

export function MetricCardsWidget({ data }: { data: DashboardData }) {
  const {
    isLocal,
    isClaudeLoading,
    isSessionsLoading,
    isSystemLoading,
    claudeStats,
    cliFleets,
    hermesCronJobCount,
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

  const cliCards = cliFleets.filter((fleet) => fleet.kind !== 'gateway' && (isLocal || fleet.total > 0))
  if (isLocal || cliCards.length > 0) {
    const hermes = cliFleets.find((fleet) => fleet.kind === 'hermes')
    return (
      <section className="grid grid-cols-2 xl:grid-cols-6 gap-3">
        {cliCards.map((fleet) => (
          <MetricCard
            key={fleet.kind}
            label={fleet.label}
            value={isSessionsLoading ? '...' : fleet.active}
            total={isSessionsLoading ? undefined : fleet.total}
            subtitle={fleet.kind === 'hermes' && hermesCronJobCount > 0
              ? `${hermes?.active ?? 0} active · ${hermesCronJobCount} cron`
              : 'active sessions'}
            icon={<SessionKindAvatar kind={fleet.kind} fallback={fleet.label.slice(0, 2)} sizeClassName="w-5 h-5" />}
            color={FLEET_COLOR[fleet.kind] || 'purple'}
          />
        ))}
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
          subtitle={subscriptionLabel ? <LlmLabel text={`${subscriptionLabel} plans`} size={11} /> : 'estimated'}
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
