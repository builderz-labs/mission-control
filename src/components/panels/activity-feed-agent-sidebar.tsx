'use client'

import { useTranslations } from 'next-intl'
import type { Agent } from '@/store/slices/agent-slice'
import { formatRelativeTime, SessionInfo } from './activity-feed-panel-types'

// Use the store's Agent type directly — avoids duplication and ensures type safety
type AgentData = Agent

interface ActivityFeedAgentSidebarProps {
  readonly agentData: AgentData | undefined
  readonly sessions: SessionInfo[]
}

/** Agent info card + active-sessions card shown in the agent-grouped view. */
export function ActivityFeedAgentSidebar({
  agentData,
  sessions,
}: ActivityFeedAgentSidebarProps): React.JSX.Element {
  return (
    <div className="lg:col-span-1 space-y-3">
      {agentData && <AgentInfoCard agent={agentData} />}
      {sessions.length > 0 && <AgentSessionsCard sessions={sessions} />}
    </div>
  )
}

// ── Agent info card ──────────────────────────────────────────────────────────
function AgentInfoCard({ agent }: { readonly agent: AgentData }): React.JSX.Element {
  const t = useTranslations('activityFeed')
  const initials = agent.name.slice(0, 2).toUpperCase()

  const statusColour =
    agent.status === 'busy'
      ? 'text-green-400'
      : agent.status === 'idle'
        ? 'text-yellow-400'
        : agent.status === 'error'
          ? 'text-red-400'
          : 'text-muted-foreground'

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <span className="text-sm font-bold text-primary">{initials}</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{agent.name}</p>
          <p className="text-xs text-muted-foreground">{agent.role}</p>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t('agentStatus')}</span>
          <span className={`font-medium ${statusColour}`}>{agent.status}</span>
        </div>
        {agent.last_seen && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('lastSeen')}</span>
            <span className="text-foreground font-mono-tight">
              {formatRelativeTime(agent.last_seen)}
            </span>
          </div>
        )}
        {agent.last_activity && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('lastAction')}</span>
            <span
              className="text-foreground truncate max-w-[140px]"
              title={agent.last_activity}
            >
              {agent.last_activity}
            </span>
          </div>
        )}
        {agent.taskStats && <TaskStatsRows stats={agent.taskStats} />}
      </div>
    </div>
  )
}

// Separated to keep AgentInfoCard under 50 lines
function TaskStatsRows({
  stats,
}: {
  readonly stats: NonNullable<AgentData['taskStats']>
}): React.JSX.Element {
  const t = useTranslations('activityFeed')
  return (
    <>
      <div className="border-t border-border pt-2 mt-2" />
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t('tasksAssigned')}</span>
        <span className="text-foreground">{stats.assigned}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t('inProgress')}</span>
        <span className="text-foreground">{stats.in_progress}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{t('completed')}</span>
        <span className="text-foreground">{stats.completed}</span>
      </div>
    </>
  )
}

// ── Active sessions card ─────────────────────────────────────────────────────
function AgentSessionsCard({ sessions }: { readonly sessions: SessionInfo[] }): React.JSX.Element {
  const t = useTranslations('activityFeed')
  return (
    <div className="rounded-lg border border-border p-4">
      <h4 className="text-xs font-semibold text-foreground mb-2">{t('activeSessions')}</h4>
      <div className="space-y-2">
        {sessions.map((s) => (
          <div key={s.id} className="text-xs space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`}
              />
              <span className="font-mono-tight text-foreground truncate">{s.kind}</span>
            </div>
            <div className="flex gap-3 text-muted-foreground pl-3">
              <span>{s.model}</span>
              <span>{s.tokens} tokens</span>
              <span>{s.age}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
