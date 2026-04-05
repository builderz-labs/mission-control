'use client'

import { useTranslations } from 'next-intl'
import { useState, useEffect } from 'react'

export function ClaudeCodeTeamsSection(): React.JSX.Element {
  const t = useTranslations('cronManagement')
  const [expanded, setExpanded] = useState(false)
  const [data, setData] = useState<{ teams: any[]; tasks: any[] }>({ teams: [], tasks: [] })
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!expanded || loaded) return
    fetch('/api/claude-tasks', { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [expanded, loaded])

  const statusCounts = data.tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t('claudeCodeTeams')}</h2>
          {data.teams.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400">
              {t('teamsCount', { count: data.teams.length })}
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-sm">
          {expanded ? t('collapse') : t('expand')}
        </span>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-border pt-4 space-y-4">
          {!loaded ? (
            <div className="text-sm text-muted-foreground">{t('loading')}</div>
          ) : data.teams.length === 0 ? (
            <div className="text-sm text-muted-foreground">{t('noClaudeCodeTeams')}</div>
          ) : (
            <>
              {Object.keys(statusCounts).length > 0 && (
                <div className="flex gap-3">
                  {Object.entries(statusCounts).map(([status, count]) => (
                    <span
                      key={status}
                      className={`text-xs px-2 py-1 rounded ${
                        status === 'completed'
                          ? 'bg-green-500/20 text-green-400'
                          : status === 'in_progress'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {status}: {count}
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-3">
                {data.teams.map((team) => (
                  <div key={team.name} className="border border-border rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-foreground">{team.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('membersCount', { count: team.members?.length || 0 })}
                      </span>
                      {team.description && (
                        <span className="text-xs text-muted-foreground truncate">
                          {team.description}
                        </span>
                      )}
                    </div>
                    {team.members?.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {team.members.map((m: any) => (
                          <span
                            key={m.agentId}
                            className="text-[11px] px-2 py-0.5 rounded bg-secondary text-foreground"
                          >
                            {m.name}{' '}
                            <span className="text-muted-foreground">
                              ({m.model || m.agentType})
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
