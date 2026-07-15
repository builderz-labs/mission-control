/**
 * Agent Evals — four-layer evaluation engine for agent performance.
 *
 * Layer 1 (Output): Task completion and correctness scoring
 * Layer 2 (Trace): Convergence analysis and reasoning coherence
 * Layer 3 (Component): Tool reliability from MCP call logs
 * Layer 4 (Drift): Rolling baseline comparison with threshold detection
 */

import { getDatabase } from '@/lib/db'

export type EvalLayer = 'output' | 'trace' | 'component' | 'drift'

export interface EvalResult {
  layer: EvalLayer
  score: number
  passed: boolean
  detail: string
}

export interface DriftResult {
  metric: string
  current: number
  baseline: number
  delta: number
  drifted: boolean
  threshold: number
}

// ---------------------------------------------------------------------------
// Layer 1: Output Evals
// ---------------------------------------------------------------------------

export function evalTaskCompletion(
  agentName: string,
  hours: number = 168,
  workspaceId: number = 1,
): EvalResult {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successful
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const total = row?.total ?? 0
  const completed = row?.completed ?? 0
  const score = total > 0 ? completed / total : 1.0

  return {
    layer: 'output',
    score: Math.round(score * 100) / 100,
    passed: score >= 0.7,
    detail: `${completed}/${total} tasks completed (${(score * 100).toFixed(0)}%)`,
  }
}

export function evalCorrectnessScore(
  agentName: string,
  hours: number = 168,
  workspaceId: number = 1,
): EvalResult {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) as successful,
      AVG(CASE WHEN feedback_rating IS NOT NULL THEN feedback_rating ELSE NULL END) as avg_rating
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND status = 'done' AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const total = row?.total ?? 0
  const successful = row?.successful ?? 0
  const successRate = total > 0 ? successful / total : 1.0
  const avgRating = row?.avg_rating
  // Blend success rate with feedback rating if available (normalized to 0-1 assuming 1-5 scale)
  const score = avgRating != null
    ? (successRate * 0.6 + ((avgRating - 1) / 4) * 0.4)
    : successRate

  return {
    layer: 'output',
    score: Math.round(score * 100) / 100,
    passed: score >= 0.6,
    detail: `Correctness: ${(score * 100).toFixed(0)}% (${successful}/${total} successful${avgRating != null ? `, avg rating ${avgRating.toFixed(1)}` : ''})`,
  }
}

export function runOutputEvals(
  agentName: string,
  hours: number = 168,
  workspaceId: number = 1,
): EvalResult[] {
  return [
    evalTaskCompletion(agentName, hours, workspaceId),
    evalCorrectnessScore(agentName, hours, workspaceId),
  ]
}

// ---------------------------------------------------------------------------
// Layer 2: Trace Evals
// ---------------------------------------------------------------------------

export function convergenceScore(
  totalToolCalls: number,
  uniqueTools: number,
): { score: number; looping: boolean } {
  if (uniqueTools === 0) return { score: 1.0, looping: false }
  const ratio = totalToolCalls / uniqueTools
  // ratio > 3.0 indicates looping behavior
  return {
    score: Math.round(Math.min(1.0, 3.0 / ratio) * 100) / 100,
    looping: ratio > 3.0,
  }
}

export function evalReasoningCoherence(
  agentName: string,
  hours: number = 24,
  workspaceId: number = 1,
): EvalResult {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const row = db.prepare(`
    SELECT
      COUNT(*) as total_calls,
      COUNT(DISTINCT tool_name) as unique_tools
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const total = row?.total_calls ?? 0
  const unique = row?.unique_tools ?? 0
  const { score, looping } = convergenceScore(total, unique)

  return {
    layer: 'trace',
    score,
    passed: !looping,
    detail: `Convergence: ${total} calls across ${unique} unique tools (ratio ${unique > 0 ? (total / unique).toFixed(1) : 'N/A'})${looping ? ' — LOOPING DETECTED' : ''}`,
  }
}

// ---------------------------------------------------------------------------
// Layer 3: Component Evals
// ---------------------------------------------------------------------------

export function evalToolReliability(
  agentName: string,
  hours: number = 24,
  workspaceId: number = 1,
): EvalResult {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const total = row?.total ?? 0
  const successes = row?.successes ?? 0
  const score = total > 0 ? successes / total : 1.0

  return {
    layer: 'component',
    score: Math.round(score * 100) / 100,
    passed: score >= 0.8,
    detail: `Tool reliability: ${successes}/${total} successful (${(score * 100).toFixed(0)}%)`,
  }
}

// ---------------------------------------------------------------------------
// Layer 4: Drift Detection
// ---------------------------------------------------------------------------

const DRIFT_THRESHOLD = 0.10

export function checkDrift(
  current: number,
  baseline: number,
  threshold: number = DRIFT_THRESHOLD,
): DriftResult {
  const delta = baseline !== 0
    ? Math.abs(current - baseline) / Math.abs(baseline)
    : current !== 0 ? 1.0 : 0.0

  return {
    metric: '',
    current,
    baseline,
    delta: Math.round(delta * 10000) / 10000,
    drifted: delta > threshold,
    threshold,
  }
}

export function runDriftCheck(
  agentName: string,
  workspaceId: number = 1,
): DriftResult[] {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const oneWeek = 7 * 86400
  const fourWeeks = 4 * 7 * 86400

  // Current window: last 7 days
  const currentStart = now - oneWeek
  // Baseline window: 4 weeks ending 1 week ago
  const baselineStart = now - fourWeeks
  const baselineEnd = currentStart

  // Metric: avg tokens per session
  const currentTokens = db.prepare(`
    SELECT AVG(input_tokens + output_tokens) as avg_tokens
    FROM token_usage
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, currentStart) as any

  const baselineTokens = db.prepare(`
    SELECT AVG(input_tokens + output_tokens) as avg_tokens
    FROM token_usage
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
  `).get(agentName, workspaceId, baselineStart, baselineEnd) as any

  const tokenDrift = checkDrift(
    currentTokens?.avg_tokens ?? 0,
    baselineTokens?.avg_tokens ?? 0,
  )
  tokenDrift.metric = 'avg_tokens_per_session'

  // Metric: tool success rate
  const currentTools = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, currentStart) as any

  const baselineTools = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
  `).get(agentName, workspaceId, baselineStart, baselineEnd) as any

  const currentSuccessRate = (currentTools?.total ?? 0) > 0
    ? (currentTools.successes / currentTools.total)
    : 1.0
  const baselineSuccessRate = (baselineTools?.total ?? 0) > 0
    ? (baselineTools.successes / baselineTools.total)
    : 1.0

  const toolDrift = checkDrift(currentSuccessRate, baselineSuccessRate)
  toolDrift.metric = 'tool_success_rate'

  // Metric: task completion rate
  const currentTasks = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, currentStart) as any

  const baselineTasks = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
    FROM tasks
    WHERE assigned_to = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
  `).get(agentName, workspaceId, baselineStart, baselineEnd) as any

  const currentCompletionRate = (currentTasks?.total ?? 0) > 0
    ? (currentTasks.completed / currentTasks.total)
    : 1.0
  const baselineCompletionRate = (baselineTasks?.total ?? 0) > 0
    ? (baselineTasks.completed / baselineTasks.total)
    : 1.0

  const taskDrift = checkDrift(currentCompletionRate, baselineCompletionRate)
  taskDrift.metric = 'task_completion_rate'

  return [tokenDrift, toolDrift, taskDrift]
}

export function getDriftTimeline(
  agentName: string,
  weeks: number = 8,
  workspaceId: number = 1,
): Array<{ weekStart: number; avgTokens: number; successRate: number; completionRate: number }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const timeline: Array<{ weekStart: number; avgTokens: number; successRate: number; completionRate: number }> = []

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = now - (i + 1) * 7 * 86400
    const weekEnd = now - i * 7 * 86400

    const tokens = db.prepare(`
      SELECT AVG(input_tokens + output_tokens) as avg_tokens
      FROM token_usage
      WHERE agent_name = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
    `).get(agentName, workspaceId, weekStart, weekEnd) as any

    const tools = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
      FROM mcp_call_log
      WHERE agent_name = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
    `).get(agentName, workspaceId, weekStart, weekEnd) as any

    const tasks = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed
      FROM tasks
      WHERE assigned_to = ? AND workspace_id = ? AND created_at > ? AND created_at <= ?
    `).get(agentName, workspaceId, weekStart, weekEnd) as any

    timeline.push({
      weekStart,
      avgTokens: Math.round(tokens?.avg_tokens ?? 0),
      successRate: (tools?.total ?? 0) > 0 ? Math.round((tools.successes / tools.total) * 10000) / 100 : 100,
      completionRate: (tasks?.total ?? 0) > 0 ? Math.round((tasks.completed / tasks.total) * 10000) / 100 : 100,
    })
  }

  return timeline
}
