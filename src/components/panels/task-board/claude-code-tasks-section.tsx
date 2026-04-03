'use client'

import { useState, useEffect } from 'react'

type TaskStatus = 'completed' | 'in_progress' | 'blocked' | string

function statusColor(s: TaskStatus): string {
  if (s === 'completed') return 'text-green-400'
  if (s === 'in_progress') return 'text-blue-400'
  if (s === 'blocked') return 'text-red-400'
  return 'text-muted-foreground'
}

/** Read-only bridge to Claude Code team task lists in ~/.claude/tasks/. */
export function ClaudeCodeTasksSection() {
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{ teams: any[]; tasks: any[] }>({ teams: [], tasks: [] })
  const [loaded, setLoaded] = useState(false)

  // Lazy-load on first expand
  useEffect(() => {
    if (!expanded || loaded) return
    fetch('/api/claude-tasks')
      .then(r => r.json())
      .then(d => { setData(d); setLoaded(true) })
      .catch(() => setLoaded(true))
  }, [expanded, loaded])

  const tasksByTeam = data.tasks.reduce<Record<string, any[]>>((acc, t) => {
    const list = acc[t.teamName] ?? []
    return { ...acc, [t.teamName]: [...list, t] }
  }, {})

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-card hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">Claude Code Tasks</span>
          {data.tasks.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">
              {data.tasks.length}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-xs">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>

      {expanded && (
        <div className="p-4 border-t border-border space-y-4">
          {!loaded ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : data.tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              <p className="font-medium">No team tasks found</p>
              <p className="text-xs mt-1 text-muted-foreground/70">
                Tasks appear here when Claude Code agents work with team task lists in ~/.claude/tasks/
              </p>
            </div>
          ) : (
            Object.entries(tasksByTeam).map(([team, tasks]) => {
              const teamData = data.teams.find(t => t.name === team)
              return (
                <div key={team}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-medium text-foreground">{team}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                      {tasks.length} tasks
                    </span>
                    {teamData?.members?.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {teamData.members.map((m: any) => m.name).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {tasks.map((task: any) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 px-3 py-2 rounded bg-surface-1 border border-border text-sm"
                      >
                        <span className={`text-[10px] font-mono ${statusColor(task.status)}`}>
                          {task.status}
                        </span>
                        <span className="text-foreground flex-1 truncate">{task.subject}</span>
                        {task.owner && (
                          <span className="text-[10px] text-muted-foreground">{task.owner}</span>
                        )}
                        {task.blockedBy?.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                            blocked
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
