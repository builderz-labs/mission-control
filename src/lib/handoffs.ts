/**
 * Handoff briefs — structured context objects passed between agents/runtimes
 * at a session boundary (e.g. Hermes on a phone handing a task to Claude Code
 * on a desktop, or the reverse). Distinct from the `handoff` chat message
 * type, which is a cosmetic marker in the conversation view — a brief is the
 * actual payload a receiving session reads on startup via the MCP
 * mc_get_handoff tool or a SessionStart hook.
 */

import { randomUUID } from 'crypto'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'

export interface HandoffBrief {
  id: string
  task_id?: number | null
  from_agent: string
  to_agent?: string | null
  task_summary: string
  decisions_made: string[]
  key_context?: string | null
  next_steps: string[]
  open_questions: string[]
  refs: string[]
  consumed_at?: number | null
  consumed_by?: string | null
  workspace_id: number
  metadata: Record<string, unknown>
  created_at: number
}

function rowToBrief(row: any): HandoffBrief {
  return {
    ...row,
    decisions_made: row.decisions_made ? JSON.parse(row.decisions_made) : [],
    next_steps: row.next_steps ? JSON.parse(row.next_steps) : [],
    open_questions: row.open_questions ? JSON.parse(row.open_questions) : [],
    refs: row.refs ? JSON.parse(row.refs) : [],
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  }
}

export interface CreateHandoffInput {
  task_id?: number | null
  from_agent: string
  to_agent?: string | null
  task_summary: string
  decisions_made?: string[]
  key_context?: string | null
  next_steps?: string[]
  open_questions?: string[]
  refs?: string[]
  metadata?: Record<string, unknown>
}

export function createHandoffBrief(input: CreateHandoffInput, workspaceId = 1): HandoffBrief {
  const db = getDatabase()
  const id = randomUUID()

  db.prepare(`
    INSERT INTO handoff_briefs (
      id, task_id, from_agent, to_agent, task_summary,
      decisions_made, key_context, next_steps, open_questions, refs,
      workspace_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.task_id ?? null,
    input.from_agent,
    input.to_agent ?? null,
    input.task_summary,
    JSON.stringify(input.decisions_made ?? []),
    input.key_context ?? null,
    JSON.stringify(input.next_steps ?? []),
    JSON.stringify(input.open_questions ?? []),
    JSON.stringify(input.refs ?? []),
    workspaceId,
    JSON.stringify(input.metadata ?? {}),
  )

  const created = getHandoffBrief(id, workspaceId)!
  eventBus.broadcast('handoff.created', { ...created, workspace_id: workspaceId })
  return created
}

export function getHandoffBrief(id: string, workspaceId = 1): HandoffBrief | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM handoff_briefs WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId) as any
  return row ? rowToBrief(row) : null
}

/**
 * Latest unconsumed brief addressed to an agent (optionally scoped to a
 * task). This is what a SessionStart hook / mc_get_handoff should read.
 */
export function getLatestHandoffForAgent(
  toAgent: string,
  opts: { taskId?: number; workspaceId?: number } = {}
): HandoffBrief | null {
  const db = getDatabase()
  const wsId = opts.workspaceId ?? 1

  let where = 'WHERE to_agent = ? AND consumed_at IS NULL AND workspace_id = ?'
  const params: unknown[] = [toAgent, wsId]

  if (opts.taskId != null) {
    where += ' AND task_id = ?'
    params.push(opts.taskId)
  }

  const row = db.prepare(`SELECT * FROM handoff_briefs ${where} ORDER BY created_at DESC LIMIT 1`)
    .get(...params) as any
  return row ? rowToBrief(row) : null
}

export function listHandoffBriefs(opts: {
  toAgent?: string
  fromAgent?: string
  taskId?: number
  workspaceId?: number
  limit?: number
  offset?: number
} = {}): { briefs: HandoffBrief[]; total: number } {
  const db = getDatabase()
  const wsId = opts.workspaceId ?? 1
  const limit = Math.min(opts.limit ?? 50, 200)
  const offset = opts.offset ?? 0

  let where = 'WHERE workspace_id = ?'
  const params: unknown[] = [wsId]

  if (opts.toAgent) {
    where += ' AND to_agent = ?'
    params.push(opts.toAgent)
  }
  if (opts.fromAgent) {
    where += ' AND from_agent = ?'
    params.push(opts.fromAgent)
  }
  if (opts.taskId != null) {
    where += ' AND task_id = ?'
    params.push(opts.taskId)
  }

  const rows = db.prepare(`SELECT * FROM handoff_briefs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[]
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM handoff_briefs ${where}`).get(...params) as { total: number }

  return { briefs: rows.map(rowToBrief), total: countRow.total }
}

export function markHandoffConsumed(id: string, consumedBy: string, workspaceId = 1): HandoffBrief | null {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    UPDATE handoff_briefs SET consumed_at = ?, consumed_by = ?
    WHERE id = ? AND workspace_id = ? AND consumed_at IS NULL
  `).run(now, consumedBy, id, workspaceId)

  const updated = getHandoffBrief(id, workspaceId)
  if (updated) {
    eventBus.broadcast('handoff.consumed', { ...updated, workspace_id: workspaceId })
  }
  return updated
}
