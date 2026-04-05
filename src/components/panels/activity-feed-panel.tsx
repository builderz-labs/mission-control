'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Loader } from '@/components/ui/loader'
import { useMissionControl } from '@/store'
import { useSmartPoll } from '@/lib/use-smart-poll'

import {
  Activity,
  SessionInfo,
  FeedFilter,
  groupByDay,
} from './activity-feed-panel-types'
import type { Agent } from '@/store/slices/agent-slice'
import { ActivityRow, TimelineRow } from './activity-feed-item'
import { ActivityFeedFilters } from './activity-feed-filters'
import { ActivityFeedAgentSidebar } from './activity-feed-agent-sidebar'

// ── Data fetching ────────────────────────────────────────────────────────────

interface FetchActivitiesParams {
  readonly selectedAgent: string
  readonly filter: FeedFilter
  readonly page: number
  readonly isAgentView: boolean
  readonly since?: number
}

async function fetchActivitiesFromApi(
  params: FetchActivitiesParams,
): Promise<{ activities: Activity[]; total: number }> {
  const { selectedAgent, filter, page, isAgentView, since } = params
  const qs = new URLSearchParams()
  if (selectedAgent) qs.append('actor', selectedAgent)
  if (filter.type) qs.append('type', filter.type)
  qs.append('limit', filter.limit.toString())
  if (isAgentView) qs.append('offset', (page * filter.limit).toString())
  if (since && !isAgentView) qs.append('since', Math.floor(since / 1000).toString())

  const res = await fetch(`/api/activities?${qs}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('Failed to fetch activities')
  const data = await res.json()
  return { activities: data.activities ?? [], total: data.total ?? 0 }
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ActivityFeedPanel(): React.JSX.Element {
  const t = useTranslations('activityFeed')
  const { agents, activities: sseActivities, connection } = useMissionControl()

  const [activities, setActivities] = useState<Activity[]>([])
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [lastRefresh, setLastRefresh] = useState(Date.now())
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [filter, setFilter] = useState<FeedFilter>({ type: '', limit: 50 })

  const isAgentView = selectedAgent !== ''
  const totalPages = Math.ceil(total / filter.limit)
  const activityTypes = Array.from(new Set(activities.map((a) => a.type))).sort()
  const agentSessions = sessions.filter((s) => selectedAgent && s.key.includes(selectedAgent))
  const selectedAgentData = agents.find((a) => a.name === selectedAgent)
  const groupedByDay = isAgentView ? groupByDay(activities) : {}

  // Keep a stable ref to lastRefresh so the poll callback never re-creates
  const lastRefreshRef = useRef(lastRefresh)
  useEffect(() => { lastRefreshRef.current = lastRefresh }, [lastRefresh])

  const fetchActivities = useCallback(async (since?: number): Promise<void> => {
    try {
      if (!since) setLoading(true)
      setError(null)
      const result = await fetchActivitiesFromApi({
        selectedAgent, filter, page, isAgentView, since,
      })
      if (since && !isAgentView) {
        setActivities((prev) => {
          const existingIds = new Set(prev.map((a) => a.id))
          const uniqueNew = result.activities.filter((a) => !existingIds.has(a.id))
          return [...uniqueNew, ...prev].slice(0, filter.limit)
        })
      } else {
        setActivities(result.activities)
      }
      setTotal(result.total)
      setLastRefresh(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }, [selectedAgent, filter, page, isAgentView])

  useEffect(() => { fetchActivities() }, [fetchActivities])

  const pollActivities = useCallback((): void => {
    fetchActivities(isAgentView ? undefined : lastRefreshRef.current)
  }, [fetchActivities, isAgentView])

  useSmartPoll(pollActivities, 30000, { enabled: autoRefresh, pauseWhenSseConnected: true })

  // Merge SSE-delivered activities when polling is paused
  const prevSseCountRef = useRef(sseActivities.length)
  useEffect(() => {
    if (!connection.sseConnected) return
    if (sseActivities.length <= prevSseCountRef.current) {
      prevSseCountRef.current = sseActivities.length
      return
    }
    const newCount = sseActivities.length - prevSseCountRef.current
    const incoming = sseActivities.slice(0, newCount)
    prevSseCountRef.current = sseActivities.length

    setActivities((prev) => {
      const existingIds = new Set(prev.map((a) => a.id))
      const uniqueNew = incoming.filter((a) => a?.id && !existingIds.has(a.id))
      if (uniqueNew.length === 0) return prev
      const filtered = uniqueNew.filter((a) => {
        if (selectedAgent && a?.actor !== selectedAgent) return false
        if (filter.type && a?.type !== filter.type) return false
        return true
      })
      if (filtered.length === 0) return prev
      return [...filtered, ...prev].slice(0, filter.limit)
    })
    setLastRefresh(Date.now())
  }, [sseActivities, connection.sseConnected, selectedAgent, filter.type, filter.limit])

  const fetchSessions = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/sessions', { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch { /* silent — sessions are optional UI decoration */ }
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  function handleSelectAgent(agent: string): void {
    setSelectedAgent(agent)
    setPage(0)
  }

  return (
    <div className="h-full flex flex-col">
      <FeedHeader
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh((v) => !v)}
        onRefresh={() => fetchActivities()}
      />

      <ActivityFeedFilters
        agents={agents}
        selectedAgent={selectedAgent}
        filter={filter}
        activityTypes={activityTypes}
        onSelectAgent={handleSelectAgent}
        onFilterChange={setFilter}
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="flex-1 overflow-y-auto p-4">
        {loading && activities.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <Loader variant="inline" label={t('loadingActivities')} />
          </div>
        ) : activities.length === 0 ? (
          <EmptyState selectedAgent={selectedAgent} />
        ) : isAgentView ? (
          <AgentView
            groupedByDay={groupedByDay}
            agentData={selectedAgentData}
            sessions={agentSessions}
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        ) : (
          <div className="space-y-2">
            {activities.map((activity, index) => (
              <ActivityRow key={`${activity.id}-${index}`} activity={activity} />
            ))}
          </div>
        )}
      </div>

      <FeedFooter
        isAgentView={isAgentView}
        total={total}
        selectedAgent={selectedAgent}
        activityCount={activities.length}
        filterType={filter.type}
        lastRefresh={lastRefresh}
      />
    </div>
  )
}

// ── Sub-views and micro-components ───────────────────────────────────────────

function FeedHeader({
  autoRefresh,
  onToggleAutoRefresh,
  onRefresh,
}: {
  readonly autoRefresh: boolean
  readonly onToggleAutoRefresh: () => void
  readonly onRefresh: () => void
}): React.JSX.Element {
  const t = useTranslations('activityFeed')
  return (
    <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-foreground">{t('title')}</h2>
        <div
          className={`w-2.5 h-2.5 rounded-full ${autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30'}`}
        />
      </div>
      <div className="flex gap-2">
        <Button onClick={onToggleAutoRefresh} variant={autoRefresh ? 'success' : 'secondary'} size="sm">
          {autoRefresh ? t('live') : t('paused')}
        </Button>
        <Button onClick={onRefresh} size="sm">{t('refresh')}</Button>
      </div>
    </div>
  )
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  readonly message: string
  readonly onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 m-4 rounded-lg text-sm flex items-center justify-between">
      <span>{message}</span>
      <Button
        onClick={onDismiss}
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss error"
        className="text-red-400/60 hover:text-red-400 ml-2"
      >
        x
      </Button>
    </div>
  )
}

function EmptyState({ selectedAgent }: { readonly selectedAgent: string }): React.JSX.Element {
  const t = useTranslations('activityFeed')
  return (
    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/50">
      <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mb-2">
        <path d="M2 4h12M2 8h8M2 12h10" />
      </svg>
      <p className="text-sm">{t('noActivities')}</p>
      <p className="text-xs mt-1">
        {selectedAgent ? t('noActivityForAgent', { agent: selectedAgent }) : t('tryAdjustingFilters')}
      </p>
    </div>
  )
}

interface AgentViewProps {
  readonly groupedByDay: Record<string, Activity[]>
  readonly agentData: Agent | undefined
  readonly sessions: SessionInfo[]
  readonly page: number
  readonly totalPages: number
  readonly onPageChange: (updater: (p: number) => number) => void
}

function AgentView({
  groupedByDay,
  agentData,
  sessions,
  page,
  totalPages,
  onPageChange,
}: AgentViewProps): React.JSX.Element {
  const t = useTranslations('activityFeed')
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <ActivityFeedAgentSidebar agentData={agentData} sessions={sessions} />

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
                {dayActivities.map((act) => <TimelineRow key={act.id} activity={act} />)}
              </div>
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <Button onClick={() => onPageChange((p) => Math.max(0, p - 1))} disabled={page === 0} variant="ghost" size="xs">
                {t('newer')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('pageOf', { page: page + 1, total: totalPages })}</span>
              <Button onClick={() => onPageChange((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} variant="ghost" size="xs">
                {t('older')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FeedFooter({
  isAgentView,
  total,
  selectedAgent,
  activityCount,
  filterType,
  lastRefresh,
}: {
  readonly isAgentView: boolean
  readonly total: number
  readonly selectedAgent: string
  readonly activityCount: number
  readonly filterType: string
  readonly lastRefresh: number
}): React.JSX.Element {
  const t = useTranslations('activityFeed')
  return (
    <div className="border-t border-border p-3 bg-surface-1 text-xs text-muted-foreground flex-shrink-0">
      <div className="flex justify-between items-center">
        <span>
          {isAgentView
            ? t('footerAgentEvents', { total, agent: selectedAgent })
            : t('footerShowing', { count: activityCount, filtered: filterType ? ` ${t('filtered')}` : '' })}
        </span>
        <span>{t('lastUpdated', { time: new Date(lastRefresh).toLocaleTimeString() })}</span>
      </div>
    </div>
  )
}
