'use client'

import { useState, useCallback } from 'react'
import { apiFetch, ApiError } from '@/lib/api-client'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { getLocalOsStatus, getMcHealth } from './widget-primitives'
import { OnboardingChecklistWidget } from './widgets/onboarding-checklist-widget'
import { ActiveTerminalSessions } from './active-terminal-sessions'
import { WidgetGrid } from './widget-grid'
import { FleetLogosStrip } from './widgets/fleet-logos-strip'
import type { DbStats, ClaudeStats, DashboardData } from './widget-primitives'
import { claudeFleetPlanTotalUsd, formatClaudeFleetLabels } from '@/lib/claude-fleet-plans'
import { buildCliFleets, type DashboardSession } from '@/lib/dashboard-cli-fleets'
import { localSessionLogs, mergeRecentLogs } from '@/lib/dashboard-session-logs'
import { Button } from '@/components/ui/button'
import type { DashboardGitHubStats, DashboardSystemStats } from './dashboard-response-types'

type DashboardRequest = 'system' | 'sessions' | 'claude' | 'github'

const REQUEST_LABELS: Record<DashboardRequest, string> = {
  system: 'system status',
  sessions: 'sessions',
  claude: 'Claude usage',
  github: 'GitHub status',
}

export function Dashboard() {
  const {
    sessions,
    setSessions,
    connection,
    dashboardMode,
    subscription,
    logs,
    agents,
    tasks,
    setActiveConversation,
  } = useMissionControl()

  const navigateToPanel = useNavigateToPanel()
  const isLocal = dashboardMode === 'local'
  const [systemStats, setSystemStats] = useState<DashboardSystemStats | null>(null)
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [claudeStats, setClaudeStats] = useState<ClaudeStats | null>(null)
  const [githubStats, setGithubStats] = useState<DashboardGitHubStats | null>(null)
  const [hermesCronJobCount, setHermesCronJobCount] = useState(0)
  const [loading, setLoading] = useState({ system: true, sessions: true, claude: true, github: true })
  const [errors, setErrors] = useState<Partial<Record<DashboardRequest, string>>>({})

  const loadDashboard = useCallback(async () => {
    setErrors({})
    const failed = (request: DashboardRequest, error?: unknown) => {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return
      setErrors((current) => ({
        ...current,
        [request]: `Could not load ${REQUEST_LABELS[request]}.`,
      }))
    }
    const requests: Promise<void>[] = [
      apiFetch<DashboardSystemStats>('/api/status?action=dashboard')
        .then((data) => {
          if (data && !data.error) {
            setSystemStats(data)
            if (data.db) setDbStats(data.db)
          }
        })
        .catch((error: unknown) => failed('system', error))
        .finally(() => setLoading((prev) => ({ ...prev, system: false }))),
      apiFetch<{ sessions?: DashboardSession[] }>('/api/sessions', {
        signal: AbortSignal.timeout(15_000),
      })
        .then((data) => {
          if (data?.sessions) setSessions(data.sessions as Parameters<typeof setSessions>[0])
        })
        .catch((error: unknown) => failed('sessions', error))
        .finally(() => setLoading((prev) => ({ ...prev, sessions: false }))),
    ]

    if (isLocal) {
      requests.push(
        apiFetch<{ stats?: ClaudeStats }>('/api/claude/sessions').then((data) => { if (data?.stats) setClaudeStats(data.stats) }).catch((error: unknown) => failed('claude', error)).finally(() => setLoading((prev) => ({ ...prev, claude: false }))),
        apiFetch<DashboardGitHubStats>('/api/github?action=stats')
          .then((data) => { if (data && !data.error) setGithubStats(data) })
          .catch((error: unknown) => {
            const isOptionalIntegrationMissing =
              error instanceof ApiError &&
              error.status === 400 &&
              error.message === 'GITHUB_TOKEN not configured'
            if (!isOptionalIntegrationMissing) failed('github', error)
          })
          .finally(() => setLoading((prev) => ({ ...prev, github: false }))),
        apiFetch<{ cronJobCount?: number }>('/api/hermes').then((data) => { if (data?.cronJobCount != null) setHermesCronJobCount(data.cronJobCount) }).catch(() => {}),
      )
    } else {
      setLoading((prev) => ({ ...prev, claude: false, github: false }))
    }

    await Promise.allSettled(requests)
  }, [isLocal, setSessions])

  useSmartPoll(loadDashboard, isLocal ? 15000 : 60000, { pauseWhenConnected: !isLocal })

  const openSession = useCallback((session: DashboardSession) => {
    if (!session.id) return
    setActiveConversation(`session:${session.kind || 'gateway'}:${session.id}`)
    navigateToPanel('chat')
  }, [setActiveConversation, navigateToPanel])

  const dashboardData = buildDashboardView({
    isLocal,
    systemStats,
    dbStats,
    claudeStats,
    githubStats,
    loading,
    sessions: sessions as DashboardSession[],
    logs,
    agents,
    tasks,
    connection,
    subscription,
    navigateToPanel,
    openSession,
    hermesCronJobCount,
    subscriptionLabel: formatClaudeFleetLabels(),
    subscriptionPrice: claudeFleetPlanTotalUsd(),
  })

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Fleet health, active work, and recent operational signals.</p>
      </div>
      {Object.keys(errors).length > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>{Object.values(errors).join(' ')}</span>
          <Button variant="outline" size="sm" onClick={() => void loadDashboard()}>
            Retry dashboard data
          </Button>
        </div>
      )}
      <OnboardingChecklistWidget />
      <ActiveTerminalSessions data={dashboardData} />
      <FleetLogosStrip agents={agents} />
      <WidgetGrid data={dashboardData} />
    </div>
  )
}

function buildDashboardView(input: Omit<DashboardData, 'cliFleets' | 'memPct' | 'diskPct' | 'systemLoad' | 'activeSessions' | 'errorCount' | 'onlineAgents' | 'runningTasks' | 'inboxCount' | 'assignedCount' | 'reviewCount' | 'doneCount' | 'backlogCount' | 'mergedRecentLogs' | 'recentErrorLogs' | 'localOsStatus' | 'mcHealth' | 'gatewayHealthStatus' | 'isSystemLoading' | 'isSessionsLoading' | 'isClaudeLoading' | 'isGithubLoading'>): DashboardData {
  const { isLocal, systemStats, dbStats, claudeStats, githubStats, loading, sessions, logs, agents, tasks, connection } = input
  const isSystemLoading = loading.system && !systemStats
  const isSessionsLoading = loading.sessions && sessions.length === 0
  const memPct = systemStats?.memory?.total ? Math.round((systemStats.memory.used / systemStats.memory.total) * 100) : null
  const diskPct = parseInt(systemStats?.disk?.usage || '', 10)
  const errorCount = logs.filter((log) => log.level === 'error').length
  const inboxCount = dbStats?.tasks.byStatus?.inbox ?? 0
  const assignedCount = dbStats?.tasks.byStatus?.assigned ?? 0
  const reviewCount = (dbStats?.tasks.byStatus?.review ?? 0) + (dbStats?.tasks.byStatus?.quality_review ?? 0)
  const mergedRecentLogs = mergeRecentLogs(logs, isLocal ? localSessionLogs(sessions) : [])
  const cliFleets = buildCliFleets(sessions, {
    'claude-code': { cost: claudeStats?.total_estimated_cost ?? null },
  })

  return {
    ...input,
    memPct,
    diskPct,
    systemLoad: Math.max(memPct ?? 0, Number.isFinite(diskPct) ? diskPct : 0),
    activeSessions: sessions.filter((session) => session.active).length,
    errorCount,
    onlineAgents: dbStats ? dbStats.agents.total - (dbStats.agents.byStatus?.offline ?? 0) : agents.filter((agent) => agent.status !== 'offline').length,
    cliFleets,
    runningTasks: dbStats?.tasks.byStatus?.in_progress ?? tasks.filter((task) => task.status === 'in_progress').length,
    inboxCount,
    assignedCount,
    reviewCount,
    doneCount: dbStats?.tasks.byStatus?.done ?? 0,
    backlogCount: inboxCount + assignedCount + reviewCount,
    mergedRecentLogs,
    recentErrorLogs: mergedRecentLogs.filter((log) => log.level === 'error').length,
    localOsStatus: isSystemLoading ? { value: 'Loading...', status: 'warn' } : getLocalOsStatus(memPct, Number.isFinite(diskPct) ? diskPct : null),
    mcHealth: isSystemLoading ? { value: 'Loading...', status: 'warn' } : getMcHealth(systemStats, dbStats, errorCount),
    gatewayHealthStatus: connection.isConnected ? 'good' : 'bad',
    isSystemLoading,
    isSessionsLoading,
    isClaudeLoading: isLocal && loading.claude && !claudeStats,
    isGithubLoading: isLocal && loading.github && !githubStats,
  }
}
