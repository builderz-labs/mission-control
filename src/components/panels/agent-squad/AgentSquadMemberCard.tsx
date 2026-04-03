'use client'

import { Button } from '@/components/ui/button'
import { AgentAvatar } from '@/components/ui/agent-avatar'
import { formatModelName, buildTaskStatParts } from '@/lib/agent-card-helpers'
import {
  statusCardStyles,
  statusBadgeStyles,
  defaultCardStyle,
  type Agent,
} from './agent-squad-types'

interface AgentSquadMemberCardProps {
  agent: Agent
  hasRecentHeartbeat: (agent: Agent) => boolean
  formatLastSeen: (timestamp?: number) => string
  wakeLabel: string
  spawnLabel: string
  onSelect: (agent: Agent) => void
  onWake: (agent: Agent) => void
  onSpawn: (agent: Agent) => void
}

export function AgentSquadMemberCard({
  agent,
  hasRecentHeartbeat,
  formatLastSeen,
  wakeLabel,
  spawnLabel,
  onSelect,
  onWake,
  onSpawn,
}: AgentSquadMemberCardProps) {
  const modelName = formatModelName(agent.config)
  const taskStatsLine = buildTaskStatParts(agent.taskStats)
  const cardStyle = statusCardStyles[agent.status] || defaultCardStyle

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-lg cursor-pointer"
      onClick={() => onSelect(agent)}
    >
      <div className={`pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${cardStyle.edge}`} />

      {/* Header: avatar + name + status */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <AgentAvatar name={agent.name} size="md" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-foreground truncate">{agent.name}</h3>
              {(agent as any).source && (agent as any).source !== 'manual' && (
                <span className={`text-2xs px-1.5 py-0.5 rounded-full border ${
                  (agent as any).source === 'local'
                    ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                    : (agent as any).source === 'gateway'
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                      : 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                }`}>
                  {(agent as any).source}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {agent.role}{modelName && <> · <span className="font-mono text-muted-foreground/80">{modelName}</span></>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasRecentHeartbeat(agent) && (
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" title="Recent heartbeat" />
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize ${statusBadgeStyles[agent.status]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${cardStyle.dot}`} />
            {agent.status}
          </span>
        </div>
      </div>

      {/* Task stats — inline */}
      {taskStatsLine && (
        <div className="text-xs text-muted-foreground mb-2 pl-0.5">
          {taskStatsLine.map((part, i) => (
            <span key={part.label}>
              {i > 0 && <span className="mx-1 text-muted-foreground/40">·</span>}
              <span className={part.color || 'text-foreground/80'}>{part.count}</span>
              {' '}{part.label}
            </span>
          ))}
        </div>
      )}

      {/* Footer: last seen + actions */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
        <span className="text-[11px] text-muted-foreground/70">
          {formatLastSeen(agent.last_seen)}
        </span>
        <div className="flex gap-1">
          {agent.session_key ? (
            <Button
              onClick={(e) => { e.stopPropagation(); onWake(agent) }}
              size="xs"
              variant="ghost"
              className="h-6 px-2 text-xs text-cyan-300 hover:bg-cyan-500/15 hover:text-cyan-200"
              title="Wake agent via session"
            >
              {wakeLabel}
            </Button>
          ) : (
            <Button
              onClick={(e) => { e.stopPropagation(); onWake(agent) }}
              disabled={agent.status === 'idle'}
              size="xs"
              variant="ghost"
              className="h-6 px-2 text-xs"
            >
              {wakeLabel}
            </Button>
          )}
          <Button
            onClick={(e) => { e.stopPropagation(); onSpawn(agent) }}
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-xs text-blue-300 hover:bg-blue-500/15 hover:text-blue-200"
          >
            {spawnLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
