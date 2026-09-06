'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { apiFetch } from '@/lib/api-client'
import { useSmartPoll } from '@/lib/use-smart-poll'
import { Button } from '@/components/ui/button'
import { FlyActivityTable } from './fly-activity-table'
import type { FlyActivity } from '@/lib/fly-activity'

type UnknownRecord = Record<string, unknown>

interface Telemetry {
  status: string
  queue: UnknownRecord
  fleet: UnknownRecord
  cost: UnknownRecord
  mac: UnknownRecord
  bottlenecks: Array<{ label: string; detail?: string; severity?: string }>
  updatedAt: number | null
  activity?: FlyActivity
}

const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
const text = (value: unknown, fallback = '—'): string => typeof value === 'string' && value ? value : fallback
const pick = (record: UnknownRecord, ...keys: string[]) => keys.reduce<unknown>((value, key) => value ?? record[key], undefined)

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function normalize(raw: unknown): Telemetry {
  const root = asRecord(raw)
  if (typeof root.status !== 'string' || !root.queue || !root.fleet || !root.cost) throw new Error('Invalid or outdated telemetry response')
  const fleet = asRecord(pick(root, 'fleet', 'workers'))
  const cost = asRecord(pick(root, 'cost', 'costs', 'budget'))
  const bottlenecks = Array.isArray(root.bottlenecks) ? root.bottlenecks.map((item) => {
    const row = asRecord(item)
    return { label: text(pick(row, 'label', 'name', 'type'), 'Unspecified bottleneck'), detail: text(pick(row, 'detail', 'message'), ''), severity: text(row.severity, 'warn') }
  }) : []
  return {
    status: text(pick(root, 'status', 'availability'), 'Not configured'),
    queue: asRecord(root.queue), fleet, cost, mac: asRecord(root.mac), bottlenecks,
    updatedAt: number(pick(root, 'updated_at', 'updatedAt', 'timestamp')) || null,
    activity: root.activity as FlyActivity | undefined,
  }
}

function stat(record: UnknownRecord, ...keys: string[]) { return number(pick(record, ...keys)) }
function money(record: UnknownRecord, ...keys: string[]) { return `$${stat(record, ...keys).toFixed(2)}` }
function tone(value: string) {
  if (/fail|down|error|critical|blocked/i.test(value)) return 'text-red-400'
  if (/warn|limit|degrad|disabled/i.test(value)) return 'text-amber-400'
  if (/idle|waiting|not configured/i.test(value)) return 'text-muted-foreground'
  return 'text-green-400'
}
function bytes(value: number) { return value ? `${(value / 1_073_741_824).toFixed(1)} GB` : '—' }
function workers(fleet: UnknownRecord) { return Array.isArray(fleet.workers) ? fleet.workers.map(asRecord) : [] }

function FlowNode({ label, value, detail, status = 'ready' }: { label: string; value: string; detail: string; status?: string }) {
  return <article className="min-w-32 flex-1 rounded-lg border border-border bg-background p-3" aria-label={`${label}: ${value}`}>
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={`mt-1 text-lg font-semibold tabular-nums ${tone(status)}`}>{value}</p>
    <p className="text-xs text-muted-foreground">{detail}</p>
  </article>
}

function Connector({ label }: { label: string }) {
  return <div className="flex shrink-0 flex-col items-center justify-center gap-1 text-muted-foreground" aria-hidden="true">
    <span className="text-[10px] uppercase tracking-wide">{label}</span><span className="text-lg leading-none">→</span>
  </div>
}

function StateStep({ label, value, status }: { label: string; value: number; status: string }) {
  return <div className="min-w-28 rounded-md border border-border bg-card px-3 py-2 text-center">
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className={`text-lg font-semibold tabular-nums ${tone(status)}`}>{value}</p>
  </div>
}

export function FlyOrchestrationPanel() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef(false)
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      setTelemetry(normalize(await apiFetch('/api/fly/telemetry', { signal: AbortSignal.timeout(8000) })))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Telemetry is unavailable')
    } finally { setRefreshing(false); inFlight.current = false }
  }, [])
  useSmartPoll(refresh, 5_000, { backoff: true })
  useEffect(() => {
    const onWorkerUpdate = () => { void refresh() }
    window.addEventListener('mission-control:fly-worker-updated', onWorkerUpdate)
    return () => window.removeEventListener('mission-control:fly-worker-updated', onWorkerUpdate)
  }, [refresh])

  const queue = telemetry?.queue ?? {}
  const fleet = telemetry?.fleet ?? {}
  const cost = telemetry?.cost ?? {}
  const mac = telemetry?.mac ?? {}
  const queued = stat(queue, 'remote', 'queued', 'pending', 'total')
  const running = stat(fleet, 'running', 'active', 'busy')
  const capacity = stat(fleet, 'capacity', 'max_concurrency', 'max')
  const jobs = stat(fleet, 'jobs_running', 'active_jobs', 'jobs') || running
  const daily = stat(cost, 'daily_spend', 'today', 'daily')
  const dailyBudget = stat(cost, 'daily_budget', 'daily_limit', 'daily_cap')
  const monthlyBudget = stat(cost, 'monthly_budget', 'monthly_limit', 'monthly_cap')
  const failed = stat(queue, 'failed') || stat(fleet, 'failed', 'errors')
  const workerGroups = workers(fleet)

  if (!telemetry) return <section aria-label="Fly orchestration"><p role={error ? 'alert' : 'status'}>{error ? `Live telemetry unavailable: ${error}` : 'Loading live worker telemetry…'}</p></section>

  return <section className="space-y-4" aria-labelledby="fly-orchestration-title">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="fly-orchestration-title" className="flex items-center gap-3 text-lg font-semibold"><Image src="/fly-logo.svg" alt="Fly.io" width={80} height={28} className="h-9 w-24 rounded bg-white p-2" unoptimized />Fly orchestration</h2>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {error ? `Live telemetry unavailable: ${error}` : telemetry ? `Live polling every 5 seconds · ${telemetry.status}${telemetry.updatedAt ? ` · snapshot ${new Date(telemetry.updatedAt * 1_000).toLocaleTimeString()}` : ''}` : 'Loading live worker telemetry…'}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>
    </header>

    <div className="overflow-x-auto pb-1" aria-label="Mac to Fly job flow">
      <div className="flex min-w-[760px] items-stretch gap-2">
        <FlowNode label="Mac" value={mac.cpu_basis === 'sampling' ? 'Sampling CPU…' : `${stat(mac, 'cpu_percent', 'cpu')}% CPU`} detail={`${stat(mac, 'memory_percent', 'ram_percent', 'memory')}% RAM · ${bytes(stat(mac, 'swap_bytes', 'swap'))} swap`} status={text(mac.pressure, text(mac.status))} />
        <Connector label="classify" />
        <FlowNode label="Scheduler" value={text(telemetry?.status, 'Waiting')} detail={`${telemetry?.bottlenecks.length ?? 0} bottleneck(s)`} status={text(telemetry?.status)} />
        <Connector label="offload" />
        <FlowNode label="Fly queue" value={`${queued} queued`} detail={`${stat(queue, 'local', 'local_only')} local-only`} status={queued > 0 ? 'warn' : 'ready'} />
        <Connector label="launch" />
        <FlowNode label="Fly fleet" value={`${running}${capacity ? ` / ${capacity}` : ''} active`} detail={`${stat(fleet, 'idle')} idle · ${jobs} jobs`} status={text(fleet.status, running ? 'ready' : 'idle')} />
        <Connector label="meter" />
        <FlowNode label="Cost governor" value={money(cost, 'monthly_spend', 'observed_usd', 'observed')} detail={`${money(cost, 'reserved_usd', 'reserved_cost', 'reserved')} reserved · ${dailyBudget ? `${money(cost, 'daily_spend', 'today', 'daily')} / ${money(cost, 'daily_budget', 'daily_limit', 'daily_cap')} today` : `${money(cost, 'daily_spend', 'today', 'daily')} today`}`} status={dailyBudget && daily >= dailyBudget ? 'limit' : text(cost.status)} />
      </div>
    </div>

    <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Live worker state transitions">
      <StateStep label="Queued" value={queued} status={queued ? 'warn' : 'ready'} /><span aria-hidden="true">→</span>
      <StateStep label="Creating / running" value={running} status={running ? 'ready' : 'idle'} /><span aria-hidden="true">→</span>
      <StateStep label="Failed / retry" value={failed} status={failed ? 'error' : 'ready'} />
      <p className="min-w-48 text-xs text-muted-foreground">Infrastructure failures retry at most twice. Unknown launches and cleanup retain ownership; never duplicate them locally.</p>
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <Metric label="Queue depth" value={queued} detail={`${stat(queue, 'retrying')} retrying`} />
      <Metric label="Fleet utilization" value={capacity ? `${Math.round((running / capacity) * 100)}%` : `${running} active`} detail={`${stat(fleet, 'failed', 'errors')} failures`} />
      <Metric label="Cost governor" value={money(cost, 'monthly_spend', 'observed_usd', 'observed')} detail={monthlyBudget ? `${money(cost, 'monthly_budget', 'monthly_limit', 'monthly_cap')} monthly budget` : `${money(cost, 'reserved_usd', 'reserved_cost', 'reserved')} reserved`} />
    </div>

    <section className="rounded-lg border border-border bg-card p-3" aria-labelledby="fly-worker-groups-title">
      <div className="mb-2 flex items-center justify-between gap-2"><h3 id="fly-worker-groups-title" className="text-sm font-medium">Worker classes</h3><span className="text-xs text-muted-foreground">Live fleet telemetry</span></div>
      {workerGroups.length ? <ul className="grid gap-2 md:grid-cols-2" aria-label="Worker class telemetry">
        {workerGroups.map((worker) => <li key={text(worker.worker_class, 'unknown')} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
          <p className="font-medium">{text(worker.worker_class, 'Unknown class')}</p>
          <p className="text-muted-foreground">{number(worker.running)} running / {number(worker.total)} total · {typeof worker.cpu_percent === 'number' ? `${worker.cpu_percent}% CPU` : 'CPU unavailable'} · {typeof worker.memory_bytes === 'number' ? bytes(worker.memory_bytes) : '—'} RAM</p>
        </li>)}
      </ul> : <p className="text-xs text-muted-foreground">No Fly workers have reported telemetry yet.</p>}
    </section>

    <p className="text-xs text-muted-foreground">{text(cost.basis,'Estimated compute, not a Fly invoice.')} {text(cost.scope,'Workspace spending; global admission budgets.')}</p>
    <FlyActivityTable activity={telemetry.activity} />
    {telemetry?.bottlenecks.length ? <ul className="space-y-2" aria-label="Current bottlenecks">
      {telemetry.bottlenecks.slice(0, 4).map((item) => <li key={`${item.label}-${item.detail}`} className="rounded-md border border-border px-3 py-2 text-xs"><span className={`font-medium ${tone(item.severity ?? '')}`}>{item.label}</span>{item.detail ? ` — ${item.detail}` : ''}</li>)}
    </ul> : <p className="text-xs text-muted-foreground">No active Fly bottlenecks reported.</p>}
  </section>
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <article className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></article>
}
