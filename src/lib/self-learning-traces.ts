// ---------------------------------------------------------------------------
// Self-Learning — execution trace recording and retrieval (experience replay)
// ---------------------------------------------------------------------------
import { getDatabase } from './db'
import { logger } from './logger'
import { type ExecutionTrace, DEFAULT_LIMIT } from './self-learning-types'
import { extractKeywords } from './self-learning-patterns'

interface RecordTraceInput {
  readonly taskId?: number
  readonly agentId?: string
  readonly actionSequence: string
  readonly inputContext: string
  readonly outputResult: string
  readonly durationMs: number
  readonly tokenCost?: number
  readonly success: boolean
  readonly workspaceId?: number
}

const TRACE_COLUMNS =
  'id, task_id, agent_id, action_sequence, input_context, output_result, duration_ms, token_cost, success, workspace_id, created_at'

export function recordExecutionTrace(input: RecordTraceInput): ExecutionTrace {
  const db = getDatabase()
  const workspaceId = input.workspaceId ?? 1

  const result = db.prepare(`
    INSERT INTO execution_traces
      (task_id, agent_id, action_sequence, input_context, output_result, duration_ms, token_cost, success, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.taskId ?? null,
    input.agentId ?? null,
    input.actionSequence,
    input.inputContext,
    input.outputResult,
    input.durationMs,
    input.tokenCost ?? 0,
    input.success ? 1 : 0,
    workspaceId,
  )

  logger.info({ taskId: input.taskId, success: input.success }, 'Recorded execution trace')
  return getTraceById(Number(result.lastInsertRowid), workspaceId)!
}

function getTraceById(id: number, workspaceId = 1): ExecutionTrace | null {
  const db = getDatabase()
  const row = db.prepare(
    `SELECT ${TRACE_COLUMNS} FROM execution_traces WHERE id = ? AND workspace_id = ?`,
  ).get(id, workspaceId) as ExecutionTrace | undefined
  return row ?? null
}

export function getSuccessfulTraces(
  workspaceId = 1,
  limit = DEFAULT_LIMIT,
): readonly ExecutionTrace[] {
  const db = getDatabase()
  return db.prepare(`
    SELECT ${TRACE_COLUMNS}
    FROM execution_traces
    WHERE workspace_id = ? AND success = 1
    ORDER BY created_at DESC
    LIMIT ?
  `).all(workspaceId, limit) as ExecutionTrace[]
}

export function findSimilarTraces(
  inputContext: string,
  workspaceId = 1,
  limit = 5,
): readonly ExecutionTrace[] {
  const db = getDatabase()
  const keywords = extractKeywords(inputContext)
  if (keywords.length === 0) return []

  // Retrieve recent successful traces and rank by keyword overlap
  const candidates = db.prepare(`
    SELECT ${TRACE_COLUMNS}
    FROM execution_traces
    WHERE workspace_id = ? AND success = 1
    ORDER BY created_at DESC
    LIMIT 100
  `).all(workspaceId) as ExecutionTrace[]

  return candidates
    .map((trace) => {
      const traceWords = extractKeywords(trace.input_context)
      const overlap = keywords.filter((kw) => traceWords.includes(kw)).length
      return { trace, overlap }
    })
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map((entry) => entry.trace)
}
