'use client'

import { useState, useCallback } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { useNavigateToPanel } from '@/lib/navigation'
import { AgentNode } from './cognitive-heatmap-agent-node'
import type { CognitiveLoadAgent, CognitiveLoadResponse } from '@/app/api/agents/cognitive-load/route'
import type { DashboardData } from '../widget-primitives'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WidgetState {
  readonly agents: CognitiveLoadAgent[]
  readonly loading: boolean
  readonly error: string | null
}

const INITIAL_STATE: WidgetState = { agents: [], loading: true, error: null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByDepartment(agents: CognitiveLoadAgent[]): Map<string, CognitiveLoadAgent[]> {
  return agents.reduce<Map<string, CognitiveLoadAgent[]>>((map, agent) => {
    const key = agent.department
    const existing = map.get(key) ?? []
    return new Map(map).set(key, [...existing, agent])
  }, new Map())
}

function levelOrder(level: string): number {
  if (level === 'critical') return 0
  if (level === 'warning')  return 1
  return 2
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-20 rounded bg-muted animate-pulse" />
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-6 rounded bg-muted animate-pulse" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main widget ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CognitiveHeatmapWidget({ data: _data }: { data: DashboardData }) {
  const navigateToPanel = useNavigateToPanel()
  const [state, setState] = useState<WidgetState>(INITIAL_STATE)

  const fetchLoad = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/cognitive-load', {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        setState(prev => ({ ...prev, loading: false, error: `Server error ${res.status}` }))
        return
      }
      const json: CognitiveLoadResponse = await res.json()
      setState({ agents: json.agents ?? [], loading: false, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      setState(prev => ({ ...prev, loading: false, error: message }))
    }
  }, [])

  useSmartPoll(fetchLoad, 30000)

  const { agents, loading, error } = state

  // Sort departments so highest-pressure departments appear first
  const grouped = groupByDepartment(agents)
  const sortedDepts = [...grouped.keys()].sort((a, b) => {
    const worstA = Math.max(...(grouped.get(a) ?? []).map(ag => ag.load.score))
    const worstB = Math.max(...(grouped.get(b) ?? []).map(ag => ag.load.score))
    return worstB - worstA
  })

  return (
    <div className="panel">
      <div className="panel-header">
        <h3 className="text-sm font-semibold">Agent Cognitive Load</h3>
        {!loading && !error && (
          <span className="text-2xs text-muted-foreground">{agents.length} agents</span>
        )}
      </div>
      <div className="panel-body">
        {loading && <SkeletonGrid />}

        {!loading && error && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p className="text-xs text-red-400">{error}</p>
            <button
              type="button"
              onClick={fetchLoad}
              className="text-2xs text-primary hover:text-primary/80 border border-border/50 rounded px-2 py-1 hover:bg-secondary transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && agents.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">No agents found — seed the database first.</p>
        )}

        {!loading && !error && agents.length > 0 && (
          <div className="space-y-3 overflow-y-auto max-h-[360px] pr-0.5">
            {sortedDepts.map((dept) => {
              const deptAgents = (grouped.get(dept) ?? []).slice().sort(
                (a, b) => levelOrder(a.load.level) - levelOrder(b.load.level)
              )
              return (
                <div key={dept}>
                  <div className="text-2xs uppercase tracking-wide text-muted-foreground mb-1 font-medium">
                    {dept}
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {deptAgents.map((agent) => (
                      <AgentNode key={agent.id} agent={agent} onNavigate={navigateToPanel} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
