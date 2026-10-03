// Per-agent ZCode base-session persistence.
//
// Unlike the Claude Code path (#602), ZCode mints its own session ids, so Mission Control
// cannot pre-claim one: the first successful dispatch captures the id the CLI returns and
// later dispatches resume it. Failures never fall back to another provider.

import { getDatabase, logAuditEvent } from './db'
import { isZcodeSessionId } from './zcode-sessions'

interface AgentSessionRow {
  id: number
  zcode_base_session_id: string | null
}

function readAgentSessionRow(agentId: number): AgentSessionRow | undefined {
  const db = getDatabase()
  return db
    .prepare(`SELECT id, zcode_base_session_id FROM agents WHERE id = ?`)
    .get(agentId) as AgentSessionRow | undefined
}

export function getZcodeBaseSession(agentId: number): string | null {
  const row = readAgentSessionRow(agentId)
  if (!row) throw new Error(`zcode session: agent ${agentId} not found`)
  return row.zcode_base_session_id && isZcodeSessionId(row.zcode_base_session_id)
    ? row.zcode_base_session_id
    : null
}

/**
 * Claim the session id reported by the CLI. Only the first save wins; a later dispatch
 * that returns a different id leaves the base session untouched, so an agent's history
 * stays on one resumable thread.
 */
export function saveZcodeBaseSession(agentId: number, sessionId: string, actor = 'scheduler'): boolean {
  if (!isZcodeSessionId(sessionId)) return false
  const db = getDatabase()
  const saved = db
    .prepare(`UPDATE agents SET zcode_base_session_id = ? WHERE id = ? AND zcode_base_session_id IS NULL`)
    .run(sessionId, agentId)
  if (saved.changes === 1) {
    logAuditEvent({
      action: 'zcode_session.base_saved',
      actor,
      target_type: 'agent',
      target_id: agentId,
      detail: { base_session_id: sessionId },
    })
    return true
  }
  return false
}

export function rotateZcodeBaseSession(agentId: number, actor: string, reason: string): void {
  const row = readAgentSessionRow(agentId)
  if (!row?.zcode_base_session_id) return
  const db = getDatabase()
  db.prepare(`UPDATE agents SET zcode_base_session_id = NULL WHERE id = ?`).run(agentId)
  logAuditEvent({
    action: 'zcode_session.rotated',
    actor,
    target_type: 'agent',
    target_id: agentId,
    detail: { previous_base_session_id: row.zcode_base_session_id, reason },
  })
}

export function auditZcodeSessionDispatch(args: {
  agentId: number
  taskId: number
  outcome: 'created' | 'resumed' | 'failed'
  sessionId?: string | null
  error?: string
  actor?: string
}): void {
  logAuditEvent({
    action: `zcode_session.${args.outcome}`,
    actor: args.actor || 'scheduler',
    target_type: 'agent',
    target_id: args.agentId,
    detail: {
      task_id: args.taskId,
      ...(args.sessionId ? { session_id: args.sessionId } : {}),
      // Bounded, and never carries prompt or soul contents.
      ...(args.error ? { error: String(args.error).slice(0, 300) } : {}),
    },
  })
}
