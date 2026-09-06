import type Database from 'better-sqlite3'
import os from 'node:os'
import type { HostMetrics } from './host-metrics'

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
}

export interface FlyTelemetrySnapshot {
  status: 'disabled' | 'healthy' | 'degraded' | 'blocked'
  updated_at: number
  queue: { queued: number; running: number; failed: number; local: number }
  fleet: { running: number; total: number; capacity: number; failed: number; workers: Array<{ worker_class: string; total: number; running: number; cpu_percent: number | null; memory_bytes: number | null }> }
  cost: { observed_usd: number; reserved_usd: number; daily_spend: number; monthly_spend: number; daily_budget: number; monthly_budget: number }
  mac: { local_jobs: number; pressure: 'normal' | 'elevated'; cpu_percent: number; memory_percent: number; swap_bytes: number }
  bottlenecks: Array<{ label: string; severity: 'warn' | 'error' }>
}

const RUNNING = new Set(['creating', 'running', 'cleaning'])
const PENDING = new Set(['queued', 'creating'])

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function buildFlyTelemetry(db: Database.Database, workspaceId: number, host?: HostMetrics): FlyTelemetrySnapshot {
  const rows = db.prepare(`
    SELECT state, worker_class, execution_target, observed_cost_usd, estimated_cost_usd,
      runtime_seconds, cpu_percent, memory_bytes, swap_bytes, heartbeat_at, created_at
    FROM fly_worker_jobs WHERE workspace_id = ?
  `).all(workspaceId) as JobRow[]
  const enabled = process.env.MC_FLY_ENABLED === 'true'
  const classes = new Map<string, { total: number; running: number; cpu: number; cpuN: number; memory: number; memoryN: number }>()
  let queued = 0; let running = 0; let failed = 0; let local = 0; let observed = 0; let reserved = 0; let daily = 0; let monthly = 0
  const now = Math.floor(Date.now() / 1000)
  for (const row of rows) {
    observed += row.observed_cost_usd || 0
    if (row.created_at >= now - 86_400) daily += row.observed_cost_usd || 0
    if (row.created_at >= now - 30 * 86_400) monthly += row.observed_cost_usd || 0
    if (PENDING.has(row.state)) queued++
    if (RUNNING.has(row.state)) running++
    if (row.state === 'failed') failed++
    if (row.execution_target === 'local') local++
    if (RUNNING.has(row.state)) reserved += Math.max(0, row.estimated_cost_usd - row.observed_cost_usd)
    const value = classes.get(row.worker_class) || { total: 0, running: 0, cpu: 0, cpuN: 0, memory: 0, memoryN: 0 }
    value.total++
    if (RUNNING.has(row.state)) value.running++
    if (typeof row.cpu_percent === 'number') { value.cpu += row.cpu_percent; value.cpuN++ }
    if (typeof row.memory_bytes === 'number') { value.memory += row.memory_bytes; value.memoryN++ }
    classes.set(row.worker_class, value)
  }
  const maxWorkers = numberEnv('MC_FLY_MAX_WORKERS', 12)
  const bottlenecks: Array<{ label: string; severity: 'warn' | 'error' }> = []
  if (!enabled) bottlenecks.push({ label: 'Fly offload is disabled', severity: 'warn' })
  if (queued > 0 && running >= maxWorkers) bottlenecks.push({ label: 'Worker concurrency limit reached', severity: 'warn' })
  if (failed > 0) bottlenecks.push({ label: `${failed} worker job${failed === 1 ? '' : 's'} need attention`, severity: 'error' })
  const status = !enabled ? 'disabled' : failed > 0 || bottlenecks.length > 0 ? 'degraded' : 'healthy'
  return {
    status,
    updated_at: Math.floor(Date.now() / 1000),
    queue: { queued, running, failed, local },
    fleet: { running, total: rows.length, capacity: maxWorkers, failed, workers: [...classes.entries()].map(([worker_class, value]) => ({
      worker_class, total: value.total, running: value.running,
      cpu_percent: value.cpuN ? Math.round(value.cpu / value.cpuN) : null,
      memory_bytes: value.memoryN ? Math.round(value.memory / value.memoryN) : null,
    })) },
    cost: {
      observed_usd: Math.round(observed * 10000) / 10000,
      reserved_usd: Math.round(reserved * 10000) / 10000,
      daily_spend: Math.round(daily * 10000) / 10000, monthly_spend: Math.round(monthly * 10000) / 10000,
      daily_budget: numberEnv('MC_FLY_DAILY_BUDGET_USD', 10), monthly_budget: numberEnv('MC_FLY_MONTHLY_BUDGET_USD', 150),
    },
    mac: { local_jobs: local, pressure: local > 1 ? 'elevated' : 'normal', cpu_percent: host?.cpuPercent ?? Math.round(Math.min(100, (os.loadavg()[0] / Math.max(1, os.cpus().length)) * 100)), memory_percent: host?.memoryPercent ?? Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100), swap_bytes: host?.swapBytes ?? 0 },
    bottlenecks,
  }
}
