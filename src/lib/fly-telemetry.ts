import { flyWorkerLimit } from './fly-capacity'
import type Database from 'better-sqlite3'
import os from 'node:os'
import type { HostMetrics } from './host-metrics'
import { flyNumber, flyReadiness } from './fly-admission-schema'
import { flyBudgetPeriods } from './fly-budget'

type JobRow = {
  state: string
  worker_class: string
  execution_target: string
  observed_cost_usd: number
  estimated_cost_usd: number
  runtime_seconds: number
  cpu_percent: number | null
  memory_bytes: number | null
  swap_bytes: number | null
  heartbeat_at: number | null
  created_at: number
  completed_at: number | null
}

export interface FlyTelemetrySnapshot {
  status: 'disabled' | 'healthy' | 'degraded' | 'blocked'
  updated_at: number
  queue: { queued: number; running: number; failed: number; local: number }
  fleet: { running: number; total: number; capacity: number; failed: number; workers: Array<{ worker_class: string; total: number; running: number; cpu_percent: number | null; memory_bytes: number | null }> }
  cost: { observed_usd: number; reserved_usd: number; daily_spend: number; monthly_spend: number; daily_budget: number; monthly_budget: number; basis: string; scope: string }
  mac: { local_jobs: number; pressure: 'normal' | 'elevated'; cpu_percent: number; cpu_basis: string; memory_percent: number; swap_bytes: number }
  bottlenecks: Array<{ label: string; severity: 'warn' | 'error' }>
}

const RUNNING = new Set(['creating', 'running', 'cleaning'])

export function buildFlyTelemetry(db: Database.Database, workspaceId: number, host?: HostMetrics): FlyTelemetrySnapshot {
  const rows = db.prepare(`
    SELECT state, worker_class, execution_target, observed_cost_usd, estimated_cost_usd,
      runtime_seconds, cpu_percent, memory_bytes, swap_bytes, heartbeat_at, created_at, completed_at
    FROM fly_worker_jobs WHERE workspace_id = ? AND state IN ('creating','running','cleaning')
  `).all(workspaceId) as JobRow[]
  const enabled = process.env.MC_FLY_ENABLED === 'true'
  const classes = new Map<string, { total: number; running: number; cpu: number; cpuN: number; memory: number; memoryN: number }>()
  const submissions = db.prepare("SELECT state,COUNT(*) AS n FROM fly_submissions WHERE workspace_id=? GROUP BY state")
    .all(workspaceId) as Array<{state:string;n:number}>
  const queued = submissions.find(row=>row.state==='queued')?.n || 0
  const failed = submissions.find(row=>row.state==='failed')?.n || 0
  const local = (db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE workspace_id=? AND status='in_progress'
    AND json_extract(CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END,'$.execution_target')='local'`).get(workspaceId) as {n:number}).n
  let running = 0; let reserved = 0
  const now = Math.floor(Date.now() / 1000)
  const { day,month } = flyBudgetPeriods()
  const { observed, daily, monthly } = db.prepare(`SELECT COALESCE(SUM(observed_cost_usd),0) AS observed,
    COALESCE(SUM(CASE WHEN created_at>=? OR completed_at>=? OR state IN ('creating','running','cleaning') THEN observed_cost_usd ELSE 0 END),0) AS daily,
    COALESCE(SUM(CASE WHEN created_at>=? OR completed_at>=? OR state IN ('creating','running','cleaning') THEN observed_cost_usd ELSE 0 END),0) AS monthly
    FROM fly_worker_jobs WHERE workspace_id=?`).get(day,day,month,month,workspaceId) as {observed:number;daily:number;monthly:number}
  for (const row of rows) {
    if (RUNNING.has(row.state)) running++
    if (RUNNING.has(row.state)) reserved += Math.max(0, row.estimated_cost_usd - row.observed_cost_usd)
    if (!RUNNING.has(row.state)) continue
    const value = classes.get(row.worker_class) || { total: 0, running: 0, cpu: 0, cpuN: 0, memory: 0, memoryN: 0 }
    value.total++
    if (RUNNING.has(row.state)) value.running++
    const fresh = row.heartbeat_at !== null && row.heartbeat_at >= now - 90
    if (fresh && typeof row.cpu_percent === 'number') { value.cpu += row.cpu_percent; value.cpuN++ }
    if (fresh && typeof row.memory_bytes === 'number') { value.memory += row.memory_bytes; value.memoryN++ }
    classes.set(row.worker_class, value)
  }
  const maxWorkers = flyWorkerLimit()
  const bottlenecks: Array<{ label: string; severity: 'warn' | 'error' }> = []
  const readiness = flyReadiness()
  for (const label of readiness) bottlenecks.push({label,severity:'warn'})
  if (queued > 0 && running >= maxWorkers) bottlenecks.push({ label: 'Worker concurrency limit reached', severity: 'warn' })
  // Completed command failures remain in history; they are not fleet outages.
  const status = !enabled ? 'disabled' : readiness.length ? 'blocked' : bottlenecks.length > 0 ? 'degraded' : 'healthy'
  return {
    status,
    updated_at: Math.floor(Date.now() / 1000),
    queue: { queued, running, failed, local },
    fleet: { running, total: running, capacity: maxWorkers, failed, workers: [...classes.entries()].map(([worker_class, value]) => ({
      worker_class, total: value.total, running: value.running,
      cpu_percent: value.cpuN ? Math.round(value.cpu / value.cpuN) : null,
      memory_bytes: value.memoryN ? Math.round(value.memory / value.memoryN) : null,
    })) },
    cost: {
      basis: 'Metered runtime estimate; compute only, not a Fly invoice',
      scope: 'Workspace spending; budgets enforced globally across Mission Control Fly submissions',
      observed_usd: Math.round(observed * 10000) / 10000,
      reserved_usd: Math.round(reserved * 10000) / 10000,
      daily_spend: Math.round(daily * 10000) / 10000, monthly_spend: Math.round(monthly * 10000) / 10000,
      daily_budget: flyNumber('MC_FLY_DAILY_BUDGET_USD'), monthly_budget: flyNumber('MC_FLY_MONTHLY_BUDGET_USD'),
    },
    mac: { local_jobs: local, pressure: local > 1 ? 'elevated' : 'normal', cpu_percent: host?.cpuPercent ?? 0,
      cpu_basis: host?.cpuBasis || (host ? 'host sample' : 'sampling'),
      memory_percent: host?.memoryPercent ?? Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100), swap_bytes: host?.swapBytes ?? 0 },
    bottlenecks,
  }
}
