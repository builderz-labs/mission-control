'use client'

import type { CognitiveLoadAgent } from '@/app/api/agents/cognitive-load/route'

interface AgentNodeProps {
  readonly agent: CognitiveLoadAgent
  readonly onNavigate: (panel: string) => void
}

const LEVEL_DOT: Record<string, string> = {
  healthy:  'bg-green-500',
  warning:  'bg-amber-400',
  critical: 'bg-red-500',
}

const LEVEL_BADGE: Record<string, string> = {
  healthy:  'bg-green-500/10 text-green-400',
  warning:  'bg-amber-400/10 text-amber-400',
  critical: 'bg-red-500/10 text-red-400',
}

export function AgentNode({ agent, onNavigate }: AgentNodeProps) {
  const { load } = agent
  const dotClass   = LEVEL_DOT[load.level]   ?? LEVEL_DOT.healthy
  const badgeClass = LEVEL_BADGE[load.level] ?? LEVEL_BADGE.healthy

  return (
    <button
      type="button"
      onClick={() => onNavigate('agents')}
      title={`${agent.name} — score ${load.score} (${load.level})\nActive: ${load.activeTasks} | Pending: ${load.pendingTasks} | Err rate: ${Math.round(load.errorRate * 100)}%`}
      className="flex items-center gap-1.5 rounded border border-border/50 bg-card/60 px-2 py-1 text-left hover:border-primary/40 hover:bg-secondary/50 transition-colors w-full min-w-0"
    >
      <span className={`shrink-0 w-2 h-2 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="truncate text-2xs text-foreground/80 flex-1 min-w-0">{agent.name}</span>
      <span className={`shrink-0 text-2xs font-mono px-1 rounded ${badgeClass}`}>{load.score}</span>
    </button>
  )
}
