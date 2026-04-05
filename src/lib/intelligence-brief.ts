import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligenceBrief {
  generatedAt: number       // unix timestamp (ms)
  weekOf: string            // ISO week "2026-W14"
  summary: {
    totalTasksCompleted: number
    totalTasksFailed: number
    completionRate: number
    totalCostUsd: number
    costChangePercent: number   // vs previous week
    activeAgents: number
    newPatternsLearned: number
  }
  topAgents: Array<{ name: string; tasksCompleted: number; role: string }>
  costMovers: Array<{ model: string; cost: number; changePercent: number }>
  anomalies: string[]
  recommendations: string[]
}

interface TaskCountRow { outcome: string | null; count: number }
interface AgentTaskRow { assigned_to: string; count: number }
interface CostRow { model_name: string | null; total_cost: number }
interface PatternCountRow { count: number }
interface AgentRoleRow { name: string; role: string }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentWeekLabel(): string {
  const now = new Date()
  // ISO week: Jan 4 is always in week 1
  const jan4 = new Date(now.getFullYear(), 0, 4)
  const weekNum = Math.ceil(
    ((now.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7,
  )
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

function getTaskStats(
  db: Database.Database,
  workspaceId: number,
  since: number,
  before: number,
): { completed: number; failed: number } {
  const rows = db.prepare(`
    SELECT outcome, COUNT(*) as count
    FROM tasks
    WHERE workspace_id = ? AND completed_at >= ? AND completed_at < ?
    GROUP BY outcome
  `).all(workspaceId, since, before) as TaskCountRow[]

  let completed = 0
  let failed = 0
  for (const r of rows) {
    if (r.outcome === 'success') completed += r.count
    else if (r.outcome === 'failed') failed += r.count
  }
  return { completed, failed }
}

function getCostForPeriod(
  db: Database.Database,
  workspaceId: number,
  since: number,
  before: number,
): number {
  try {
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total
      FROM cost_tracking
      WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
    `).get(workspaceId, since, before) as { total: number } | undefined
    return row?.total ?? 0
  } catch {
    return 0
  }
}

function getTopAgents(
  db: Database.Database,
  workspaceId: number,
  since: number,
  before: number,
): Array<{ name: string; tasksCompleted: number; role: string }> {
  const rows = db.prepare(`
    SELECT assigned_to, COUNT(*) as count
    FROM tasks
    WHERE workspace_id = ? AND outcome = 'success'
      AND completed_at >= ? AND completed_at < ?
      AND assigned_to IS NOT NULL
    GROUP BY assigned_to
    ORDER BY count DESC
    LIMIT 5
  `).all(workspaceId, since, before) as AgentTaskRow[]

  const agentRows = db.prepare(
    `SELECT name, role FROM agents WHERE workspace_id = ?`,
  ).all(workspaceId) as AgentRoleRow[]

  const roleMap = new Map(agentRows.map(a => [a.name, a.role]))

  return rows.map(r => ({
    name: r.assigned_to,
    tasksCompleted: r.count,
    role: roleMap.get(r.assigned_to) ?? 'specialist',
  }))
}

function getCostMovers(
  db: Database.Database,
  workspaceId: number,
  thisSince: number,
  thisBefore: number,
  prevSince: number,
): Array<{ model: string; cost: number; changePercent: number }> {
  try {
    const thisRows = db.prepare(`
      SELECT COALESCE(model_name, 'unknown') as model_name,
             COALESCE(SUM(cost_usd), 0) as total_cost
      FROM cost_tracking
      WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY model_name
    `).all(workspaceId, thisSince, thisBefore) as CostRow[]

    const prevRows = db.prepare(`
      SELECT COALESCE(model_name, 'unknown') as model_name,
             COALESCE(SUM(cost_usd), 0) as total_cost
      FROM cost_tracking
      WHERE workspace_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY model_name
    `).all(workspaceId, prevSince, thisSince) as CostRow[]

    const prevMap = new Map(prevRows.map(r => [r.model_name, r.total_cost]))

    return thisRows
      .map(r => {
        const prev = prevMap.get(r.model_name) ?? 0
        const changePercent = prev > 0
          ? Math.round(((r.total_cost - prev) / prev) * 100)
          : 100
        return { model: r.model_name ?? 'unknown', cost: r.total_cost, changePercent }
      })
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 4)
  } catch {
    return []
  }
}

function getNewPatterns(
  db: Database.Database,
  workspaceId: number,
  since: number,
): number {
  try {
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM learned_patterns
      WHERE workspace_id = ? AND created_at >= ?
    `).get(workspaceId, since) as PatternCountRow
    return row.count
  } catch {
    return 0
  }
}

function buildRecommendations(
  summary: IntelligenceBrief['summary'],
  topAgents: IntelligenceBrief['topAgents'],
  costMovers: IntelligenceBrief['costMovers'],
): string[] {
  const recs: string[] = []

  if (summary.completionRate < 0.5 && summary.totalTasksCompleted + summary.totalTasksFailed > 0) {
    recs.push('Task completion rate is below 50% — review error logs and consider reducing concurrent task load.')
  }

  if (summary.costChangePercent > 30) {
    recs.push(`Cost increased ${summary.costChangePercent}% this week — audit model selection and prompt efficiency.`)
  }

  const expensiveMover = costMovers.find(m => m.changePercent > 50)
  if (expensiveMover) {
    recs.push(`Model "${expensiveMover.model}" usage cost surged ${expensiveMover.changePercent}% — consider switching to a cheaper alternative.`)
  }

  if (summary.activeAgents > 0 && topAgents.length < summary.activeAgents * 0.5) {
    recs.push('More than half of active agents have zero completed tasks this week — consider reassigning workload.')
  }

  if (summary.newPatternsLearned > 20) {
    recs.push(`${summary.newPatternsLearned} new patterns learned this week — review top patterns to surface reusable automation.`)
  }

  if (recs.length === 0) {
    recs.push('System is performing within normal parameters. Continue monitoring cost trends.')
  }

  return recs.slice(0, 5)
}

function buildAnomalies(
  summary: IntelligenceBrief['summary'],
  costMovers: IntelligenceBrief['costMovers'],
): string[] {
  const anomalies: string[] = []

  if (summary.totalTasksFailed > summary.totalTasksCompleted) {
    anomalies.push('Task failures exceeded completions this week — high error rate detected.')
  }

  if (summary.costChangePercent > 100) {
    anomalies.push(`Cost more than doubled vs. last week (+${summary.costChangePercent}%).`)
  }

  const spike = costMovers.find(m => m.changePercent > 200)
  if (spike) {
    anomalies.push(`Model "${spike.model}" cost spiked ${spike.changePercent}% — possible runaway usage.`)
  }

  return anomalies
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function generateWeeklyBrief(
  workspaceId: number,
  db: Database.Database,
): IntelligenceBrief {
  const now = Math.floor(Date.now() / 1000)
  const weekAgo = now - 7 * 86400
  const twoWeeksAgo = now - 14 * 86400

  const thisStats = getTaskStats(db, workspaceId, weekAgo, now)
  const prevStats = getTaskStats(db, workspaceId, twoWeeksAgo, weekAgo)
  const thisCost = getCostForPeriod(db, workspaceId, weekAgo, now)
  const prevCost = getCostForPeriod(db, workspaceId, twoWeeksAgo, weekAgo)

  const costChangePercent = prevCost > 0
    ? Math.round(((thisCost - prevCost) / prevCost) * 100)
    : 0

  const totalDone = thisStats.completed + thisStats.failed
  const completionRate = totalDone > 0 ? thisStats.completed / totalDone : 0

  const activeAgentsRow = db.prepare(`
    SELECT COUNT(*) as count FROM agents WHERE workspace_id = ? AND status != 'offline'
  `).get(workspaceId) as { count: number }

  const summary: IntelligenceBrief['summary'] = {
    totalTasksCompleted: thisStats.completed,
    totalTasksFailed: thisStats.failed,
    completionRate: Math.round(completionRate * 100) / 100,
    totalCostUsd: Math.round(thisCost * 10000) / 10000,
    costChangePercent,
    activeAgents: activeAgentsRow.count,
    newPatternsLearned: getNewPatterns(db, workspaceId, weekAgo),
  }

  const topAgents = getTopAgents(db, workspaceId, weekAgo, now)
  const costMovers = getCostMovers(db, workspaceId, weekAgo, now, twoWeeksAgo)
  const anomalies = buildAnomalies(summary, costMovers)
  const recommendations = buildRecommendations(summary, topAgents, costMovers)

  // Previous week comparison (unused beyond what's captured in summary)
  void prevStats

  return {
    generatedAt: Date.now(),
    weekOf: currentWeekLabel(),
    summary,
    topAgents,
    costMovers,
    anomalies,
    recommendations,
  }
}
