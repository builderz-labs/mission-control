'use client'

import { useTranslations } from 'next-intl'
import type { Agent } from './orchestration-bar.types'

interface FleetTabProps {
  agents: Agent[]
  onlineCount: number
  busyCount: number
  errorCount: number
}

export function FleetTab({ agents, onlineCount, busyCount, errorCount }: FleetTabProps): React.ReactElement {
  const t = useTranslations('orchestration')

  return (
    <div className="p-4 pt-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FleetCard label={t('totalAgents')} value={agents.length} />
        <FleetCard label={t('online')} value={onlineCount} color="green" />
        <FleetCard label={t('busy')} value={busyCount} color="amber" />
        <FleetCard label={t('errors')} value={errorCount} color={errorCount > 0 ? 'red' : undefined} />
      </div>
      {agents.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {agents.map(a => (
            <AgentChip key={a.id} agent={a} />
          ))}
        </div>
      )}
    </div>
  )
}

interface AgentChipProps {
  agent: Agent
}

function AgentChip({ agent }: AgentChipProps): React.ReactElement {
  const dotColor =
    agent.status === 'busy' ? 'bg-amber-500' :
    agent.status === 'idle' ? 'bg-green-500' :
    agent.status === 'error' ? 'bg-red-500' : 'bg-gray-500'

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary/50 text-xs"
      title={`${agent.name} - ${agent.role} - ${agent.status}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className="text-foreground font-medium">{agent.name}</span>
      <span className="text-muted-foreground">{agent.role}</span>
    </div>
  )
}

interface FleetCardProps {
  label: string
  value: number
  color?: string
}

function FleetCard({ label, value, color }: FleetCardProps): React.ReactElement {
  const colorClass = color === 'green' ? 'text-green-400' :
    color === 'amber' ? 'text-amber-400' :
    color === 'red' ? 'text-red-400' : 'text-foreground'

  return (
    <div className="p-2.5 rounded-lg bg-secondary/50 border border-border">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold font-mono-tight ${colorClass}`}>{value}</div>
    </div>
  )
}
