'use client'

import { AgentAvatar } from '@/components/ui/agent-avatar'
import { FLEET_AGENT_NAMES } from '@/lib/fleet-agents'
import { useNavigateToPanel } from '@/lib/navigation'
import type { Agent } from '@/store'

export function FleetLogosStrip({ agents }: { agents: Agent[] }) {
  const navigate = useNavigateToPanel()
  const byName = new Map(agents.map((agent) => [agent.name, agent]))

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-xs font-semibold text-muted-foreground mb-2">Fleet</div>
      <div className="flex flex-wrap gap-2">
        {FLEET_AGENT_NAMES.map((name) => {
          const agent = byName.get(name)
          return (
            <button
              key={name}
              type="button"
              onClick={() => navigate('agents')}
              className="flex items-center gap-2 rounded-md border border-border/80 bg-secondary/40 px-2.5 py-1.5 text-left cursor-pointer hover:border-primary/40 transition-colors duration-200"
            >
              <AgentAvatar name={name} size="sm" />
              <span className="text-xs font-medium text-foreground">{name}</span>
              <span className="text-2xs text-muted-foreground">{agent?.status || 'offline'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
