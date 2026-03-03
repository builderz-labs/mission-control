'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMissionControl, Agent } from '@/store'

type ViewMode = 'office' | 'org-chart'

interface Desk {
  agent: Agent
  row: number
  col: number
}

const statusGlow: Record<string, string> = {
  idle: 'shadow-green-500/40 border-green-500/60',
  busy: 'shadow-yellow-500/40 border-yellow-500/60',
  error: 'shadow-red-500/40 border-red-500/60',
  offline: 'shadow-gray-500/20 border-gray-600/40',
}

const statusDot: Record<string, string> = {
  idle: 'bg-green-500',
  busy: 'bg-yellow-500',
  error: 'bg-red-500',
  offline: 'bg-gray-500',
}

const statusLabel: Record<string, string> = {
  idle: 'Available',
  busy: 'Working',
  error: 'Error',
  offline: 'Away',
}

const statusEmoji: Record<string, string> = {
  idle: '☕',
  busy: '💻',
  error: '⚠️',
  offline: '💤',
}

function getInitials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function hashColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const colors = [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600',
    'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600',
    'bg-orange-600', 'bg-pink-600', 'bg-lime-600', 'bg-fuchsia-600',
  ]
  return colors[Math.abs(hash) % colors.length]
}

function formatLastSeen(ts?: number): string {
  if (!ts) return 'Never seen'
  const diff = Date.now() - ts * 1000
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function OfficePanel() {
  const { agents } = useMissionControl()
  const [localAgents, setLocalAgents] = useState<Agent[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('office')
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents')
      if (res.ok) {
        const data = await res.json()
        setLocalAgents(data.agents || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  useEffect(() => {
    const interval = setInterval(fetchAgents, 10000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  const displayAgents = agents.length > 0 ? agents : localAgents

  const counts = useMemo(() => {
    const c = { idle: 0, busy: 0, error: 0, offline: 0 }
    for (const a of displayAgents) c[a.status] = (c[a.status] || 0) + 1
    return c
  }, [displayAgents])

  const desks: Desk[] = useMemo(() => {
    const cols = Math.max(2, Math.ceil(Math.sqrt(displayAgents.length)))
    return displayAgents.map((agent, i) => ({
      agent,
      row: Math.floor(i / cols),
      col: i % cols,
    }))
  }, [displayAgents])

  const roleGroups = useMemo(() => {
    const groups = new Map<string, Agent[]>()
    for (const a of displayAgents) {
      const role = a.role || 'Unassigned'
      if (!groups.has(role)) groups.set(role, [])
      groups.get(role)!.push(a)
    }
    return groups
  }, [displayAgents])

  if (loading && displayAgents.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
        <span className="ml-3 text-muted-foreground">Loading office...</span>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Virtual Office</h1>
            <p className="text-muted-foreground mt-1">See your agents at work in real time</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground mr-4">
              {counts.busy > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />{counts.busy} working</span>}
              {counts.idle > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />{counts.idle} idle</span>}
              {counts.error > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />{counts.error} error</span>}
              {counts.offline > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" />{counts.offline} away</span>}
            </div>
            <div className="flex rounded-md overflow-hidden border border-border">
              <button
                onClick={() => setViewMode('office')}
                className={`px-3 py-1 text-sm transition-smooth ${viewMode === 'office' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
              >
                Office
              </button>
              <button
                onClick={() => setViewMode('org-chart')}
                className={`px-3 py-1 text-sm transition-smooth ${viewMode === 'org-chart' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-surface-2'}`}
              >
                Org Chart
              </button>
            </div>
            <button onClick={fetchAgents} className="px-3 py-1.5 text-sm bg-secondary text-muted-foreground rounded-md hover:bg-surface-2 transition-smooth">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {displayAgents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <div className="text-5xl mb-3">🏢</div>
          <p className="text-lg">The office is empty</p>
          <p className="text-sm mt-1">Add agents to see them appear here</p>
        </div>
      ) : viewMode === 'office' ? (
        <div className="relative">
          <div className="bg-gradient-to-br from-surface-1/50 to-card rounded-xl border border-border p-6 min-h-[400px]">
            <div className="absolute top-4 left-6 text-xs text-muted-foreground/50 uppercase tracking-widest font-medium">Main Floor</div>

            <div className="mt-6 grid gap-6" style={{ gridTemplateColumns: `repeat(${Math.max(2, Math.ceil(Math.sqrt(displayAgents.length)))}, minmax(180px, 1fr))` }}>
              {desks.map(({ agent }) => (
                <div
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={`relative group cursor-pointer rounded-xl border-2 p-4 transition-all duration-300 hover:scale-[1.03] hover:z-10 shadow-lg ${statusGlow[agent.status]}`}
                  style={{ background: 'var(--card)' }}
                >
                  <div className="absolute inset-x-3 bottom-0 h-1.5 bg-amber-900/20 rounded-t-sm" />

                  <div className="absolute -top-2 -right-2 text-lg" title={statusLabel[agent.status]}>
                    {statusEmoji[agent.status]}
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-12 h-12 rounded-full ${hashColor(agent.name)} flex items-center justify-center text-white font-bold text-sm shrink-0 ring-2 ring-offset-2 ring-offset-card ${agent.status === 'busy' ? 'ring-yellow-500 animate-pulse' : agent.status === 'idle' ? 'ring-green-500' : agent.status === 'error' ? 'ring-red-500' : 'ring-gray-600'}`}>
                      {getInitials(agent.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground text-sm truncate">{agent.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{agent.role}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot[agent.status]} ${agent.status === 'busy' ? 'animate-pulse' : ''}`} />
                      <span className="text-muted-foreground">{statusLabel[agent.status]}</span>
                    </span>
                    <span className="text-muted-foreground/60">{formatLastSeen(agent.last_seen)}</span>
                  </div>

                  {agent.last_activity && (
                    <div className="mt-2 text-[10px] text-muted-foreground/50 truncate italic">
                      {agent.last_activity}
                    </div>
                  )}

                  {agent.taskStats && agent.taskStats.in_progress > 0 && (
                    <div className="absolute -top-2 -left-2 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center text-[10px] font-bold text-black">
                      {agent.taskStats.in_progress}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 flex items-center gap-4 text-[10px] text-muted-foreground/30">
              <span>🪴</span>
              <div className="flex-1 border-t border-dashed border-border/30" />
              <span>☕ Break room</span>
              <div className="flex-1 border-t border-dashed border-border/30" />
              <span>🪴</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {[...roleGroups.entries()].map(([role, members]) => (
            <div key={role} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-6 bg-primary rounded-full" />
                <h3 className="font-semibold text-foreground">{role}</h3>
                <span className="text-xs text-muted-foreground ml-1">({members.length})</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {members.map(agent => (
                  <div
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all hover:scale-[1.02] ${statusGlow[agent.status]}`}
                    style={{ background: 'var(--card)' }}
                  >
                    <div className={`w-8 h-8 rounded-full ${hashColor(agent.name)} flex items-center justify-center text-white font-bold text-xs`}>
                      {getInitials(agent.name)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{agent.name}</div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDot[agent.status]}`} />
                        {statusLabel[agent.status]}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedAgent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedAgent(null)}>
          <div className="bg-card border border-border rounded-xl max-w-sm w-full p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-14 h-14 rounded-full ${hashColor(selectedAgent.name)} flex items-center justify-center text-white font-bold text-lg ring-2 ring-offset-2 ring-offset-card ${selectedAgent.status === 'busy' ? 'ring-yellow-500' : selectedAgent.status === 'idle' ? 'ring-green-500' : selectedAgent.status === 'error' ? 'ring-red-500' : 'ring-gray-600'}`}>
                  {getInitials(selectedAgent.name)}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-foreground">{selectedAgent.name}</h3>
                  <p className="text-sm text-muted-foreground">{selectedAgent.role}</p>
                </div>
              </div>
              <button onClick={() => setSelectedAgent(null)} className="text-muted-foreground hover:text-foreground text-xl">×</button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${statusDot[selectedAgent.status]}`} />
                <span className="font-medium text-foreground">{statusLabel[selectedAgent.status]}</span>
                <span className="text-muted-foreground ml-auto">{formatLastSeen(selectedAgent.last_seen)}</span>
              </div>

              {selectedAgent.last_activity && (
                <div className="bg-secondary rounded-lg p-3">
                  <span className="text-xs text-muted-foreground block mb-1">Current Activity</span>
                  <span className="text-foreground text-sm">{selectedAgent.last_activity}</span>
                </div>
              )}

              {selectedAgent.taskStats && (
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-foreground">{selectedAgent.taskStats.total}</div>
                    <div className="text-[10px] text-muted-foreground">Total</div>
                  </div>
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-blue-400">{selectedAgent.taskStats.assigned}</div>
                    <div className="text-[10px] text-muted-foreground">Assigned</div>
                  </div>
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-yellow-400">{selectedAgent.taskStats.in_progress}</div>
                    <div className="text-[10px] text-muted-foreground">Active</div>
                  </div>
                  <div className="text-center bg-secondary rounded-lg p-2">
                    <div className="text-lg font-bold text-green-400">{selectedAgent.taskStats.completed}</div>
                    <div className="text-[10px] text-muted-foreground">Done</div>
                  </div>
                </div>
              )}

              {selectedAgent.session_key && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Session:</span> <code className="font-mono">{selectedAgent.session_key}</code>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
