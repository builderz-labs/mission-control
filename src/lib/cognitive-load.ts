/**
 * Cognitive Load Computation
 *
 * Pure module — no DB, no side effects.
 * Consumed by the /api/agents/cognitive-load route and the heatmap widget.
 */

import type Database from 'better-sqlite3'

export interface CognitiveLoadScore {
  readonly score: number           // 0-100 composite
  readonly level: 'healthy' | 'warning' | 'critical'
  readonly activeTasks: number
  readonly pendingTasks: number
  readonly errorRate: number       // 0-1
  readonly tokenBurnRate: number   // tokens per hour (estimate)
  readonly lastSeen: number | null
}

interface LoadMetrics {
  readonly activeTasks: number
  readonly pendingTasks: number
  readonly errorCount: number
  readonly totalActivities: number
  readonly recentTokens: number
  readonly lastSeen: number | null
}

// Token burn is normalised against a 5 000 token/h baseline per agent
const TOKEN_BURN_BASELINE = 5000

export function computeCognitiveLoad(metrics: LoadMetrics): CognitiveLoadScore {
  const errorRate = metrics.totalActivities > 0
    ? metrics.errorCount / metrics.totalActivities
    : 0

  const tokenBurnRate = metrics.recentTokens // already per-hour from caller

  // Composite score — weighted sum capped at 100
  const raw =
    metrics.activeTasks * 15 +
    metrics.pendingTasks * 8 +
    errorRate * 40 +
    (Math.min(tokenBurnRate, TOKEN_BURN_BASELINE) / TOKEN_BURN_BASELINE) * 20

  const score = Math.min(Math.round(raw), 100)

  const level: CognitiveLoadScore['level'] =
    score <= 30 ? 'healthy' :
    score <= 65 ? 'warning' :
    'critical'

  return {
    score,
    level,
    activeTasks: metrics.activeTasks,
    pendingTasks: metrics.pendingTasks,
    errorRate,
    tokenBurnRate,
    lastSeen: metrics.lastSeen,
  }
}

// ── DB query helpers ──────────────────────────────────────────────────────────

interface AgentRow {
  id: number
  name: string
  last_seen: number | null
}

interface TaskCountRow {
  agentName: string
  count: number
}

interface ActivityCountRow {
  agentName: string
  total: number
  errors: number
}

interface TokenRow {
  sessionId: string
  tokens: number
}

export interface AgentRawMetrics {
  readonly agentId: number
  readonly agentName: string
  readonly activeTasks: number
  readonly pendingTasks: number
  readonly errorCount: number
  readonly totalActivities: number
  readonly recentTokens: number
  readonly lastSeen: number | null
}

export function fetchAllAgentMetrics(
  db: Database.Database,
  workspaceId: number
): AgentRawMetrics[] {
  const now = Math.floor(Date.now() / 1000)
  const since24h = now - 86400
  const since2h  = now - 7200

  const agents = db.prepare(
    `SELECT id, name, last_seen FROM agents WHERE workspace_id = ?`
  ).all(workspaceId) as AgentRow[]

  if (agents.length === 0) return []

  const activeCounts = db.prepare(
    `SELECT assigned_to AS agentName, COUNT(*) AS count
     FROM tasks
     WHERE workspace_id = ? AND status = 'in_progress'
     GROUP BY assigned_to`
  ).all(workspaceId) as TaskCountRow[]

  const pendingCounts = db.prepare(
    `SELECT assigned_to AS agentName, COUNT(*) AS count
     FROM tasks
     WHERE workspace_id = ? AND status = 'pending'
     GROUP BY assigned_to`
  ).all(workspaceId) as TaskCountRow[]

  const activityCounts = db.prepare(
    `SELECT actor AS agentName,
            COUNT(*) AS total,
            SUM(CASE WHEN type LIKE '%error%' OR type LIKE '%fail%' THEN 1 ELSE 0 END) AS errors
     FROM activities
     WHERE workspace_id = ? AND created_at >= ?
     GROUP BY actor`
  ).all(workspaceId, since24h) as ActivityCountRow[]

  // token_usage may not exist — guard with try/catch
  let tokenRows: TokenRow[] = []
  try {
    tokenRows = db.prepare(
      `SELECT session_id AS sessionId,
              SUM(input_tokens + output_tokens) AS tokens
       FROM token_usage
       WHERE workspace_id = ? AND created_at >= ?
       GROUP BY session_id`
    ).all(workspaceId, since2h) as TokenRow[]
  } catch {
    // table absent — leave empty
  }

  const activeMap  = new Map(activeCounts.map(r  => [r.agentName,  r.count]))
  const pendingMap = new Map(pendingCounts.map(r  => [r.agentName,  r.count]))
  const activityMap = new Map(activityCounts.map(r => [r.agentName, r]))
  // token_usage session_id stores agent name; sum tokens per agent name
  const tokenMap = new Map<string, number>()
  for (const row of tokenRows) {
    tokenMap.set(row.sessionId, (tokenMap.get(row.sessionId) ?? 0) + row.tokens)
  }

  return agents.map((agent) => {
    const activity = activityMap.get(agent.name)
    // recentTokens is raw sum over 2h — divide by 2 to get per-hour estimate
    const rawTokens = tokenMap.get(agent.name) ?? 0
    return {
      agentId: agent.id,
      agentName: agent.name,
      activeTasks: activeMap.get(agent.name) ?? 0,
      pendingTasks: pendingMap.get(agent.name) ?? 0,
      errorCount: activity?.errors ?? 0,
      totalActivities: activity?.total ?? 0,
      recentTokens: Math.round(rawTokens / 2),
      lastSeen: agent.last_seen ?? null,
    }
  })
}
