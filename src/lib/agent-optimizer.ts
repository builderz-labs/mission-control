/**
 * Agent Optimizer — token efficiency analysis and fleet benchmarking.
 *
 * Queries token_usage, tasks, mcp_call_log, and agent_trust_scores
 * to produce actionable recommendations for reducing agent cost and latency.
 */

import { getDatabase } from '@/lib/db'

export interface TokenEfficiency {
  agentName: string
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  totalCostUsd: number
  sessionsCount: number
  avgTokensPerSession: number
  avgCostPerSession: number
}

export interface ToolPatterns {
  agentName: string
  totalCalls: number
  uniqueTools: number
  topTools: Array<{ toolName: string; count: number; successRate: number }>
  failureRate: number
  avgDurationMs: number
}

export interface FleetBenchmark {
  agentName: string
  tokensPerTask: number
  costPerTask: number
  tasksCompleted: number
  trustScore: number
  toolCallsPerTask: number
}

export interface Recommendation {
  category: 'cost' | 'efficiency' | 'reliability' | 'trust'
  severity: 'info' | 'warning' | 'critical'
  message: string
  metric?: number
}

export function analyzeTokenEfficiency(
  agentName: string,
  hours: number = 24,
  workspaceId: number = 1,
): TokenEfficiency {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const row = db.prepare(`
    SELECT
      COUNT(*) as sessions,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(cost_usd), 0) as total_cost
    FROM token_usage
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const sessions = row?.sessions ?? 0
  const inputTokens = row?.input_tokens ?? 0
  const outputTokens = row?.output_tokens ?? 0
  const totalTokens = inputTokens + outputTokens

  return {
    agentName,
    totalInputTokens: inputTokens,
    totalOutputTokens: outputTokens,
    totalTokens,
    totalCostUsd: Math.round((row?.total_cost ?? 0) * 10000) / 10000,
    sessionsCount: sessions,
    avgTokensPerSession: sessions > 0 ? Math.round(totalTokens / sessions) : 0,
    avgCostPerSession: sessions > 0 ? Math.round((row?.total_cost ?? 0) / sessions * 10000) / 10000 : 0,
  }
}

export function analyzeToolPatterns(
  agentName: string,
  hours: number = 24,
  workspaceId: number = 1,
): ToolPatterns {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT tool_name) as unique_tools,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const topTools = db.prepare(`
    SELECT
      tool_name,
      COUNT(*) as count,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as success_rate
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
    GROUP BY tool_name
    ORDER BY count DESC
    LIMIT 10
  `).all(agentName, workspaceId, since) as any[]

  const total = totals?.total ?? 0

  return {
    agentName,
    totalCalls: total,
    uniqueTools: totals?.unique_tools ?? 0,
    topTools: topTools.map((t: any) => ({
      toolName: t.tool_name ?? 'unknown',
      count: t.count,
      successRate: Math.round(t.success_rate * 100) / 100,
    })),
    failureRate: total > 0 ? Math.round(((totals?.failures ?? 0) / total) * 10000) / 100 : 0,
    avgDurationMs: Math.round(totals?.avg_duration ?? 0),
  }
}

export function getFleetBenchmarks(workspaceId: number = 1): FleetBenchmark[] {
  const db = getDatabase()

  const rows = db.prepare(`
    SELECT
      a.agent_name,
      COALESCE(t.tokens_per_task, 0) as tokens_per_task,
      COALESCE(t.cost_per_task, 0) as cost_per_task,
      COALESCE(t.tasks_completed, 0) as tasks_completed,
      COALESCE(ats.trust_score, 1.0) as trust_score,
      COALESCE(m.tool_calls_per_task, 0) as tool_calls_per_task
    FROM (SELECT DISTINCT agent_name FROM agent_trust_scores WHERE workspace_id = ?) a
    LEFT JOIN (
      SELECT
        agent_name,
        CASE WHEN COUNT(DISTINCT task_id) > 0
          THEN SUM(input_tokens + output_tokens) * 1.0 / COUNT(DISTINCT task_id)
          ELSE 0
        END as tokens_per_task,
        CASE WHEN COUNT(DISTINCT task_id) > 0
          THEN SUM(COALESCE(cost_usd, 0)) * 1.0 / COUNT(DISTINCT task_id)
          ELSE 0
        END as cost_per_task,
        COUNT(DISTINCT task_id) as tasks_completed
      FROM token_usage
      WHERE task_id IS NOT NULL
      GROUP BY agent_name
    ) t ON t.agent_name = a.agent_name
    LEFT JOIN agent_trust_scores ats ON ats.agent_name = a.agent_name AND ats.workspace_id = ?
    LEFT JOIN (
      SELECT
        agent_name,
        COUNT(*) * 1.0 / NULLIF(
          (SELECT COUNT(DISTINCT task_id) FROM token_usage tu2 WHERE tu2.agent_name = mcl.agent_name AND tu2.task_id IS NOT NULL),
          0
        ) as tool_calls_per_task
      FROM mcp_call_log mcl
      WHERE workspace_id = ?
      GROUP BY agent_name
    ) m ON m.agent_name = a.agent_name
  `).all(workspaceId, workspaceId, workspaceId) as any[]

  return rows.map((r: any) => ({
    agentName: r.agent_name,
    tokensPerTask: Math.round(r.tokens_per_task),
    costPerTask: Math.round(r.cost_per_task * 10000) / 10000,
    tasksCompleted: r.tasks_completed,
    trustScore: Math.round(r.trust_score * 100) / 100,
    toolCallsPerTask: Math.round(r.tool_calls_per_task * 10) / 10,
  }))
}

export function generateRecommendations(
  agentName: string,
  workspaceId: number = 1,
): Recommendation[] {
  const recommendations: Recommendation[] = []
  const db = getDatabase()

  // Check trust score
  const trust = db.prepare(`
    SELECT * FROM agent_trust_scores WHERE agent_name = ? AND workspace_id = ?
  `).get(agentName, workspaceId) as any

  if (trust) {
    if (trust.trust_score < 0.5) {
      recommendations.push({
        category: 'trust',
        severity: 'critical',
        message: `Trust score is critically low (${trust.trust_score.toFixed(2)}). Review security events.`,
        metric: trust.trust_score,
      })
    } else if (trust.trust_score < 0.8) {
      recommendations.push({
        category: 'trust',
        severity: 'warning',
        message: `Trust score is below threshold (${trust.trust_score.toFixed(2)}). Monitor for anomalies.`,
        metric: trust.trust_score,
      })
    }

    if (trust.injection_attempts > 0) {
      recommendations.push({
        category: 'trust',
        severity: 'critical',
        message: `${trust.injection_attempts} injection attempt(s) detected. Investigate immediately.`,
        metric: trust.injection_attempts,
      })
    }
  }

  // Check tool failure rate
  const toolStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, Math.floor(Date.now() / 1000) - 86400) as any

  if (toolStats && toolStats.total > 10) {
    const failRate = toolStats.failures / toolStats.total
    if (failRate > 0.3) {
      recommendations.push({
        category: 'reliability',
        severity: 'warning',
        message: `Tool failure rate is ${(failRate * 100).toFixed(1)}% in the last 24h. Check failing tools.`,
        metric: failRate,
      })
    }
  }

  // Check token efficiency vs fleet average
  const agentCost = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost, COUNT(DISTINCT task_id) as tasks
    FROM token_usage
    WHERE agent_name = ? AND task_id IS NOT NULL AND workspace_id = ?
  `).get(agentName, workspaceId) as any

  const fleetAvg = db.prepare(`
    SELECT AVG(cost_per_task) as avg_cost FROM (
      SELECT SUM(COALESCE(cost_usd, 0)) * 1.0 / NULLIF(COUNT(DISTINCT task_id), 0) as cost_per_task
      FROM token_usage
      WHERE agent_name IS NOT NULL AND task_id IS NOT NULL AND workspace_id = ?
      GROUP BY agent_name
    )
  `).get(workspaceId) as any

  if (agentCost?.tasks > 0 && fleetAvg?.avg_cost > 0) {
    const agentCostPerTask = agentCost.cost / agentCost.tasks
    if (agentCostPerTask > fleetAvg.avg_cost * 2) {
      recommendations.push({
        category: 'cost',
        severity: 'warning',
        message: `Cost per task ($${agentCostPerTask.toFixed(4)}) is ${(agentCostPerTask / fleetAvg.avg_cost).toFixed(1)}x the fleet average.`,
        metric: agentCostPerTask,
      })
    }
  }

  return recommendations
}
