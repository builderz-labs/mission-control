'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface AgentActivity {
  id: number
  type: string
  entity_type: string
  entity_id: number
  actor: string
  description: string
  data?: any
  created_at: number
  entity?: any
}

interface SessionInfo {
  id: string
  key: string
  kind: string
  age: string
  model: string
  tokens: string
  active: boolean
}

const typeColors: Record<string, string> = {
  agent_status_change: 'text-yellow-400',
  task_created: 'text-green-400',
  task_updated: 'text-blue-400',
  task_deleted: 'text-red-400',
  comment_added: 'text-purple-400',
  agent_created: 'text-cyan-400',
  standup_generated: 'text-orange-400',
  mention: 'text-pink-400',
  assignment: 'text-indigo-400',
}

const typeIcons: Record<string, string> = {
  agent_status_change: '~',
  task_created: '+',
  task_updated: '~',
  task_deleted: 'x',
  comment_added: '#',
  agent_created: '@',
  standup_generated: '!',
  mention: '>',
  assignment: '=',
}

export function AgentHistoryPanel() {
  const { agents } = useMissionControl()
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const limit = 50

  // Auto-select first agent
  useEffect(() => {
    if (!selectedAgent && agents.length > 0) {
      setSelectedAgent(agents[0].name)
    }
  }, [agents, selectedAgent])

  const fetchActivities = useCallback(async () => {
    if (!selectedAgent) return
    setLoading(true)
    try {
      const params = new URLSearchParams({
        actor: selectedAgent,
        limit: limit.toString(),
        offset: (page * limit).toString(),
      })
      const res = await fetch(`/api/activities?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setActivities(data.activities || [])
      setTotal(data.total || 0)
    } catch { /* silent */ } finally {
      setLoading(false)
    }
  }, [selectedAgent, page])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { fetchActivities() }, [fetchActivities])
  useEffect(() => { fetchSessions() }, [fetchSessions])
  useSmartPoll(fetchActivities, 30000, { pauseWhenDisconnected: true })

  const agentSessions = sessions.filter(s => s.key.includes(selectedAgent))
  const selectedAgentData = agents.find(a => a.name === selectedAgent)
  const totalPages = Math.ceil(total / limit)

  function formatTime(ts: number) {
    const d = new Date(ts * 1000)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  function formatRelative(ts: number) {
    const diff = Math.floor(Date.now() / 1000) - ts
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  // Group activities by day
  const groupedByDay: Record<string, AgentActivity[]> = {}
  for (const act of activities) {
    const day = new Date(act.created_at * 1000).toLocaleDateString(undefined, {
      weekday: 'long', month: 'short', day: 'numeric',
    })
    if (!groupedByDay[day]) groupedByDay[day] = []
    groupedByDay[day].push(act)
  }

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Agent History</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} event{total !== 1 ? 's' : ''} for {selectedAgent || 'no agent selected'}
          </p>
        </div>
      </div>

      {/* Agent selector */}
      <div className="flex gap-2 flex-wrap">
        {agents.map(a => (
          <button
            key={a.name}
            onClick={() => { setSelectedAgent(a.name); setPage(0) }}
            className={`h-8 px-3 rounded-md text-xs font-medium transition-smooth flex items-center gap-1.5 ${
              selectedAgent === a.name
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              a.status === 'busy' ? 'bg-green-500' :
              a.status === 'idle' ? 'bg-yellow-500' :
              a.status === 'error' ? 'bg-red-500' :
              'bg-muted-foreground/30'
            }`} />
            {a.name}
          </button>
        ))}
      </div>

      {selectedAgent && (
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Agent info card */}
          <div className="lg:col-span-1 space-y-3">
            {selectedAgentData && (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">
                      {selectedAgentData.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{selectedAgentData.name}</p>
                    <p className="text-xs text-muted-foreground">{selectedAgentData.role}</p>
                  </div>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className={`font-medium ${
                      selectedAgentData.status === 'busy' ? 'text-green-400' :
                      selectedAgentData.status === 'idle' ? 'text-yellow-400' :
                      selectedAgentData.status === 'error' ? 'text-red-400' :
                      'text-muted-foreground'
                    }`}>{selectedAgentData.status}</span>
                  </div>
                  {selectedAgentData.last_seen && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last seen</span>
                      <span className="text-foreground font-mono-tight">{formatRelative(selectedAgentData.last_seen)}</span>
                    </div>
                  )}
                  {selectedAgentData.last_activity && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last action</span>
                      <span className="text-foreground truncate max-w-[140px]" title={selectedAgentData.last_activity}>
                        {selectedAgentData.last_activity}
                      </span>
                    </div>
                  )}
                  {selectedAgentData.taskStats && (
                    <>
                      <div className="border-t border-border pt-2 mt-2" />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tasks assigned</span>
                        <span className="text-foreground">{selectedAgentData.taskStats.assigned}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">In progress</span>
                        <span className="text-foreground">{selectedAgentData.taskStats.in_progress}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Completed</span>
                        <span className="text-foreground">{selectedAgentData.taskStats.completed}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Active sessions for this agent */}
            {agentSessions.length > 0 && (
              <div className="rounded-lg border border-border p-4">
                <h4 className="text-xs font-semibold text-foreground mb-2">Active Sessions</h4>
                <div className="space-y-2">
                  {agentSessions.map(s => (
                    <div key={s.id} className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
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
            )}
          </div>

          {/* Activity timeline */}
          <div className="lg:col-span-2">
            {loading ? (
              <div className="space-y-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-12 rounded-lg shimmer" />
                ))}
              </div>
            ) : activities.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-xs text-muted-foreground">No activity recorded for {selectedAgent}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedByDay).map(([day, dayActivities]) => (
                  <div key={day}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-muted-foreground">{day}</span>
                      <span className="flex-1 h-px bg-border" />
                      <span className="text-2xs text-muted-foreground">{dayActivities.length} events</span>
                    </div>
                    <div className="space-y-1 pl-2 border-l-2 border-border/50">
                      {dayActivities.map(act => (
                        <div key={act.id} className="flex items-start gap-2.5 pl-3 py-1.5 hover:bg-secondary/30 rounded-r-lg transition-smooth relative">
                          {/* Timeline dot */}
                          <span className={`absolute -left-[5px] top-3 w-2 h-2 rounded-full bg-card border-2 ${
                            act.type === 'agent_status_change' ? 'border-yellow-400' :
                            act.type.startsWith('task') ? 'border-blue-400' :
                            'border-muted-foreground'
                          }`} />

                          {/* Icon */}
                          <span className={`w-5 h-5 rounded bg-secondary flex items-center justify-center text-2xs font-mono font-bold shrink-0 ${typeColors[act.type] || 'text-muted-foreground'}`}>
                            {typeIcons[act.type] || '?'}
                          </span>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground">{act.description}</p>
                            {act.entity && act.entity.title && (
                              <p className="text-2xs text-muted-foreground mt-0.5 truncate">
                                {act.entity.type === 'task' ? `Task: ${act.entity.title}` : act.entity.title}
                              </p>
                            )}
                          </div>

                          {/* Time */}
                          <span className="text-2xs text-muted-foreground font-mono-tight shrink-0">
                            {new Date(act.created_at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-smooth disabled:opacity-30"
                    >
                      Newer
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Page {page + 1} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="h-7 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-smooth disabled:opacity-30"
                    >
                      Older
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
