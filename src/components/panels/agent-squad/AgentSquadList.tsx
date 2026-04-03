'use client'

import { AgentSquadMemberCard } from './AgentSquadMemberCard'
import type { Agent } from './agent-squad-types'

interface AgentSquadListProps {
  agents: Agent[]
  hasRecentHeartbeat: (agent: Agent) => boolean
  formatLastSeen: (timestamp?: number) => string
  wakeLabel: string
  spawnLabel: string
  noAgentsLabel: string
  noAgentsHintLabel: string
  onSelectAgent: (agent: Agent) => void
  onWakeAgent: (agent: Agent) => void
  onSpawnAgent: (agent: Agent) => void
}

export function AgentSquadList({
  agents,
  hasRecentHeartbeat,
  formatLastSeen,
  wakeLabel,
  spawnLabel,
  noAgentsLabel,
  noAgentsHintLabel,
  onSelectAgent,
  onWakeAgent,
  onSpawnAgent,
}: AgentSquadListProps) {
  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50">
        <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-3">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="5" r="3" />
            <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          </svg>
        </div>
        <p className="text-sm font-medium">{noAgentsLabel}</p>
        <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs text-center">
          {noAgentsHintLabel}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {agents.map(agent => (
        <AgentSquadMemberCard
          key={agent.id}
          agent={agent}
          hasRecentHeartbeat={hasRecentHeartbeat}
          formatLastSeen={formatLastSeen}
          wakeLabel={wakeLabel}
          spawnLabel={spawnLabel}
          onSelect={onSelectAgent}
          onWake={onWakeAgent}
          onSpawn={onSpawnAgent}
        />
      ))}
    </div>
  )
}
