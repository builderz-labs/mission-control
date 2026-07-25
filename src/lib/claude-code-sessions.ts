// Per-agent Claude Code base-session lifecycle (#602).
//
// Agents that opt in via `runtime_type: 'claude'` get a server-generated UUID
// base session, created lazily on first dispatch. Every task dispatch either
// materializes the base session (`claude --session-id <uuid>`) or forks from it
// (`claude --resume <uuid> --fork-session`); the forked per-task id is stored
// on the task (`metadata.dispatch_session_id`), never on the agent.
//
// Hard rules from the acceptance contract:
// - authority comes from the explicit opt-in, never from an installed binary
// - base ids are server-generated UUIDs; anything else is rejected
// - a base session belongs to exactly one agent; cross-agent reuse is refused
// - dispatch failures never fall back to a less restrictive provider
// - audit records carry ids and flags only — no prompt or soul contents

import { randomUUID } from 'crypto'
import { getDatabase, logAuditEvent } from './db'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidClaudeSessionId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

export interface ClaudeBaseSession {
  /** Server-generated UUID for `--session-id` / `--resume`. */
  sessionId: string
  /** False until a first dispatch has materialized the session on disk. */
  materialized: boolean
}

interface AgentSessionRow {
  id: number
  claude_base_session_id: string | null
  claude_base_session_created_at: string | null
}

function readAgentSessionRow(agentId: number): AgentSessionRow | undefined {
  const db = getDatabase()
  return db
    .prepare(`SELECT id, claude_base_session_id, claude_base_session_created_at FROM agents WHERE id = ?`)
    .get(agentId) as AgentSessionRow | undefined
}

/**
 * Lazily claim the agent's base session id. Concurrent first dispatches race
 * safely: the guarded UPDATE lets exactly one claim win, and every caller
 * re-reads the winner. Rows with a non-UUID id (hand-edited DB) are refused
 * rather than silently regenerated — that is a rotation decision, not ours.
 */
export function ensureClaudeBaseSession(agentId: number, actor = 'scheduler'): ClaudeBaseSession {
  const row = readAgentSessionRow(agentId)
  if (!row) throw new Error(`claude session: agent ${agentId} not found`)

  if (row.claude_base_session_id) {
    if (!isValidClaudeSessionId(row.claude_base_session_id)) {
      throw new Error(`claude session: agent ${agentId} has a non-UUID base session id; rotate it before dispatching`)
    }
    return {
      sessionId: row.claude_base_session_id,
      materialized: row.claude_base_session_created_at !== null,
    }
  }

  const candidate = randomUUID()
  const db = getDatabase()
  const claimed = db
    .prepare(`UPDATE agents SET claude_base_session_id = ? WHERE id = ? AND claude_base_session_id IS NULL`)
    .run(candidate, agentId)

  const winner = readAgentSessionRow(agentId)
  if (!winner?.claude_base_session_id || !isValidClaudeSessionId(winner.claude_base_session_id)) {
    throw new Error(`claude session: failed to claim a base session for agent ${agentId}`)
  }
  if (claimed.changes === 1) {
    logAuditEvent({
      action: 'claude_session.base_created',
      actor,
      target_type: 'agent',
      target_id: agentId,
      detail: { base_session_id: winner.claude_base_session_id },
    })
  }
  return {
    sessionId: winner.claude_base_session_id,
    materialized: winner.claude_base_session_created_at !== null,
  }
}

/**
 * Stamp the base session as materialized after the create-path dispatch
 * succeeds. The guard tolerates the concurrent-first-dispatch race: only the
 * first success stamps; later calls are no-ops.
 */
export function markClaudeBaseSessionMaterialized(agentId: number, sessionId: string): void {
  if (!isValidClaudeSessionId(sessionId)) return
  const db = getDatabase()
  db.prepare(
    `UPDATE agents SET claude_base_session_created_at = datetime('now')
     WHERE id = ? AND claude_base_session_id = ? AND claude_base_session_created_at IS NULL`,
  ).run(agentId, sessionId)
}

/**
 * Refuse a session id that belongs to a different agent (or to no agent).
 * Cross-agent session reuse is a hard negative in the acceptance contract.
 */
export function assertSessionOwnedByAgent(agentId: number, sessionId: string): void {
  if (!isValidClaudeSessionId(sessionId)) {
    throw new Error('claude session: invalid session id')
  }
  const db = getDatabase()
  const owner = db
    .prepare(`SELECT id FROM agents WHERE claude_base_session_id = ?`)
    .get(sessionId) as { id: number } | undefined
  if (!owner || owner.id !== agentId) {
    throw new Error(`claude session: session is not owned by agent ${agentId}`)
  }
}

/**
 * Rotate (clear) the agent's base session, e.g. when runtime_type moves away
 * from 'claude' or the on-disk session is unrecoverable. The next opt-in
 * dispatch claims a fresh UUID.
 */
export function rotateClaudeBaseSession(agentId: number, actor: string, reason: string): void {
  const row = readAgentSessionRow(agentId)
  if (!row?.claude_base_session_id) return
  const db = getDatabase()
  db.prepare(
    `UPDATE agents SET claude_base_session_id = NULL, claude_base_session_created_at = NULL WHERE id = ?`,
  ).run(agentId)
  logAuditEvent({
    action: 'claude_session.rotated',
    actor,
    target_type: 'agent',
    target_id: agentId,
    detail: { previous_base_session_id: row.claude_base_session_id, reason },
  })
}

export function auditClaudeSessionDispatch(args: {
  agentId: number
  baseSessionId: string
  taskId: number
  outcome: 'resumed' | 'failed'
  forkedSessionId?: string | null
  error?: string
  actor?: string
}): void {
  logAuditEvent({
    action: args.outcome === 'resumed' ? 'claude_session.resumed' : 'claude_session.failed',
    actor: args.actor || 'scheduler',
    target_type: 'agent',
    target_id: args.agentId,
    detail: {
      base_session_id: args.baseSessionId,
      task_id: args.taskId,
      ...(args.forkedSessionId ? { forked_session_id: args.forkedSessionId } : {}),
      // Errors are bounded and never include prompt/soul contents by contract.
      ...(args.error ? { error: String(args.error).slice(0, 300) } : {}),
    },
  })
}
