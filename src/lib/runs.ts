/**
 * Agent Run Protocol — reference implementation.
 *
 * Manages AgentRun objects per the agent-run spec.
 * https://github.com/0xNyk/agent-run
 */

import { createHash, randomUUID } from 'crypto'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

// --- Types (mirrors @agent-run/types) ---

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'
export type RunOutcome = 'success' | 'failed' | 'partial' | 'abandoned'
export type RunTrigger = 'manual' | 'cron' | 'webhook' | 'agent' | 'pipeline' | 'queue'
export type StepType = 'reasoning' | 'tool_call' | 'tool_result' | 'message' | 'error' | 'handoff'

export interface AgentRun {
  id: string
  agent_id: string
  agent_name?: string | null
  model?: string | null
  provider?: string | null
  runtime?: string | null
  runtime_version?: string | null
  trigger?: RunTrigger | null
  parent_run_id?: string | null
  task_id?: string | null
  status: RunStatus
  outcome?: RunOutcome | null
  started_at: string
  ended_at?: string | null
  duration_ms?: number | null
  steps: Step[]
  tools_available?: string[]
  cost: Cost
  provenance: Provenance
  eval?: EvalResult | null
  error?: string | null
  git_branch?: string | null
  git_commit?: string | null
  workspace_id?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface Step {
  id: string
  type: StepType
  tool_name?: string | null
  mcp_server?: string | null
  input_preview?: string | null
  output_preview?: string | null
  success?: boolean | null
  error?: string | null
  started_at: string
  ended_at?: string | null
  duration_ms?: number | null
  tokens_used?: number | null
  metadata?: Record<string, unknown>
}

export interface Cost {
  input_tokens: number
  output_tokens: number
  cache_read_tokens?: number | null
  cache_write_tokens?: number | null
  total_tokens?: number | null
  cost_usd?: number | null
  model?: string | null
}

export interface Provenance {
  run_hash: string
  parent_run_hash?: string | null
  lineage?: string[]
  model_version?: string
  config_hash?: string
  runtime?: string
  signed_by?: string | null
  signature?: string | null
  created_at?: string
}

export interface EvalResult {
  task_type?: string | null
  eval_layer?: string | null
  pass: boolean
  score: number
  expected_outcome?: string | null
  actual_outcome?: string | null
  metrics?: Record<string, unknown>
  regression_from?: string | null
  detail?: string | null
  benchmark_id?: string | null
}

// --- Provenance ---

export function computeRunHash(input: {
  agent_id: string
  model?: string
  tools_available?: string[]
  config_hash?: string
  trigger?: string
}): string {
  const canonical = [
    input.agent_id,
    input.model ?? '',
    JSON.stringify((input.tools_available ?? []).sort()),
    input.config_hash ?? '',
    input.trigger ?? '',
  ].join('|')
  return createHash('sha256').update(canonical).digest('hex')
}

export function computeConfigHash(config: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(config ?? {}))
    .digest('hex')
}

// --- CRUD ---

export function createRun(run: AgentRun, workspaceId?: number): AgentRun {
  const db = getDatabase()
  const wsId = workspaceId ?? 1

  const id = run.id || randomUUID()
  const now = new Date().toISOString()

  const runHash = run.provenance?.run_hash || computeRunHash({
    agent_id: run.agent_id,
    model: run.model ?? undefined,
    tools_available: run.tools_available,
    config_hash: run.provenance?.config_hash,
    trigger: run.trigger ?? undefined,
  })

  db.prepare(`
    INSERT INTO runs (
      id, agent_id, agent_name, model, provider, runtime, runtime_version,
      trigger_type, parent_run_id, task_id, status, outcome,
      started_at, ended_at, duration_ms, steps, tools_available,
      cost_input_tokens, cost_output_tokens, cost_cache_read_tokens, cost_cache_write_tokens,
      cost_usd, cost_model,
      run_hash, parent_run_hash, lineage, model_version, config_hash,
      provenance_runtime, signed_by, signature, provenance_created_at,
      eval_task_type, eval_layer, eval_pass, eval_score, eval_detail, eval_metrics, eval_benchmark_id,
      error, git_branch, git_commit, workspace_id, tags, metadata
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).run(
    id, run.agent_id, run.agent_name ?? null, run.model ?? null, run.provider ?? null,
    run.runtime ?? 'mission-control', run.runtime_version ?? null,
    run.trigger ?? null, run.parent_run_id ?? null, run.task_id ?? null,
    run.status, run.outcome ?? null,
    run.started_at || now, run.ended_at ?? null, run.duration_ms ?? null,
    JSON.stringify(run.steps ?? []), JSON.stringify(run.tools_available ?? []),
    run.cost?.input_tokens ?? 0, run.cost?.output_tokens ?? 0,
    run.cost?.cache_read_tokens ?? null, run.cost?.cache_write_tokens ?? null,
    run.cost?.cost_usd ?? null, run.cost?.model ?? null,
    runHash, run.provenance?.parent_run_hash ?? null,
    JSON.stringify(run.provenance?.lineage ?? []),
    run.provenance?.model_version ?? null, run.provenance?.config_hash ?? null,
    run.provenance?.runtime ?? null, run.provenance?.signed_by ?? null,
    run.provenance?.signature ?? null, run.provenance?.created_at ?? now,
    run.eval?.task_type ?? null, run.eval?.eval_layer ?? null,
    run.eval?.pass != null ? (run.eval.pass ? 1 : 0) : null,
    run.eval?.score ?? null, run.eval?.detail ?? null,
    run.eval?.metrics ? JSON.stringify(run.eval.metrics) : null,
    run.eval?.benchmark_id ?? null,
    run.error ?? null, run.git_branch ?? null, run.git_commit ?? null,
    wsId, JSON.stringify(run.tags ?? []), JSON.stringify(run.metadata ?? {}),
  )

  const created = getRun(id, wsId)!
  eventBus.broadcast('run.created', created)
  return created
}

export function updateRun(id: string, updates: Partial<AgentRun>, workspaceId?: number): AgentRun | null {
  const db = getDatabase()
  const wsId = workspaceId ?? 1

  const setClauses: string[] = []
  const params: unknown[] = []

  const simple: Record<string, unknown> = {
    status: updates.status,
    outcome: updates.outcome,
    ended_at: updates.ended_at,
    duration_ms: updates.duration_ms,
    error: updates.error,
    model: updates.model,
    provider: updates.provider,
    git_branch: updates.git_branch,
    git_commit: updates.git_commit,
  }

  for (const [col, val] of Object.entries(simple)) {
    if (val !== undefined) {
      setClauses.push(`${col} = ?`)
      params.push(val)
    }
  }

  if (updates.steps !== undefined) {
    setClauses.push('steps = ?')
    params.push(JSON.stringify(updates.steps))
  }
  if (updates.cost !== undefined) {
    setClauses.push('cost_input_tokens = ?, cost_output_tokens = ?, cost_usd = ?')
    params.push(updates.cost.input_tokens, updates.cost.output_tokens, updates.cost.cost_usd ?? null)
  }
  if (updates.tags !== undefined) {
    setClauses.push('tags = ?')
    params.push(JSON.stringify(updates.tags))
  }
  if (updates.metadata !== undefined) {
    setClauses.push('metadata = ?')
    params.push(JSON.stringify(updates.metadata))
  }

  if (setClauses.length === 0) return getRun(id, wsId)

  params.push(id, wsId)
  db.prepare(`UPDATE runs SET ${setClauses.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...params)

  const updated = getRun(id, wsId)
  if (updated) {
    const eventType = updated.status === 'completed' || updated.status === 'failed'
      ? 'run.completed' as const
      : 'run.updated' as const
    eventBus.broadcast(eventType, updated)
  }
  return updated
}

export function attachEval(runId: string, evalResult: EvalResult, workspaceId?: number): AgentRun | null {
  const db = getDatabase()
  const wsId = workspaceId ?? 1

  db.prepare(`
    UPDATE runs SET
      eval_task_type = ?, eval_layer = ?, eval_pass = ?, eval_score = ?,
      eval_detail = ?, eval_metrics = ?, eval_benchmark_id = ?
    WHERE id = ? AND workspace_id = ?
  `).run(
    evalResult.task_type ?? null, evalResult.eval_layer ?? null,
    evalResult.pass ? 1 : 0, evalResult.score,
    evalResult.detail ?? null,
    evalResult.metrics ? JSON.stringify(evalResult.metrics) : null,
    evalResult.benchmark_id ?? null,
    runId, wsId,
  )

  const updated = getRun(runId, wsId)
  if (updated) eventBus.broadcast('run.eval_attached', updated)
  return updated
}

// --- Queries ---

export function getRun(id: string, workspaceId?: number): AgentRun | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM runs WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId ?? 1) as any
  return row ? rowToAgentRun(row) : null
}

export function listRuns(opts: {
  workspaceId?: number
  agentId?: string
  status?: string
  since?: string
  taskId?: string
  limit?: number
  offset?: number
}): { runs: AgentRun[]; total: number } {
  const db = getDatabase()
  const wsId = opts.workspaceId ?? 1
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  let where = 'WHERE workspace_id = ?'
  const params: unknown[] = [wsId]

  if (opts.agentId) {
    where += ' AND agent_id = ?'
    params.push(opts.agentId)
  }
  if (opts.status) {
    where += ' AND status = ?'
    params.push(opts.status)
  }
  if (opts.since) {
    where += ' AND started_at >= ?'
    params.push(opts.since)
  }
  if (opts.taskId) {
    where += ' AND task_id = ?'
    params.push(opts.taskId)
  }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM runs ${where}`).get(...params) as any).c
  const rows = db.prepare(`SELECT * FROM runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[]

  return { runs: rows.map(rowToAgentRun), total }
}

export function getRunProvenance(id: string, workspaceId?: number): Provenance | null {
  const run = getRun(id, workspaceId)
  return run?.provenance ?? null
}

export function getLeaderboard(opts?: {
  benchmarkId?: string
  workspaceId?: number
  limit?: number
}): Array<{
  agent_name: string
  model: string
  runtime: string
  avg_score: number
  pass_rate: number
  avg_cost_usd: number
  run_count: number
}> {
  const db = getDatabase()
  const wsId = opts?.workspaceId ?? 1
  const limit = opts?.limit ?? 50

  let where = 'WHERE workspace_id = ? AND eval_score IS NOT NULL'
  const params: unknown[] = [wsId]

  if (opts?.benchmarkId) {
    where += ' AND eval_benchmark_id = ?'
    params.push(opts.benchmarkId)
  }

  return db.prepare(`
    SELECT
      COALESCE(agent_name, agent_id) as agent_name,
      COALESCE(model, 'unknown') as model,
      COALESCE(runtime, 'unknown') as runtime,
      AVG(eval_score) as avg_score,
      AVG(CASE WHEN eval_pass = 1 THEN 1.0 ELSE 0.0 END) as pass_rate,
      AVG(COALESCE(cost_usd, 0)) as avg_cost_usd,
      COUNT(*) as run_count
    FROM runs ${where}
    GROUP BY COALESCE(agent_name, agent_id), COALESCE(model, 'unknown'), COALESCE(runtime, 'unknown')
    ORDER BY avg_score DESC
    LIMIT ?
  `).all(...params, limit) as any[]
}

// --- Row → AgentRun hydration ---

function rowToAgentRun(row: any): AgentRun {
  const steps = safeJsonParse(row.steps, [])
  const toolsAvailable = safeJsonParse(row.tools_available, [])
  const tags = safeJsonParse(row.tags, [])
  const metadata = safeJsonParse(row.metadata, {})
  const lineage = safeJsonParse(row.lineage, [])
  const evalMetrics = safeJsonParse(row.eval_metrics, null)

  const run: AgentRun = {
    id: row.id,
    agent_id: row.agent_id,
    agent_name: row.agent_name,
    model: row.model,
    provider: row.provider,
    runtime: row.runtime,
    runtime_version: row.runtime_version,
    trigger: row.trigger_type as RunTrigger | null,
    parent_run_id: row.parent_run_id,
    task_id: row.task_id,
    status: row.status as RunStatus,
    outcome: row.outcome as RunOutcome | null,
    started_at: row.started_at,
    ended_at: row.ended_at,
    duration_ms: row.duration_ms,
    steps,
    tools_available: toolsAvailable,
    cost: {
      input_tokens: row.cost_input_tokens ?? 0,
      output_tokens: row.cost_output_tokens ?? 0,
      cache_read_tokens: row.cost_cache_read_tokens,
      cache_write_tokens: row.cost_cache_write_tokens,
      cost_usd: row.cost_usd,
      model: row.cost_model,
    },
    provenance: {
      run_hash: row.run_hash ?? '',
      parent_run_hash: row.parent_run_hash,
      lineage,
      model_version: row.model_version,
      config_hash: row.config_hash,
      runtime: row.provenance_runtime,
      signed_by: row.signed_by,
      signature: row.signature,
      created_at: row.provenance_created_at,
    },
    error: row.error,
    git_branch: row.git_branch,
    git_commit: row.git_commit,
    workspace_id: String(row.workspace_id),
    tags,
    metadata,
  }

  if (row.eval_score != null) {
    run.eval = {
      task_type: row.eval_task_type,
      eval_layer: row.eval_layer,
      pass: row.eval_pass === 1,
      score: row.eval_score,
      detail: row.eval_detail,
      metrics: evalMetrics,
      benchmark_id: row.eval_benchmark_id,
    }
  }

  return run
}

function safeJsonParse(val: string | null | undefined, fallback: any): any {
  if (!val) return fallback
  try { return JSON.parse(val) } catch { return fallback }
}
