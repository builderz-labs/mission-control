'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'

interface HermesAutomationStatus {
  active: boolean
  label: string
  enabledJobs: number
  totalJobs: number
  latestJobId: string | null
  latestJobName: string | null
  latestRunAt: string | null
}

interface HermesRecoveryStatus {
  state: 'missing' | 'success' | 'warning' | 'error'
  label: string
  detail: string | null
  jobId: string | null
  jobName: string | null
  lastRunAt: string | null
}

interface HermesRuntimeResponse {
  installed: boolean
  gatewayRunning: boolean
  activeSessions: number
  cronJobCount: number
  memoryEntries: number
  hookInstalled?: boolean
  automation: HermesAutomationStatus
  hhRecovery: HermesRecoveryStatus
}

interface HermesCronJob {
  id?: string
  prompt?: string
  enabled?: boolean
  schedule?: string
  lastRunAt?: string | null
  lastOutput?: string | null
}

interface HermesMemoryResponse {
  agentMemory: string | null
  userMemory: string | null
  agentMemoryEntries: number
  userMemoryEntries: number
  agentMemorySize: number
  userMemorySize: number
}

function statusTone(status: 'good' | 'warn' | 'bad') {
  if (status === 'good') return 'bg-green-500/15 text-green-400 border-green-500/20'
  if (status === 'warn') return 'bg-amber-500/15 text-amber-300 border-amber-500/20'
  return 'bg-red-500/15 text-red-400 border-red-500/20'
}

function extractMemorySnippet(source: string | null | undefined): string {
  if (!source) return 'No memory captured yet.'
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  return lines[0] || 'No memory captured yet.'
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No runs yet'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function HealthChip({ label, status }: { label: string; status: 'good' | 'warn' | 'bad' }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-1 text-[11px] font-medium ${statusTone(status)}`}>
      {label}
    </span>
  )
}

function SummaryCard({
  title,
  value,
  detail,
  status,
}: {
  title: string
  value: string
  detail: string
  status: 'good' | 'warn' | 'bad'
}) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <HealthChip label={value} status={status} />
      </div>
      <p className="mt-3 text-sm text-foreground">{detail}</p>
    </div>
  )
}

function runtimeChip(runtime: HermesRuntimeResponse | null, loading: boolean, error: string | null) {
  if (!runtime) {
    if (loading) return { label: 'Checking…', status: 'warn' as const }
    if (error) return { label: 'Unavailable', status: 'bad' as const }
    return { label: 'Unknown', status: 'warn' as const }
  }

  return runtime.installed
    ? { label: 'Installed', status: 'good' as const }
    : { label: 'Not installed', status: 'bad' as const }
}

export function HermesPanel() {
  const navigateToPanel = useNavigateToPanel()
  const [runtime, setRuntime] = useState<HermesRuntimeResponse | null>(null)
  const [cronJobs, setCronJobs] = useState<HermesCronJob[]>([])
  const [memory, setMemory] = useState<HermesMemoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [runtimeRes, tasksRes, memoryRes] = await Promise.all([
          fetch('/api/hermes', { cache: 'no-store' }),
          fetch('/api/hermes/tasks', { cache: 'no-store' }),
          fetch('/api/hermes/memory', { cache: 'no-store' }),
        ])

        const [runtimeBody, tasksBody, memoryBody] = await Promise.all([
          runtimeRes.json(),
          tasksRes.json(),
          memoryRes.json(),
        ])

        if (!runtimeRes.ok) throw new Error(runtimeBody?.error || 'Failed to load Hermes runtime')
        if (!tasksRes.ok) throw new Error(tasksBody?.error || 'Failed to load Hermes cron jobs')
        if (!memoryRes.ok) throw new Error(memoryBody?.error || 'Failed to load Hermes memory')

        if (cancelled) return
        setRuntime(runtimeBody as HermesRuntimeResponse)
        setCronJobs(Array.isArray(tasksBody?.cronJobs) ? tasksBody.cronJobs : [])
        setMemory(memoryBody as HermesMemoryResponse)
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load Hermes control panel')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const refresh = window.setInterval(() => {
      void load()
    }, 30000)

    return () => {
      cancelled = true
      window.clearInterval(refresh)
    }
  }, [])

  const memoryPreview = useMemo(() => ({
    agent: extractMemorySnippet(memory?.agentMemory),
    user: extractMemorySnippet(memory?.userMemory),
  }), [memory])

  const installChip = runtimeChip(runtime, loading, error)

  const automationStatus = !runtime
    ? 'warn'
    : runtime.automation.active
      ? 'good'
      : runtime.automation.enabledJobs > 0
        ? 'warn'
        : 'bad'

  const recoveryStatus = !runtime
    ? 'warn'
    : runtime.hhRecovery.state === 'success'
      ? 'good'
      : runtime.hhRecovery.state === 'warning'
        ? 'warn'
        : 'bad'

  const gatewayStatus = runtime?.gatewayRunning ? 'good' : runtime?.installed ? 'warn' : 'bad'

  return (
    <div className="mx-4 my-4 space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-foreground">Hermes Control</h1>
              <HealthChip label={installChip.label} status={installChip.status} />
            </div>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Hermes runtime, HH nightly recovery, cron jobs, and persistent memory are consolidated here so you can inspect the integration without jumping across four panels.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="xs" onClick={() => window.location.reload()}>
              Refresh
            </Button>
            <Button variant="outline" size="xs" onClick={() => navigateToPanel('settings')}>
              Settings
            </Button>
            <Button variant="outline" size="xs" onClick={() => navigateToPanel('tasks')}>
              Tasks
            </Button>
            <Button variant="outline" size="xs" onClick={() => navigateToPanel('memory')}>
              Memory
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {loading && !runtime ? (
        <div className="rounded-xl border border-border bg-card px-5 py-8 text-sm text-muted-foreground">
          Loading Hermes runtime...
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <SummaryCard
              title="Runtime"
              value={runtime?.gatewayRunning ? 'Gateway running' : runtime?.installed ? 'Installed only' : 'Offline'}
              detail={`${runtime?.activeSessions ?? 0} active sessions · hook ${runtime?.hookInstalled ? 'installed' : 'not installed'}`}
              status={gatewayStatus}
            />
            <SummaryCard
              title="Automation"
              value={runtime?.automation.label || 'Unknown'}
              detail={`${runtime?.automation.enabledJobs ?? 0}/${runtime?.automation.totalJobs ?? 0} jobs enabled · latest ${formatDate(runtime?.automation.latestRunAt)}`}
              status={automationStatus}
            />
            <SummaryCard
              title="HH Recovery"
              value={runtime?.hhRecovery.label || 'Unknown'}
              detail={runtime?.hhRecovery.detail || 'No HH recovery output recorded yet.'}
              status={recoveryStatus}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.4fr,1fr]">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Scheduled Jobs</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Hermes cron jobs discovered from <code className="font-mono">~/.hermes/cron</code>.
                  </p>
                </div>
                <HealthChip
                  label={`${cronJobs.length} jobs`}
                  status={cronJobs.length > 0 ? 'good' : 'warn'}
                />
              </div>

              <div className="mt-4 space-y-3">
                {cronJobs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                    No Hermes cron jobs detected.
                  </div>
                ) : (
                  cronJobs.map((job) => (
                    <div key={job.id || job.prompt} className="rounded-lg border border-border/70 bg-secondary/10 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{job.prompt || job.id || 'Hermes job'}</span>
                        <HealthChip label={job.enabled === false ? 'Disabled' : 'Enabled'} status={job.enabled === false ? 'warn' : 'good'} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>Schedule: {job.schedule || 'n/a'}</span>
                        <span>Last run: {formatDate(job.lastRunAt)}</span>
                      </div>
                      {job.lastOutput && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {job.lastOutput}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Memory Snapshot</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Quick preview of Hermes agent memory and user memory.
                  </p>
                </div>
                <HealthChip
                  label={`${runtime?.memoryEntries ?? memory?.agentMemoryEntries ?? 0} entries`}
                  status={(runtime?.memoryEntries ?? 0) > 0 ? 'good' : 'warn'}
                />
              </div>

              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-border/70 bg-secondary/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-foreground">Agent memory</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {memory?.agentMemoryEntries ?? 0} entries · {memory?.agentMemorySize ?? 0} bytes
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{memoryPreview.agent}</p>
                </div>

                <div className="rounded-lg border border-border/70 bg-secondary/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold text-foreground">User memory</h3>
                    <span className="text-[11px] text-muted-foreground">
                      {memory?.userMemoryEntries ?? 0} entries · {memory?.userMemorySize ?? 0} bytes
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{memoryPreview.user}</p>
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
