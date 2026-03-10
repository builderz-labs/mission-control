'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { AgentStatusBoard } from '@/components/dashboard/agent-status-board'
import { ErrorBlockerPanel } from '@/components/dashboard/error-blocker-panel'
import { EventStreamPanel } from '@/components/dashboard/event-stream-panel'
import { HeartbeatMonitorPanel } from '@/components/dashboard/heartbeat-monitor-panel'
import { OrchestratorControlButtons } from '@/components/dashboard/orchestrator-control-buttons'
import { PipelineExecutionInspector } from '@/components/dashboard/pipeline-execution-inspector'
import { PipelineStagePanel } from '@/components/dashboard/pipeline-stage-panel'
import { ToolCallTimelinePanel } from '@/components/dashboard/tool-call-timeline-panel'
import { UsageMonitorPanel } from '@/components/dashboard/usage-monitor-panel'
import type {
  MissionControlAgentRow,
  MissionControlBlockedWorkflow,
  MissionControlHeartbeatRow,
  MissionControlPipelineInspectorStage,
  MissionControlPipelineStage,
  MissionControlSnapshot,
  MissionControlSummary,
  MissionControlTaskRow,
  MissionControlToolTimelineEntry,
  MissionControlUsageSummary,
  OrchestratorControlState,
  UnifiedStatusEvent,
} from '@/types/mission-control'

const SERVER_EVENT_URLS = ['/api/events', '/api/status?action=stream'] as const
const BOARD_REQUEST_TIMEOUT_MS = 10_000
const BOARD_ERROR_THRESHOLD = 2

const EMPTY_SUMMARY: MissionControlSummary = {
  agentsRegistered: 0,
  agentsReachable: 0,
  agentsActive: 0,
  tasksRunning: 0,
  errors24h: 0,
  eventRate: 0,
}

const EMPTY_ORCHESTRATOR: OrchestratorControlState = {
  state: 'idle',
  dispatchEnabled: false,
  scheduledRunsEnabled: false,
  fallbackEnabled: false,
  schedulerRunning: false,
  activeRuns: 0,
}

const EMPTY_USAGE: MissionControlUsageSummary = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalEstimatedCost: 0,
  callsPerMinute: 0,
  models: [],
}

export function MissionControlBoard() {
  const [summary, setSummary] = useState<MissionControlSummary>(EMPTY_SUMMARY)
  const [agents, setAgents] = useState<MissionControlAgentRow[]>([])
  const [events, setEvents] = useState<UnifiedStatusEvent[]>([])
  const [pipeline, setPipeline] = useState<MissionControlPipelineStage[]>([])
  const [orchestrator, setOrchestrator] = useState<OrchestratorControlState>(EMPTY_ORCHESTRATOR)
  const [tasks, setTasks] = useState<MissionControlTaskRow[]>([])
  const [heartbeat, setHeartbeat] = useState<MissionControlHeartbeatRow[]>([])
  const [toolTimeline, setToolTimeline] = useState<MissionControlToolTimelineEntry[]>([])
  const [usage, setUsage] = useState<MissionControlUsageSummary>(EMPTY_USAGE)
  const [blocked, setBlocked] = useState<MissionControlBlockedWorkflow[]>([])
  const [pipelineInspector, setPipelineInspector] = useState<MissionControlPipelineInspectorStage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>('')
  const [lastSuccessfulSnapshotAt, setLastSuccessfulSnapshotAt] = useState<string | null>(null)
  const [consecutiveFailureCount, setConsecutiveFailureCount] = useState(0)
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSuccessfulSnapshotAtRef = useRef<string | null>(null)
  const consecutiveFailureCountRef = useRef(0)
  const isRefreshingRef = useRef(false)
  const pendingRefreshRef = useRef(false)

  const loadBoard = useCallback(async () => {
    if (isRefreshingRef.current) {
      pendingRefreshRef.current = true
      return
    }

    isRefreshingRef.current = true
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BOARD_REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch('/api/status?action=mission-control', {
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Mission Control request failed (${response.status})`)
      }
      const data = await response.json() as MissionControlSnapshot
      setSummary(data.summary || EMPTY_SUMMARY)
      setAgents(data.agents || [])
      setPipeline(data.pipeline || [])
      setOrchestrator(data.orchestrator || EMPTY_ORCHESTRATOR)
      setEvents(data.events || [])
      setTasks(data.tasks || [])
      setHeartbeat(data.heartbeat || [])
      setToolTimeline(data.toolTimeline || [])
      setUsage(data.usage || EMPTY_USAGE)
      setBlocked(data.blocked || [])
      setPipelineInspector(data.pipelineInspector || [])
      const generatedAt = data.generatedAt || new Date().toISOString()
      lastSuccessfulSnapshotAtRef.current = generatedAt
      consecutiveFailureCountRef.current = 0
      setLastSuccessfulSnapshotAt(generatedAt)
      setConsecutiveFailureCount(0)
      setLoadError('')
    } catch (error) {
      const message = error instanceof Error
        ? error.name === 'AbortError'
          ? `Mission Control request timed out after ${BOARD_REQUEST_TIMEOUT_MS / 1000}s`
          : error.message
        : 'Unable to load Mission Control'

      if (!lastSuccessfulSnapshotAtRef.current) {
        consecutiveFailureCountRef.current = 1
        setConsecutiveFailureCount(1)
        setLoadError(message)
      } else {
        const nextFailureCount = consecutiveFailureCountRef.current + 1
        consecutiveFailureCountRef.current = nextFailureCount
        setConsecutiveFailureCount(nextFailureCount)
        if (nextFailureCount >= BOARD_ERROR_THRESHOLD) {
          setLoadError(message)
        } else {
          setLoadError('')
        }
      }
    } finally {
      clearTimeout(timeoutId)
      isRefreshingRef.current = false
      setLoading(false)
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false
        void loadBoard()
      }
    }
  }, [])

  useSmartPoll(loadBoard, 10_000, { pauseWhenSseConnected: true })

  useEffect(() => {
    let source: EventSource | null = null
    let reconnectTimeout: NodeJS.Timeout | null = null
    let currentUrlIndex = 0

    const connect = () => {
      source?.close()
      source = new EventSource(SERVER_EVENT_URLS[currentUrlIndex])
      source.onopen = () => {
        currentUrlIndex = 0
      }
      source.onmessage = () => {
        if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = setTimeout(() => {
          void loadBoard()
        }, 1000)
      }
      source.onerror = () => {
        source?.close()
        source = null
        currentUrlIndex = (currentUrlIndex + 1) % SERVER_EVENT_URLS.length
        if (reconnectTimeout) clearTimeout(reconnectTimeout)
        reconnectTimeout = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      source?.close()
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current)
    }
  }, [loadBoard])

  const blockerCount = useMemo(
    () => blocked.length || agents.filter((agent) => Boolean(agent.blocker)).length + tasks.filter((task) => Boolean(task.blocker)).length,
    [agents, blocked, tasks]
  )
  const visibleTasks = useMemo(() => tasks.slice(0, 100), [tasks])
  const staleSnapshotDetail = useMemo(() => {
    if (!loadError || !lastSuccessfulSnapshotAt || consecutiveFailureCount < BOARD_ERROR_THRESHOLD) {
      return null
    }

    return `${formatSnapshotAge(lastSuccessfulSnapshotAt)} Latest refresh failed: ${loadError}`
  }, [consecutiveFailureCount, lastSuccessfulSnapshotAt, loadError])

  if (loading) {
    return (
      <div className="p-5">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-24 rounded-xl shimmer" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-5">
      {loadError && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          {staleSnapshotDetail
            ? `Mission Control is showing the last successful snapshot. ${staleSnapshotDetail}`
            : `Mission Control data is temporarily unavailable. ${loadError}`}
        </section>
      )}

      <OrchestratorControlButtons orchestrator={orchestrator} onUpdated={loadBoard} />

      <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Agents Registered" value={summary.agentsRegistered} />
        <SummaryCard label="Agents Reachable" value={summary.agentsReachable} accent="cyan" />
        <SummaryCard label="Agents Active" value={summary.agentsActive} accent="green" />
        <SummaryCard label="Tasks Running" value={summary.tasksRunning} accent="amber" />
        <SummaryCard label="Errors (24h)" value={summary.errors24h} accent={summary.errors24h > 0 ? 'red' : 'green'} />
        <SummaryCard label="Event Rate" value={`${summary.eventRate}/sec`} />
      </section>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 ${orchestrator.schedulerRunning ? 'bg-cyan-500/10 text-cyan-400' : 'bg-secondary text-muted-foreground'}`}>
          Scheduler {orchestrator.schedulerRunning ? 'running' : 'idle'}
        </span>
        <span className={`rounded-full px-2 py-1 ${blockerCount > 0 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
          {blockerCount > 0 ? `${blockerCount} blockers or errors` : 'No blockers detected'}
        </span>
      </div>

      <AgentStatusBoard agents={agents} />

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <EventStreamPanel events={events} />
        <div className="space-y-5">
          <PipelineStagePanel stages={pipeline} />
          <section className="panel">
            <div className="panel-header">
              <h2 className="text-sm font-semibold text-foreground">Current Task Queue</h2>
              <span className="text-2xs font-medium text-muted-foreground">{visibleTasks.length} visible</span>
            </div>
            <div className="max-h-[32rem] overflow-y-auto divide-y divide-border/40">
              {visibleTasks.map((task) => (
                <div key={task.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-xs font-medium ${task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                        {task.status === 'done' ? '✓ ' : ''}{task.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                        <span>{task.status}</span>
                        <span>{task.stage}</span>
                        <span>{task.assignedTo || 'unassigned'}</span>
                        {task.debatePending && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-400">
                            debate pending
                          </span>
                        )}
                        {task.orchestratorReportType && (
                          <span className={`rounded-full px-2 py-0.5 ${
                            task.orchestratorReportType === 'bug_restart'
                              ? 'bg-red-500/10 text-red-400'
                              : task.orchestratorReportType === 'problem'
                              ? 'bg-orange-500/10 text-orange-300'
                              : 'bg-cyan-500/10 text-cyan-300'
                          }`}>
                            {task.orchestratorReportType === 'bug_restart'
                              ? 'restart queued'
                              : task.orchestratorReportType === 'problem'
                              ? 'problem review'
                              : 'wait review'}
                          </span>
                        )}
                        {!!task.selfHealActions && (
                          <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-400">
                            self-heal x{task.selfHealActions}
                          </span>
                        )}
                      </div>
                      {task.orchestratorDecision && (
                        <p className="mt-1 text-2xs text-cyan-300/90">{task.orchestratorDecision}</p>
                      )}
                      {task.debateReason && (
                        <p className="mt-1 text-2xs text-amber-300/90">{task.debateReason}</p>
                      )}
                      {task.orchestratorReport && (
                        <p className="mt-1 text-2xs text-foreground/80">{task.orchestratorReport}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {task.status === 'done' && (
                        <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-2xs text-green-400">
                          done
                        </span>
                      )}
                      <span className="text-2xs text-muted-foreground">{formatTaskAge(task.updatedAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {visibleTasks.length === 0 && (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No active tasks.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <HeartbeatMonitorPanel heartbeat={heartbeat} />
        <UsageMonitorPanel usage={usage} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ToolCallTimelinePanel entries={toolTimeline} />
        <ErrorBlockerPanel blocked={blocked} />
      </div>

      <PipelineExecutionInspector stages={pipelineInspector} />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  accent = 'default',
}: {
  label: string
  value: string | number
  accent?: 'default' | 'cyan' | 'green' | 'amber' | 'red'
}) {
  const classes = accent === 'cyan'
    ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-400'
    : accent === 'green'
    ? 'border-green-500/20 bg-green-500/10 text-green-400'
    : accent === 'amber'
    ? 'border-amber-500/20 bg-amber-500/10 text-amber-400'
    : accent === 'red'
    ? 'border-red-500/20 bg-red-500/10 text-red-400'
    : 'border-border bg-card text-foreground'

  return (
    <div className={`rounded-xl border p-4 ${classes}`}>
      <p className="text-2xs uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-2 text-3xl font-semibold font-mono-tight">{value}</p>
    </div>
  )
}

function formatTaskAge(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return `${Math.max(1, Math.floor(diff / 1000))}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}

function formatSnapshotAge(ts: string) {
  return `Last successful snapshot: ${formatTaskAge(ts)}.`
}
