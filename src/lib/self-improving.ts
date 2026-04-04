import { getDatabase } from './db'
import { calculateTokenCost } from './token-pricing'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerformanceBaseline {
  id: number
  operation_name: string
  baseline_ms: number
  current_avg_ms: number | null
  sample_count: number
  regression_detected: number
  workspace_id: number
  created_at: number
  updated_at: number
}

export interface CostRecord {
  id: number
  agent_id: string
  task_type: string | null
  token_input: number
  token_output: number
  cost_usd: number
  duration_ms: number | null
  quality_score: number | null
  workspace_id: number
  created_at: number
}

export type SuggestionCategory = 'performance' | 'cost' | 'quality' | 'architecture'
export type SuggestionSeverity = 'info' | 'warning' | 'critical'
export type SuggestionStatus = 'pending' | 'accepted' | 'rejected' | 'implemented'

export interface ImprovementSuggestion {
  id: number
  category: SuggestionCategory
  severity: SuggestionSeverity
  title: string
  description: string
  evidence: string | null
  status: SuggestionStatus
  workspace_id: number
  created_at: number
  resolved_at: number | null
}

export interface PerformanceDataPoint {
  operation_name: string
  duration_ms: number
  workspace_id?: number
}

export interface CostDataPoint {
  agent_id: string
  task_type?: string
  model_name?: string
  token_input: number
  token_output: number
  duration_ms?: number
  quality_score?: number
  workspace_id?: number
}

export interface ABTestResult {
  task_type: string
  approach_a: string
  approach_b: string
  winner: 'a' | 'b' | 'tie'
  metric: string
  value_a: number
  value_b: number
}

export interface TrendWindow {
  period: 'daily' | 'weekly' | 'monthly'
  metric: string
  values: ReadonlyArray<{ timestamp: number; value: number }>
  trend_direction: 'improving' | 'degrading' | 'stable'
  change_percent: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REGRESSION_THRESHOLD = 0.20
const COST_COMPARISON_THRESHOLD = 3.0
const MIN_SAMPLES_FOR_ANALYSIS = 5
const TREND_PERIODS: Record<string, number> = {
  daily: 86400,
  weekly: 604800,
  monthly: 2592000,
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

function ensureTables(): void {
  const db = getDatabase()

  db.exec(`
    CREATE TABLE IF NOT EXISTS performance_baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_name TEXT NOT NULL,
      baseline_ms REAL NOT NULL,
      current_avg_ms REAL,
      sample_count INTEGER DEFAULT 0,
      regression_detected INTEGER DEFAULT 0,
      workspace_id INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `)

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS improvement_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT CHECK(category IN ('performance', 'cost', 'quality', 'architecture')),
      severity TEXT CHECK(severity IN ('info', 'warning', 'critical')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      evidence TEXT,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected', 'implemented')) DEFAULT 'pending',
      workspace_id INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      resolved_at INTEGER
    )
  `)

  db.exec(`CREATE INDEX IF NOT EXISTS idx_perf_baselines_op ON performance_baselines(operation_name, workspace_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_tracking_agent ON cost_tracking(agent_id, workspace_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_tracking_task ON cost_tracking(task_type, workspace_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cost_tracking_created ON cost_tracking(created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_status ON improvement_suggestions(status, workspace_id)`)
}

// ---------------------------------------------------------------------------
// Performance Profiler
// ---------------------------------------------------------------------------

function recordPerformanceSample(point: PerformanceDataPoint): PerformanceBaseline {
  const db = getDatabase()
  const workspaceId = point.workspace_id ?? 1

  const existing = db.prepare(
    'SELECT id, operation_name, baseline_ms, current_avg_ms, sample_count, regression_detected, workspace_id, created_at, updated_at FROM performance_baselines WHERE operation_name = ? AND workspace_id = ?'
  ).get(point.operation_name, workspaceId) as PerformanceBaseline | undefined

  if (!existing) {
    return createBaseline(point.operation_name, point.duration_ms, workspaceId)
  }

  return updateBaseline(existing, point.duration_ms)
}

function createBaseline(operationName: string, durationMs: number, workspaceId: number): PerformanceBaseline {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const result = db.prepare(`
    INSERT INTO performance_baselines (operation_name, baseline_ms, current_avg_ms, sample_count, workspace_id, created_at, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?)
  `).run(operationName, durationMs, durationMs, workspaceId, now, now)

  return {
    id: Number(result.lastInsertRowid),
    operation_name: operationName,
    baseline_ms: durationMs,
    current_avg_ms: durationMs,
    sample_count: 1,
    regression_detected: 0,
    workspace_id: workspaceId,
    created_at: now,
    updated_at: now,
  }
}

function updateBaseline(existing: PerformanceBaseline, durationMs: number): PerformanceBaseline {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const newCount = existing.sample_count + 1
  const prevAvg = existing.current_avg_ms ?? existing.baseline_ms
  const newAvg = prevAvg + (durationMs - prevAvg) / newCount
  const regressionDetected = newAvg > existing.baseline_ms * (1 + REGRESSION_THRESHOLD) ? 1 : 0

  db.prepare(`
    UPDATE performance_baselines
    SET current_avg_ms = ?, sample_count = ?, regression_detected = ?, updated_at = ?
    WHERE id = ?
  `).run(newAvg, newCount, regressionDetected, now, existing.id)

  return {
    ...existing,
    current_avg_ms: newAvg,
    sample_count: newCount,
    regression_detected: regressionDetected,
    updated_at: now,
  }
}

function getBaselines(workspaceId: number): ReadonlyArray<PerformanceBaseline> {
  const db = getDatabase()
  return db.prepare(
    'SELECT id, operation_name, baseline_ms, current_avg_ms, sample_count, regression_detected, workspace_id, created_at, updated_at FROM performance_baselines WHERE workspace_id = ? ORDER BY operation_name'
  ).all(workspaceId) as PerformanceBaseline[]
}

function getRegressions(workspaceId: number): ReadonlyArray<PerformanceBaseline> {
  const db = getDatabase()
  return db.prepare(
    'SELECT id, operation_name, baseline_ms, current_avg_ms, sample_count, regression_detected, workspace_id, created_at, updated_at FROM performance_baselines WHERE workspace_id = ? AND regression_detected = 1 ORDER BY updated_at DESC'
  ).all(workspaceId) as PerformanceBaseline[]
}

// ---------------------------------------------------------------------------
// Cost Optimizer
// ---------------------------------------------------------------------------

function recordCost(point: CostDataPoint): CostRecord {
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

interface AgentCostSummary {
  agent_id: string
  total_cost: number
  total_input: number
  total_output: number
  avg_cost: number
  record_count: number
}

function getCostByAgent(workspaceId: number): ReadonlyArray<AgentCostSummary> {
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

interface TaskTypeCostSummary {
  task_type: string
  total_cost: number
  avg_cost: number
  avg_tokens: number
  record_count: number
}

function getCostByTaskType(workspaceId: number): ReadonlyArray<TaskTypeCostSummary> {
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
// Quality Scorer
// ---------------------------------------------------------------------------

interface QualitySummary {
  agent_id: string
  avg_quality: number
  min_quality: number
  max_quality: number
  record_count: number
}

function getQualityScores(workspaceId: number): ReadonlyArray<QualitySummary> {
  const db = getDatabase()
  return db.prepare(`
    SELECT agent_id,
           AVG(quality_score) as avg_quality,
           MIN(quality_score) as min_quality,
           MAX(quality_score) as max_quality,
           COUNT(*) as record_count
    FROM cost_tracking
    WHERE workspace_id = ? AND quality_score IS NOT NULL
    GROUP BY agent_id
    ORDER BY avg_quality DESC
  `).all(workspaceId) as QualitySummary[]
}

// ---------------------------------------------------------------------------
// Improvement Suggestions
// ---------------------------------------------------------------------------

function createSuggestion(
  category: SuggestionCategory,
  severity: SuggestionSeverity,
  title: string,
  description: string,
  evidence: string | null,
  workspaceId: number,
): ImprovementSuggestion {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO improvement_suggestions (category, severity, title, description, evidence, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(category, severity, title, description, evidence, workspaceId)

  return {
    id: Number(result.lastInsertRowid),
    category,
    severity,
    title,
    description,
    evidence,
    status: 'pending',
    workspace_id: workspaceId,
    created_at: Math.floor(Date.now() / 1000),
    resolved_at: null,
  }
}

function updateSuggestionStatus(
  id: number,
  status: SuggestionStatus,
  workspaceId: number,
): ImprovementSuggestion | null {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const resolvedAt = (status === 'implemented' || status === 'rejected') ? now : null

  db.prepare(`
    UPDATE improvement_suggestions
    SET status = ?, resolved_at = ?
    WHERE id = ? AND workspace_id = ?
  `).run(status, resolvedAt, id, workspaceId)

  return db.prepare(
    'SELECT id, category, severity, title, description, evidence, status, workspace_id, created_at, resolved_at FROM improvement_suggestions WHERE id = ? AND workspace_id = ?'
  ).get(id, workspaceId) as ImprovementSuggestion | null
}

function getSuggestions(workspaceId: number, status?: SuggestionStatus): ReadonlyArray<ImprovementSuggestion> {
  const db = getDatabase()

  if (status) {
    return db.prepare(
      'SELECT id, category, severity, title, description, evidence, status, workspace_id, created_at, resolved_at FROM improvement_suggestions WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(workspaceId, status) as ImprovementSuggestion[]
  }

  return db.prepare(
    'SELECT id, category, severity, title, description, evidence, status, workspace_id, created_at, resolved_at FROM improvement_suggestions WHERE workspace_id = ? ORDER BY created_at DESC'
  ).all(workspaceId) as ImprovementSuggestion[]
}

// ---------------------------------------------------------------------------
// A/B Testing Framework
// ---------------------------------------------------------------------------

function compareApproaches(
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

  const costEfficiencyA = statsA.avg_quality != null ? (statsA.avg_quality / Math.max(statsA.avg_cost, 0.0001)) : 0
  const costEfficiencyB = statsB.avg_quality != null ? (statsB.avg_quality / Math.max(statsB.avg_cost, 0.0001)) : 0

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
// Trend Analysis
// ---------------------------------------------------------------------------

function analyzeTrend(
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

interface TrendValue {
  timestamp: number
  value: number
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

// ---------------------------------------------------------------------------
// Auto-generate improvement suggestions
// ---------------------------------------------------------------------------

function generateSuggestions(workspaceId: number): ReadonlyArray<ImprovementSuggestion> {
  const created: ImprovementSuggestion[] = []

  const regressionSuggestions = generateRegressionSuggestions(workspaceId)
  created.push(...regressionSuggestions)

  const costSuggestions = generateCostSuggestions(workspaceId)
  created.push(...costSuggestions)

  const qualitySuggestions = generateQualitySuggestions(workspaceId)
  created.push(...qualitySuggestions)

  return created
}

function generateRegressionSuggestions(workspaceId: number): ImprovementSuggestion[] {
  const regressions = getRegressions(workspaceId)
  const created: ImprovementSuggestion[] = []

  for (const reg of regressions) {
    const pctSlower = reg.current_avg_ms && reg.baseline_ms
      ? Math.round(((reg.current_avg_ms - reg.baseline_ms) / reg.baseline_ms) * 100)
      : 0

    const suggestion = createSuggestion(
      'performance',
      pctSlower > 50 ? 'critical' : 'warning',
      `Performance regression: ${reg.operation_name}`,
      `Operation "${reg.operation_name}" is ${pctSlower}% slower than baseline (${Math.round(reg.baseline_ms)}ms -> ${Math.round(reg.current_avg_ms ?? 0)}ms).`,
      JSON.stringify({ baseline_ms: reg.baseline_ms, current_avg_ms: reg.current_avg_ms, sample_count: reg.sample_count }),
      workspaceId,
    )
    created.push(suggestion)
  }

  return created
}

function generateCostSuggestions(workspaceId: number): ImprovementSuggestion[] {
  const agentCosts = getCostByAgent(workspaceId)
  const created: ImprovementSuggestion[] = []

  if (agentCosts.length < 2) return created

  const avgCostAcrossAgents = agentCosts.reduce((sum, a) => sum + a.avg_cost, 0) / agentCosts.length

  for (const agent of agentCosts) {
    if (agent.avg_cost > avgCostAcrossAgents * COST_COMPARISON_THRESHOLD && agent.record_count >= MIN_SAMPLES_FOR_ANALYSIS) {
      const suggestion = createSuggestion(
        'cost',
        'warning',
        `High cost agent: ${agent.agent_id}`,
        `Agent "${agent.agent_id}" averages $${agent.avg_cost.toFixed(4)} per task, ${(agent.avg_cost / avgCostAcrossAgents).toFixed(1)}x the average across all agents.`,
        JSON.stringify({ avg_cost: agent.avg_cost, avg_across_agents: avgCostAcrossAgents, total_cost: agent.total_cost }),
        workspaceId,
      )
      created.push(suggestion)
    }
  }

  return created
}

function generateQualitySuggestions(workspaceId: number): ImprovementSuggestion[] {
  const quality = getQualityScores(workspaceId)
  const created: ImprovementSuggestion[] = []

  for (const q of quality) {
    if (q.avg_quality < 0.5 && q.record_count >= MIN_SAMPLES_FOR_ANALYSIS) {
      const suggestion = createSuggestion(
        'quality',
        q.avg_quality < 0.3 ? 'critical' : 'warning',
        `Low quality scores: ${q.agent_id}`,
        `Agent "${q.agent_id}" has an average quality score of ${q.avg_quality.toFixed(2)} across ${q.record_count} tasks.`,
        JSON.stringify({ avg_quality: q.avg_quality, min_quality: q.min_quality, max_quality: q.max_quality }),
        workspaceId,
      )
      created.push(suggestion)
    }
  }

  return created
}

// ---------------------------------------------------------------------------
// Dashboard summary
// ---------------------------------------------------------------------------

export interface DashboardSummary {
  baselines: ReadonlyArray<PerformanceBaseline>
  regressions: ReadonlyArray<PerformanceBaseline>
  cost_by_agent: ReadonlyArray<AgentCostSummary>
  cost_by_task_type: ReadonlyArray<TaskTypeCostSummary>
  quality_scores: ReadonlyArray<QualitySummary>
  suggestions: ReadonlyArray<ImprovementSuggestion>
  trends: {
    cost: TrendWindow
    performance: TrendWindow
    quality: TrendWindow
  }
}

function getDashboard(workspaceId: number): DashboardSummary {
  return {
    baselines: getBaselines(workspaceId),
    regressions: getRegressions(workspaceId),
    cost_by_agent: getCostByAgent(workspaceId),
    cost_by_task_type: getCostByTaskType(workspaceId),
    quality_scores: getQualityScores(workspaceId),
    suggestions: getSuggestions(workspaceId, 'pending'),
    trends: {
      cost: analyzeTrend('cost', 'weekly', workspaceId),
      performance: analyzeTrend('performance', 'weekly', workspaceId),
      quality: analyzeTrend('quality', 'weekly', workspaceId),
    },
  }
}

// ---------------------------------------------------------------------------
// Engine class (singleton)
// ---------------------------------------------------------------------------

class SelfImprovingEngine {
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    try {
      ensureTables()
      this.initialized = true
      logger.info('Self-improving engine initialized')
    } catch (err) {
      logger.error({ err }, 'Failed to initialize self-improving engine')
    }
  }

  recordPerformance(point: PerformanceDataPoint): PerformanceBaseline {
    this.ensureReady()
    return recordPerformanceSample(point)
  }

  recordCost(point: CostDataPoint): CostRecord {
    this.ensureReady()
    return recordCost(point)
  }

  updateSuggestionStatus(
    id: number,
    status: SuggestionStatus,
    workspaceId: number,
  ): ImprovementSuggestion | null {
    this.ensureReady()
    return updateSuggestionStatus(id, status, workspaceId)
  }

  generateSuggestions(workspaceId: number): ReadonlyArray<ImprovementSuggestion> {
    this.ensureReady()
    const suggestions = generateSuggestions(workspaceId)
    logger.info(
      { workspaceId, count: suggestions.length },
      'Self-improving cycle: suggestions generated'
    )
    return suggestions
  }

  compareApproaches(taskType: string, workspaceId: number): ReadonlyArray<ABTestResult> {
    this.ensureReady()
    return compareApproaches(taskType, workspaceId)
  }

  analyzeTrend(
    metric: 'cost' | 'performance' | 'quality',
    period: 'daily' | 'weekly' | 'monthly',
    workspaceId: number,
  ): TrendWindow {
    this.ensureReady()
    return analyzeTrend(metric, period, workspaceId)
  }

  getDashboard(workspaceId: number): DashboardSummary {
    this.ensureReady()
    return getDashboard(workspaceId)
  }

  getBaselines(workspaceId: number): ReadonlyArray<PerformanceBaseline> {
    this.ensureReady()
    return getBaselines(workspaceId)
  }

  getSuggestions(workspaceId: number, status?: SuggestionStatus): ReadonlyArray<ImprovementSuggestion> {
    this.ensureReady()
    return getSuggestions(workspaceId, status)
  }

  getQualityScores(workspaceId: number): ReadonlyArray<QualitySummary> {
    this.ensureReady()
    return getQualityScores(workspaceId)
  }

  getCostByAgent(workspaceId: number): ReadonlyArray<AgentCostSummary> {
    this.ensureReady()
    return getCostByAgent(workspaceId)
  }

  private ensureReady(): void {
    if (!this.initialized) {
      this.initialize()
    }
  }
}

// Singleton with HMR safety
const globalEngine = globalThis as typeof globalThis & { __selfImprovingEngine?: SelfImprovingEngine }
export const selfImprovingEngine = globalEngine.__selfImprovingEngine ?? new SelfImprovingEngine()
globalEngine.__selfImprovingEngine = selfImprovingEngine
