'use client'

import { cn } from '@/lib/utils'
import { DESIGN_AGENTS, PHASES } from './marketing-constants'
import { IconSparkles } from './marketing-icons'

export function MarketingAgentsTab() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Pipeline overview */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Design Workflow Pipeline
        </h3>
        <div className="flex items-center gap-1">
          {PHASES.map((phase, i) => {
            const count = DESIGN_AGENTS.filter(a => a.phase === phase.id).length
            return (
              <div key={phase.id} className="flex items-center gap-1 flex-1">
                <div className="flex-1 rounded-xl p-3 border border-border bg-surface-1/50 text-center">
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: phase.color }}
                  >
                    {phase.label}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {count} agent{count !== 1 ? 's' : ''}
                  </div>
                </div>
                {i < PHASES.length - 1 && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/30 shrink-0">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Agent cards grouped by phase */}
      {PHASES.map(phase => {
        const agents = DESIGN_AGENTS.filter(a => a.phase === phase.id)
        if (agents.length === 0) return null
        return (
          <div key={phase.id}>
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: phase.color }}>
              {phase.label} Phase
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {agents.map(agent => (
                <AgentCard key={agent.id} agent={typeof agent === 'object' ? agent : agent} phase={phase} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AgentCard({
  agent,
  phase,
}: {
  agent: typeof DESIGN_AGENTS[0]
  phase: typeof PHASES[0]
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 hover:border-[hsl(var(--void-cyan))]/20 transition-all group">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
          style={{
            background: `color-mix(in srgb, ${agent.color} 12%, transparent)`,
            borderColor: `color-mix(in srgb, ${agent.color} 25%, transparent)`,
            color: agent.color,
          }}
        >
          <IconSparkles />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">{agent.name}</h4>
            <span className="text-[10px] font-mono text-muted-foreground opacity-60">{agent.handle}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{agent.role}</p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {agent.outputs.map(out => (
              <span
                key={out}
                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-muted/50 text-muted-foreground border border-border"
              >
                {out}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {agent.trigger}
            </code>
            <span
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: phase.color }}
            >
              {phase.label}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
