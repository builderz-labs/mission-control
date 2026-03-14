'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

interface Activity {
  id: number
  type: string
  entity_type: string
  entity_id: number
  actor: string
  description: string
  data?: any
  created_at: number
  entity?: {
    type: string
    id?: number
    title?: string
    name?: string
    status?: string
    content_preview?: string
    task_title?: string
  }
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

const activityIcons: Record<string, string> = {
  task_created: '+',
  task_updated: '~',
  task_deleted: 'x',
  comment_added: '#',
  agent_created: '@',
  agent_status_change: '~',
  standup_generated: '!',
  mention: '>',
  assignment: '=',
}

const activityColors: Record<string, string> = {
  task_created: 'text-green-400',
  task_updated: 'text-blue-400',
  task_deleted: 'text-red-400',
  comment_added: 'text-purple-400',
  agent_created: 'text-cyan-400',
  agent_status_change: 'text-yellow-400',
  standup_generated: 'text-orange-400',
  mention: 'text-pink-400',
  assignment: 'text-indigo-400',
}

function formatRelativeTime(timestamp: number) {
  const now = Date.now()
  const diffMs = now - timestamp * 1000
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

function groupByDay(activities: Activity[]): Record<string, Activity[]> {
  const groups: Record<string, Activity[]> = {}
  for (const act of activities) {
    const day = new Date(act.created_at * 1000).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
    if (!groups[day]) groups[day] = []
    groups[day].push(act)
  }
  return groups
}

// ── Activity row (flat feed) ────────────────────
function ActivityRow({ activity }: { activity: Activity }) {
  const t = useTranslations('activityFeed')
  return (
    <div className="bg-card rounded-lg p-3 border-l-2 border-border hover:bg-surface-1 transition-smooth">
      <div className="flex items-start gap-3">
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
            activityColors[activity.type]
              ?.replace('text-', 'bg-')
              .replace('-400', '-500/15') || 'bg-surface-2'
          } ${activityColors[activity.type] || 'text-muted-foreground'}`}
        >
          {activityIcons[activity.type] || '•'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-foreground text-sm">
                <span className="font-medium text-primary">{activity.actor}</span>{' '}
                <span className={activityColors[activity.type] || 'text-muted-foreground'}>
                  {activity.description}
                </span>
              </p>

              {activity.entity && (
                <div className="mt-2 p-2 bg-surface-1 rounded-md text-xs border border-border/50">
                  {activity.entity.type === 'task' && (
                    <div>
                      <span className="text-muted-foreground">{t('entityTask')}</span>
                      <span className="text-foreground ml-1">{activity.entity.title}</span>
                      {activity.entity.status && (
                        <span className="ml-2 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
                          {activity.entity.status}
                        </span>
                      )}
                    </div>
                  )}
                  {activity.entity.type === 'comment' && (
                    <div>
                      <span className="text-muted-foreground">{t('entityCommentOn')}</span>
                      <span className="text-foreground ml-1">{activity.entity.task_title}</span>
                      {activity.entity.content_preview && (
                        <div className="mt-1 text-muted-foreground/70 italic">
                          &quot;{activity.entity.content_preview}...&quot;
                        </div>
                      )}
                    </div>
                  )}
                  {activity.entity.type === 'agent' && (
                    <div>
                      <span className="text-muted-foreground">{t('entityAgent')}</span>
                      <span className="text-foreground ml-1">{activity.entity.name}</span>
                      {activity.entity.status && (
                        <span className="ml-2 px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded text-[10px]">
                          {activity.entity.status}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {activity.data && Object.keys(activity.data).length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground">
                    {t('showDetails')}
                  </summary>
                  <pre className="mt-1 text-xs text-muted-foreground bg-surface-1 p-2 rounded-md overflow-auto max-h-32 border border-border/50">
                    {JSON.stringify(activity.data, null, 2)}
                  </pre>
                </details>
              )}
            </div>

            <div className="flex-shrink-0 text-[10px] text-muted-foreground/50">
              {formatRelativeTime(activity.created_at)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Timeline row (agent-grouped view) ───────────
function TimelineRow({ activity }: { activity: Activity }) {
  return (
    <div className="flex items-start gap-2.5 pl-3 py-1.5 hover:bg-secondary/30 rounded-r-lg transition-smooth relative">
      <span
        className={`absolute -left-[5px] top-3 w-2 h-2 rounded-full bg-card border-2 ${
          activity.type === 'agent_status_change'
            ? 'border-yellow-400'
            : activity.type.startsWith('task')
              ? 'border-blue-400'
              : 'border-muted-foreground'
        }`}
      />
      <span
        className={`w-5 h-5 rounded bg-secondary flex items-center justify-center text-2xs font-mono font-bold shrink-0 ${activityColors[activity.type] || 'text-muted-foreground'}`}
      >
        {activityIcons[activity.type] || '?'}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground">{activity.description}</p>
        {activity.entity?.title && (
          <p className="text-2xs text-muted-foreground mt-0.5 truncate">
            {activity.entity.type === 'task' ? `${activity.entity.title}` : activity.entity.title}
          </p>
        )}
      </div>
      <span className="text-2xs text-muted-foreground font-mono-tight shrink-0">
        {new Date(activity.created_at * 1000).toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        })}
      </span>
    </div>
  )
}

// ── Main Component ──────────────────────────────
export function ActivityFeedPanel() {
  const t = useTranslations('activityFeed')
  const { agents } = useMissionControl()

  const [activities, setActivities] = useState<Activity[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [lastRefresh, setLastRefresh] = useState(Date.now())

  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [filter, setFilter] = useState({ type: '', limit: 50 })

  const limit = filter.limit
  const isAgentView = selectedAgent !== ''

  // ── Fetch activities ──────────────────────────
  const fetchActivities = useCallback(
    async (since?: number) => {
      try {
        if (!since) setLoading(true)
        setError(null)

        const params = new URLSearchParams()
        if (selectedAgent) params.append('actor', selectedAgent)
        if (filter.type) params.append('type', filter.type)
        params.append('limit', limit.toString())
        if (isAgentView) params.append('offset', (page * limit).toString())
        if (since && !isAgentView) params.append('since', Math.floor(since / 1000).toString())

        const response = await fetch(`/api/activities?${params}`)
        if (!response.ok) throw new Error('Failed to fetch activities')
        const data = await response.json()

        if (since && !isAgentView) {
          setActivities((prev) => {
            const newActivities = data.activities || []
            const existingIds = new Set(prev.map((a: Activity) => a.id))
            const uniqueNew = newActivities.filter((a: Activity) => !existingIds.has(a.id))
            return [...uniqueNew, ...prev].slice(0, limit)
          })
        } else {
          setActivities(data.activities || [])
        }

        setTotal(data.total || 0)
        setLastRefresh(Date.now())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    },
    [selectedAgent, filter.type, limit, page, isAgentView],
  )

  const lastRefreshRef = useRef(lastRefresh)
  useEffect(() => {
    lastRefreshRef.current = lastRefresh
  }, [lastRefresh])

  useEffect(() => {
    fetchActivities()
  }, [fetchActivities])

  const pollActivities = useCallback(() => {
    fetchActivities(isAgentView ? undefined : lastRefreshRef.current)
  }, [fetchActivities, isAgentView])

  useSmartPoll(pollActivities, 30000, { enabled: autoRefresh, pauseWhenSseConnected: true })

  // ── Fetch sessions (for agent sidebar) ────────
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch {
      /* silent */
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // ── Derived data ──────────────────────────────
  const activityTypes = Array.from(new Set(activities.map((a) => a.type))).sort()
  const agentSessions = sessions.filter((s) => selectedAgent && s.key.includes(selectedAgent))
  const selectedAgentData = agents.find((a) => a.name === selectedAgent)
  const totalPages = Math.ceil(total / limit)
  const groupedByDay = isAgentView ? groupByDay(activities) : {}

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
          <div
            className={`w-2.5 h-2.5 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`}
          />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setAutoRefresh(!autoRefresh)}
            variant={autoRefresh ? 'success' : 'secondary'}
            size="sm"
          >
            {autoRefresh ? t('live') : t('paused')}
          </Button>
          <Button onClick={() => fetchActivities()} size="sm">
            {t('refresh')}
          </Button>
        </div>
      </div>

      {/* Filters + Agent Selector */}
      <div className="p-4 border-b border-border bg-surface-1 flex-shrink-0">
        <div className="flex gap-4 flex-wrap items-end">
          {/* Agent filter */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('filterAgent')}</label>
            <div className="flex gap-1 flex-wrap">
              <Button
                onClick={() => {
                  setSelectedAgent('')
                  setPage(0)
                }}
                variant={selectedAgent === '' ? 'default' : 'secondary'}
                size="xs"
              >
                {t('filterAll')}
              </Button>
              {agents.map((a) => (
                <Button
                  key={a.name}
                  onClick={() => {
                    setSelectedAgent(a.name)
                    setPage(0)
                  }}
                  variant={selectedAgent === a.name ? 'default' : 'secondary'}
                  size="xs"
                  className="flex items-center gap-1"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      a.status === 'busy'
                        ? 'bg-green-500'
                        : a.status === 'idle'
                          ? 'bg-yellow-500'
                          : a.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-muted-foreground/30'
                    }`}
                  />
                  {a.name}
                </Button>
              ))}
            </div>
          </div>

          {/* Type filter */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('filterType')}</label>
            <select
              value={filter.type}
              onChange={(e) => setFilter((prev) => ({ ...prev, type: e.target.value }))}
              className="bg-surface-2 text-foreground text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 border border-border"
            >
              <option value="">{t('allTypes')}</option>
              {activityTypes.map((type) => (
                <option key={type} value={type}>
                  {activityIcons[type] || '•'} {type.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Limit */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t('filterLimit')}</label>
            <select
              value={filter.limit}
              onChange={(e) => setFilter((prev) => ({ ...prev, limit: parseInt(e.target.value) }))}
              className="bg-surface-2 text-foreground text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/50 border border-border"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <Button
            onClick={() => setError(null)}
            variant="ghost"
            size="icon-sm"
            className="text-red-400/60 hover:text-red-400 ml-2"
          >
            x
          </Button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && activities.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader variant="inline" label={t('loadingActivities')} />
          </div>
        ) : activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/50">
            <svg
              width="24"
              height="24"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="mb-2"
            >
              <path d="M2 4h12M2 8h8M2 12h10" />
            </svg>
            <p className="text-sm">{t('noActivities')}</p>
            <p className="text-xs mt-1">
              {selectedAgent ? t('noActivityForAgent', { agent: selectedAgent }) : t('tryAdjustingFilters')}
            </p>
          </div>
        ) : isAgentView ? (
          /* ── Agent-grouped view with sidebar ─── */
          <div className="grid lg:grid-cols-3 gap-4">
            {/* Agent info sidebar */}
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
                      <span className="text-muted-foreground">{t('agentStatus')}</span>
                      <span
                        className={`font-medium ${
                          selectedAgentData.status === 'busy'
                            ? 'text-green-400'
                            : selectedAgentData.status === 'idle'
                              ? 'text-yellow-400'
                              : selectedAgentData.status === 'error'
                                ? 'text-red-400'
                                : 'text-muted-foreground'
                        }`}
                      >
                        {selectedAgentData.status}
                      </span>
                    </div>
                    {selectedAgentData.last_seen && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('lastSeen')}</span>
                        <span className="text-foreground font-mono-tight">
                          {formatRelativeTime(selectedAgentData.last_seen)}
                        </span>
                      </div>
                    )}
                    {selectedAgentData.last_activity && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('lastAction')}</span>
                        <span
                          className="text-foreground truncate max-w-[140px]"
                          title={selectedAgentData.last_activity}
                        >
                          {selectedAgentData.last_activity}
                        </span>
                      </div>
                    )}
                    {selectedAgentData.taskStats && (
                      <>
                        <div className="border-t border-border pt-2 mt-2" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t('tasksAssigned')}</span>
                          <span className="text-foreground">{selectedAgentData.taskStats.assigned}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t('inProgress')}</span>
                          <span className="text-foreground">{selectedAgentData.taskStats.in_progress}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t('completed')}</span>
                          <span className="text-foreground">{selectedAgentData.taskStats.completed}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {agentSessions.length > 0 && (
                <div className="rounded-lg border border-border p-4">
                  <h4 className="text-xs font-semibold text-foreground mb-2">{t('activeSessions')}</h4>
                  <div className="space-y-2">
                    {agentSessions.map((s) => (
                      <div key={s.id} className="text-xs space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${s.active ? 'bg-green-500' : 'bg-muted-foreground/30'}`}
                          />
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

            {/* Day-grouped timeline */}
            <div className="lg:col-span-2">
              <div className="space-y-4">
                {Object.entries(groupedByDay).map(([day, dayActivities]) => (
                  <div key={day}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-muted-foreground">{day}</span>
                      <span className="flex-1 h-px bg-border" />
                      <span className="text-2xs text-muted-foreground">{t('events', { count: dayActivities.length })}</span>
                    </div>
                    <div className="space-y-1 pl-2 border-l-2 border-border/50">
                      {dayActivities.map((act) => (
                        <TimelineRow key={act.id} activity={act} />
                      ))}
                    </div>
                  </div>
                ))}

                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      variant="ghost"
                      size="xs"
                    >
                      {t('newer')}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {t('pageOf', { page: page + 1, total: totalPages })}
                    </span>
                    <Button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      variant="ghost"
                      size="xs"
                    >
                      {t('older')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ── Flat feed (all agents) ──────── */
          <div className="space-y-2">
            {activities.map((activity, index) => (
              <ActivityRow key={`${activity.id}-${index}`} activity={activity} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border p-3 bg-surface-1 text-xs text-muted-foreground flex-shrink-0">
        <div className="flex justify-between items-center">
          <span>
            {isAgentView
              ? t('footerAgentEvents', { total, agent: selectedAgent })
              : t('footerShowing', { count: activities.length, filtered: filter.type ? ` ${t('filtered')}` : '' })}
          </span>
          <span>{t('lastUpdated', { time: new Date(lastRefresh).toLocaleTimeString() })}</span>
        </div>
      </div>
    </div>
  )
}
