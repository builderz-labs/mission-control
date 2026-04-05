import type Database from 'better-sqlite3'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentScore {
  agentName: string
  role: string
  rank: number
  score: number              // composite 0–100
  completionRate: number     // 0–1
  errorRate: number          // 0–1
  tokenEfficiency: number    // tasks per 1k tokens (raw)
  avgSpeedMs: number         // average task duration ms
  tasksTotal: number
  trend: 'up' | 'down' | 'stable'
  badges: string[]
}

// ---------------------------------------------------------------------------
// Internal row types (no SELECT *)
// ---------------------------------------------------------------------------

interface AgentRow { name: string; role: string }

interface TaskStatsRow {
  assigned_to: string
  outcome: string | null
  total: number
  avg_duration_ms: number | null
}

interface TokenRow {
  assigned_to: string
  total_tokens: number
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

const PERIOD_SECONDS: Record<string, number> = {
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400,
}

function periodToSeconds(period: string): number {
  return PERIOD_SECONDS[period] ?? PERIOD_SECONDS.week
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

function fetchTaskStats(
  db: Database.Database,
  workspaceId: number,
  since: number,
): TaskStatsRow[] {
  return db.prepare(`
    SELECT assigned_to,
           outcome,
           COUNT(*) as total,
           AVG(CAST(completed_at - created_at AS REAL) * 1000) as avg_duration_ms
    FROM tasks
    WHERE workspace_id = ?
      AND completed_at >= ?
      AND assigned_to IS NOT NULL
    GROUP BY assigned_to, outcome
  `).all(workspaceId, since) as TaskStatsRow[]
}

function fetchTokenUsage(
  db: Database.Database,
  workspaceId: number,
  since: number,
): TokenRow[] {
  try {
    return db.prepare(`
      SELECT assigned_to,
             COALESCE(SUM(input_tokens + output_tokens), 0) as total_tokens
      FROM token_usage
      WHERE workspace_id = ? AND created_at >= ? AND assigned_to IS NOT NULL
      GROUP BY assigned_to
    `).all(workspaceId, since) as TokenRow[]
  } catch {
    return []
  }
}

function fetchAgentRoles(
  db: Database.Database,
  workspaceId: number,
): AgentRow[] {
  return db.prepare(
    `SELECT name, role FROM agents WHERE workspace_id = ?`,
  ).all(workspaceId) as AgentRow[]
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

// completionRate*35 + (1-errorRate)*30 + tokenEfficiency_norm*20 + speed_norm*15
function computeScore(
  completionRate: number,
  errorRate: number,
  tokenEfficiencyNorm: number,
  speedNorm: number,
): number {
  const raw =
    completionRate * 35 +
    (1 - errorRate) * 30 +
    tokenEfficiencyNorm * 20 +
    speedNorm * 15
  return Math.round(Math.min(100, Math.max(0, raw)))
}

function normalize(values: number[]): number[] {
  const max = Math.max(...values, 1)
  return values.map(v => v / max)
}

function assignBadges(entry: {
  completionRate: number
  errorRate: number
  score: number
  tasksTotal: number
}): string[] {
  const badges: string[] = []
  if (entry.completionRate >= 0.95) badges.push('Perfect')
  if (entry.errorRate <= 0.02 && entry.tasksTotal >= 5) badges.push('Reliable')
  if (entry.score >= 90) badges.push('Elite')
  if (entry.tasksTotal >= 50) badges.push('Veteran')
  return badges
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function computeLeaderboard(
  workspaceId: number,
  db: Database.Database,
  period: string = 'week',
): AgentScore[] {
  const now = Math.floor(Date.now() / 1000)
  const since = now - periodToSeconds(period)

  const taskRows = fetchTaskStats(db, workspaceId, since)
  const tokenRows = fetchTokenUsage(db, workspaceId, since)
  const agentRows = fetchAgentRoles(db, workspaceId)

  const roleMap = new Map(agentRows.map(a => [a.name, a.role]))
  const tokenMap = new Map(tokenRows.map(r => [r.assigned_to, r.total_tokens]))

  // Aggregate per-agent across all outcomes
  const agentMap = new Map<string, {
    completed: number; failed: number; total: number; avgDurationMs: number
  }>()

  for (const row of taskRows) {
    const entry = agentMap.get(row.assigned_to) ?? {
      completed: 0, failed: 0, total: 0, avgDurationMs: 0,
    }
    const count = row.total
    if (row.outcome === 'success') entry.completed += count
    else if (row.outcome === 'failed') entry.failed += count
    entry.total += count
    if (row.avg_duration_ms) {
      // weighted average across outcome groups
      entry.avgDurationMs =
        (entry.avgDurationMs * (entry.total - count) + (row.avg_duration_ms * count)) /
        entry.total
    }
    agentMap.set(row.assigned_to, entry)
  }

  if (agentMap.size === 0) return []

  // Compute raw per-agent metrics
  const agents = Array.from(agentMap.entries()).map(([name, stats]) => {
    const completionRate = stats.total > 0 ? stats.completed / stats.total : 0
    const errorRate = stats.total > 0 ? stats.failed / stats.total : 0
    const tokens = tokenMap.get(name) ?? 0
    const tokenEfficiency = tokens > 0 ? (stats.completed / (tokens / 1000)) : stats.completed
    return { name, stats, completionRate, errorRate, tokenEfficiency }
  })

  // Normalize efficiency and speed across all agents
  const efficiencyValues = agents.map(a => a.tokenEfficiency)
  const speedValues = agents.map(a =>
    // Faster = higher score: invert by using 1/duration normalised
    a.stats.avgDurationMs > 0 ? 1 / a.stats.avgDurationMs : 1,
  )
  const efficiencyNorms = normalize(efficiencyValues)
  const speedNorms = normalize(speedValues)

  const scored = agents.map((a, i) => {
    const score = computeScore(
      a.completionRate,
      a.errorRate,
      efficiencyNorms[i],
      speedNorms[i],
    )
    return {
      agentName: a.name,
      role: roleMap.get(a.name) ?? 'specialist',
      rank: 0,
      score,
      completionRate: Math.round(a.completionRate * 1000) / 1000,
      errorRate: Math.round(a.errorRate * 1000) / 1000,
      tokenEfficiency: Math.round(a.tokenEfficiency * 100) / 100,
      avgSpeedMs: Math.round(a.stats.avgDurationMs),
      tasksTotal: a.stats.total,
      trend: 'stable' as const,
      badges: assignBadges({ completionRate: a.completionRate, errorRate: a.errorRate, score, tasksTotal: a.stats.total }),
    }
  })

  // Sort by score descending, assign ranks
  scored.sort((x, y) => y.score - x.score)
  return scored.map((entry, i) => ({ ...entry, rank: i + 1 }))
}
