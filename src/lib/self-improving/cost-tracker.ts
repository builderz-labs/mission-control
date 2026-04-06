// Cost-tracking sub-module.
// Records per-invocation token usage and USD cost, then surfaces aggregate
// summaries per agent and per task type for the optimiser and dashboard.

import { getDatabase } from '../db'
import { calculateTokenCost } from '../token-pricing'
import type {
  AgentCostSummary,
  ABTestResult,
  CostDataPoint,
  CostRecord,
  TaskTypeCostSummary,
  TrendValue,
  TrendWindow,
} from './types'

// Agents must have at least this many samples before being included in
// comparative analyses — prevents conclusions from insufficient data.
const MIN_SAMPLES_FOR_ANALYSIS = 5

const TREND_PERIODS: Record<string, number> = {
  daily: 86400,
  weekly: 604800,
  monthly: 2592000,
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureCostTrackerTables(): void {
  const db = getDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      task_type TEXT,
      token_input INTEGER DEFAULT 0,
      token_output INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      duration_ms INTEGER,
      quality_score REAL,
      workspace_id INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_tracking_agent ON cost_tracking(agent_id, workspace_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_tracking_task ON cost_tracking(task_type, workspace_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_tracking_created ON cost_tracking(created_at)`)
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function recordCost(point: CostDataPoint): CostRecord {
  const db = getDatabase()
  const workspaceId = point.workspace_id ?? 1
  const costUsd = point.model_name
    ? calculateTokenCost(point.model_name, point.token_input, point.token_output)
    : 0

  const result = db.prepare(`
    INSERT INTO cost_tracking (agent_id, task_type, token_input, token_output, cost_usd, duration_ms, quality_score, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    point.agent_id,
    point.task_type ?? null,
    point.token_input,
    point.token_output,
    costUsd,
    point.duration_ms ?? null,
    point.quality_score ?? null,
    workspaceId,
  )

  return {
    id: Number(result.lastInsertRowid),
    agent_id: point.agent_id,
    task_type: point.task_type ?? null,
    token_input: point.token_input,
    token_output: point.token_output,
    cost_usd: costUsd,
    duration_ms: point.duration_ms ?? null,
    quality_score: point.quality_score ?? null,
    workspace_id: workspaceId,
    created_at: Math.floor(Date.now() / 1000),
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getCostByAgent(workspaceId: number): ReadonlyArray<AgentCostSummary> {
  const db = getDatabase()
  return db.prepare(`
    SELECT agent_id,
           SUM(cost_usd) as total_cost,
           SUM(token_input) as total_input,
           SUM(token_output) as total_output,
           AVG(cost_usd) as avg_cost,
           COUNT(*) as record_count
    FROM cost_tracking
    WHERE workspace_id = ?
    GROUP BY agent_id
    ORDER BY total_cost DESC
  `).all(workspaceId) as AgentCostSummary[]
}

export function getCostByTaskType(workspaceId: number): ReadonlyArray<TaskTypeCostSummary> {
  const db = getDatabase()
  return db.prepare(`
    SELECT task_type,
           SUM(cost_usd) as total_cost,
           AVG(cost_usd) as avg_cost,
           AVG(token_input + token_output) as avg_tokens,
           COUNT(*) as record_count
    FROM cost_tracking
    WHERE workspace_id = ? AND task_type IS NOT NULL
    GROUP BY task_type
    ORDER BY total_cost DESC
  `).all(workspaceId) as TaskTypeCostSummary[]
}

// ---------------------------------------------------------------------------
// A/B comparison
// ---------------------------------------------------------------------------

export function compareApproaches(
  taskType: string,
  workspaceId: number,
): ReadonlyArray<ABTestResult> {
  const db = getDatabase()

  const agents = db.prepare(`
    SELECT DISTINCT agent_id
    FROM cost_tracking
    WHERE workspace_id = ? AND task_type = ?
    GROUP BY agent_id
    HAVING COUNT(*) >= ?
  `).all(workspaceId, taskType, MIN_SAMPLES_FOR_ANALYSIS) as Array<{ agent_id: string }>

  if (agents.length < 2) return []

  const results: ABTestResult[] = []
  for (let i = 0; i < agents.length - 1; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const result = compareAgentPair(agents[i].agent_id, agents[j].agent_id, taskType, workspaceId)
      if (result) results.push(result)
    }
  }

  return results
}

function compareAgentPair(
  agentA: string,
  agentB: string,
  taskType: string,
  workspaceId: number,
): ABTestResult | null {
  const db = getDatabase()

  const statsA = db.prepare(`
    SELECT AVG(cost_usd) as avg_cost, AVG(quality_score) as avg_quality
    FROM cost_tracking
    WHERE agent_id = ? AND task_type = ? AND workspace_id = ?
  `).get(agentA, taskType, workspaceId) as { avg_cost: number; avg_quality: number | null } | undefined

  const statsB = db.prepare(`
    SELECT AVG(cost_usd) as avg_cost, AVG(quality_score) as avg_quality
    FROM cost_tracking
    WHERE agent_id = ? AND task_type = ? AND workspace_id = ?
  `).get(agentB, taskType, workspaceId) as { avg_cost: number; avg_quality: number | null } | undefined

  if (!statsA || !statsB) return null

  const costEfficiencyA = statsA.avg_quality != null
    ? (statsA.avg_quality / Math.max(statsA.avg_cost, 0.0001))
    : 0
  const costEfficiencyB = statsB.avg_quality != null
    ? (statsB.avg_quality / Math.max(statsB.avg_cost, 0.0001))
    : 0

  const winner = costEfficiencyA > costEfficiencyB * 1.05 ? 'a'
    : costEfficiencyB > costEfficiencyA * 1.05 ? 'b'
    : 'tie'

  return {
    task_type: taskType,
    approach_a: agentA,
    approach_b: agentB,
    winner,
    metric: 'cost_efficiency',
    value_a: costEfficiencyA,
    value_b: costEfficiencyB,
  }
}

// ---------------------------------------------------------------------------
// Trend analysis
// ---------------------------------------------------------------------------

export function analyzeTrend(
  metric: 'cost' | 'performance' | 'quality',
  period: 'daily' | 'weekly' | 'monthly',
  workspaceId: number,
): TrendWindow {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const periodSeconds = TREND_PERIODS[period]
  const windowStart = now - periodSeconds * 10

  const values = fetchTrendValues(db, metric, windowStart, workspaceId, periodSeconds)
  const direction = computeTrendDirection(values)

  return {
    period,
    metric,
    values,
    trend_direction: direction.direction,
    change_percent: direction.changePercent,
  }
}

function fetchTrendValues(
  db: ReturnType<typeof getDatabase>,
  metric: string,
  windowStart: number,
  workspaceId: number,
  periodSeconds: number,
): ReadonlyArray<TrendValue> {
  const column = metric === 'cost' ? 'AVG(cost_usd)'
    : metric === 'quality' ? 'AVG(quality_score)'
    : 'AVG(duration_ms)'

  const rows = db.prepare(`
    SELECT (created_at / ? * ?) as bucket_ts, ${column} as value
    FROM cost_tracking
    WHERE workspace_id = ? AND created_at >= ?
    GROUP BY bucket_ts
    ORDER BY bucket_ts ASC
  `).all(periodSeconds, periodSeconds, workspaceId, windowStart) as Array<{ bucket_ts: number; value: number | null }>

  return rows
    .filter((r): r is { bucket_ts: number; value: number } => r.value != null)
    .map((r) => ({ timestamp: r.bucket_ts, value: r.value }))
}

function computeTrendDirection(
  values: ReadonlyArray<TrendValue>,
): { direction: 'improving' | 'degrading' | 'stable'; changePercent: number } {
  if (values.length < 2) {
    return { direction: 'stable', changePercent: 0 }
  }

  const first = values[0].value
  const last = values[values.length - 1].value
  const changePercent = first !== 0 ? ((last - first) / Math.abs(first)) * 100 : 0
  const absChange = Math.abs(changePercent)

  if (absChange < 5) return { direction: 'stable', changePercent }
  return { direction: changePercent < 0 ? 'improving' : 'degrading', changePercent }
}
