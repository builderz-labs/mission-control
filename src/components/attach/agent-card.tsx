'use client'

import { getBrandGradient } from '@/lib/theme/brand-gradient'
import { formatModelName, buildTaskStatParts } from '@/lib/agent-card-helpers'
import type { Agent } from '@/store'

interface AgentCardProps {
  agent: Agent
  onClick?: () => void
}

const statusBadge: Record<string, string> = {
  idle: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  busy: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  error: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  offline: 'bg-muted text-muted-foreground border border-border',
}

function formatLastSeen(lastSeen: number | undefined): string | null {
  if (!lastSeen) return null
  const diff = Math.floor(Date.now() / 1000) - lastSeen
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(lastSeen * 1000).toLocaleDateString()
}

export function AgentCard({ agent, onClick }: AgentCardProps) {
  const isActive = agent.status === 'idle' || agent.status === 'busy'
  const modelName = formatModelName(agent.config)
  const taskParts = buildTaskStatParts(agent.taskStats)
  const lastSeen = formatLastSeen(agent.last_seen)

  return (
    <div
      data-testid="agent-card"
      onClick={onClick}
      className={`rounded-2xl border border-border/50 bg-card p-5 ${onClick ? 'hover:-translate-y-0.5 transition-all cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          data-testid="agent-icon"
          className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isActive ? '' : 'bg-muted'}`}
          style={isActive ? { background: getBrandGradient() } : undefined}
        >
          <span className="text-xl font-semibold text-white">{agent.name.charAt(0)}</span>
        </div>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusBadge[agent.status] ?? statusBadge.offline}`}>
          {agent.status}
        </span>
      </div>

      <div className="mb-2">
        <p className="text-base font-semibold leading-tight">{agent.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{agent.role}</p>
      </div>

      {modelName && (
        <span className="inline-block font-mono text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded mb-2">
          {modelName}
        </span>
      )}

      {taskParts && (
        <div className="flex gap-2 flex-wrap mt-1 mb-2">
          {taskParts.map(part => (
            <span key={part.label} className={`text-[11px] ${part.color ?? 'text-muted-foreground'}`}>
              {part.count} {part.label}
            </span>
          ))}
        </div>
      )}

      {lastSeen && (
        <div className="flex justify-end mt-2">
          <span className="text-[11px] text-muted-foreground/60">{lastSeen}</span>
        </div>
      )}
    </div>
  )
}
