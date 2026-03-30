import { getDatabase } from './db'
import { eventBus } from './event-bus'
import { logger } from './logger'

/**
 * Agent health state model — 6 states derived from heartbeat, activity, and session signals.
 *
 * idle      — no active task
 * working   — active task + recent activity (< STALL_THRESHOLD)
 * stalled   — no real activity for STALL_THRESHOLD..STUCK_THRESHOLD
 * stuck     — no real activity for > STUCK_THRESHOLD
 * zombie    — session dead + no activity
 * offline   — agent status is offline
 */

export type HealthStatus = 'idle' | 'working' | 'stalled' | 'stuck' | 'zombie' | 'offline'

export interface AgentHealthRecord {
  id: number
  workspace_id: number
  agent_id: string
  status: HealthStatus
  task_id: string | null
  last_heartbeat_at: number | null
  last_real_activity_at: number | null
  last_task_completed_at: number | null
  consecutive_stall_checks: number
  last_nudge_at: number | null
  nudge_count: number
  recovery_attempts: number
  last_checkpoint_at: number | null
  metadata: string
  updated_at: number
}

// Configurable thresholds via env vars
const STALL_THRESHOLD_MINUTES = parseInt(process.env.HEALTH_STALE_THRESHOLD_MINUTES || '5', 10)
const STUCK_THRESHOLD_MINUTES = parseInt(process.env.HEALTH_STUCK_THRESHOLD_MINUTES || '15', 10)
const STALL_THRESHOLD_SEC = STALL_THRESHOLD_MINUTES * 60
const STUCK_THRESHOLD_SEC = STUCK_THRESHOLD_MINUTES * 60

/**
 * Derive health status for a single agent based on current signals.
 * Does NOT write to the database — caller is responsible for persisting.
 */
export function deriveHealthStatus(
  agentStatus: string,
  hasActiveTask: boolean,
  lastRealActivityAt: number | null,
  lastHeartbeatAt: number | null,
  now: number = Math.floor(Date.now() / 1000)
): HealthStatus {
  if (agentStatus === 'offline') return 'offline'

  if (!hasActiveTask) return 'idle'

  // Agent has an active task — check activity freshness
  const lastSignal = Math.max(lastRealActivityAt ?? 0, lastHeartbeatAt ?? 0)
  if (lastSignal === 0) return 'stalled' // No signal ever recorded

  const elapsed = now - lastSignal

  if (elapsed < STALL_THRESHOLD_SEC) return 'working'

  // Check if session/heartbeat is still alive
  const heartbeatAge = lastHeartbeatAt ? now - lastHeartbeatAt : Infinity
  if (heartbeatAge > STUCK_THRESHOLD_SEC && elapsed > STUCK_THRESHOLD_SEC) {
    return 'zombie'
  }

  if (elapsed >= STUCK_THRESHOLD_SEC) return 'stuck'

  return 'stalled'
}

/**
 * Ensure an agent_health row exists for the given agent, creating if needed.
 */
export function ensureHealthRecord(workspaceId: number, agentId: string): AgentHealthRecord {
  const db = getDatabase()
  const existing = db.prepare(
    'SELECT * FROM agent_health WHERE workspace_id = ? AND agent_id = ?'
  ).get(workspaceId, agentId) as AgentHealthRecord | undefined

  if (existing) return existing

  db.prepare(`
    INSERT INTO agent_health (workspace_id, agent_id, status, updated_at)
    VALUES (?, ?, 'idle', unixepoch())
  `).run(workspaceId, agentId)

  return db.prepare(
    'SELECT * FROM agent_health WHERE workspace_id = ? AND agent_id = ?'
  ).get(workspaceId, agentId) as AgentHealthRecord
}

/**
 * Update an agent's health record with the latest derived status.
 * Increments consecutive_stall_checks when agent enters stalled/stuck/zombie.
 * Resets counter when healthy (idle/working).
 */
export function updateHealthStatus(
  workspaceId: number,
  agentId: string,
  newStatus: HealthStatus,
  taskId?: string | null
): AgentHealthRecord {
  const db = getDatabase()
  const record = ensureHealthRecord(workspaceId, agentId)
  const now = Math.floor(Date.now() / 1000)

  const isUnhealthy = newStatus === 'stalled' || newStatus === 'stuck' || newStatus === 'zombie'
  const wasUnhealthy = record.status === 'stalled' || record.status === 'stuck' || record.status === 'zombie'

  const consecutiveStallChecks = isUnhealthy
    ? record.consecutive_stall_checks + (wasUnhealthy ? 1 : 0)
    : 0

  db.prepare(`
    UPDATE agent_health
    SET status = ?,
        task_id = COALESCE(?, task_id),
        consecutive_stall_checks = ?,
        updated_at = ?
    WHERE workspace_id = ? AND agent_id = ?
  `).run(newStatus, taskId ?? null, consecutiveStallChecks, now, workspaceId, agentId)

  if (record.status !== newStatus) {
    eventBus.broadcast('agent.health_changed', {
      workspace_id: workspaceId,
      agent_id: agentId,
      previous_status: record.status,
      status: newStatus,
      consecutive_stall_checks: consecutiveStallChecks,
    })
  }

  return db.prepare(
    'SELECT * FROM agent_health WHERE workspace_id = ? AND agent_id = ?'
  ).get(workspaceId, agentId) as AgentHealthRecord
}

/**
 * Record a real (non-system) activity timestamp for an agent.
 * Called from heartbeat/activity handlers to update the freshness signal.
 */
export function recordActivity(workspaceId: number, agentId: string, isSystem = false): void {
  if (isSystem) return // System entries don't count as real activity

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  ensureHealthRecord(workspaceId, agentId)

  db.prepare(`
    UPDATE agent_health
    SET last_real_activity_at = ?,
        last_heartbeat_at = ?,
        updated_at = ?
    WHERE workspace_id = ? AND agent_id = ?
  `).run(now, now, now, workspaceId, agentId)
}

/**
 * Record a heartbeat (may be a system health check).
 */
export function recordHeartbeat(workspaceId: number, agentId: string): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  ensureHealthRecord(workspaceId, agentId)

  db.prepare(`
    UPDATE agent_health
    SET last_heartbeat_at = ?, updated_at = ?
    WHERE workspace_id = ? AND agent_id = ?
  `).run(now, now, workspaceId, agentId)
}

/**
 * Record that an agent completed a task.
 */
export function recordTaskCompleted(workspaceId: number, agentId: string): void {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  ensureHealthRecord(workspaceId, agentId)

  db.prepare(`
    UPDATE agent_health
    SET last_task_completed_at = ?, consecutive_stall_checks = 0, updated_at = ?
    WHERE workspace_id = ? AND agent_id = ?
  `).run(now, now, workspaceId, agentId)
}

/**
 * Get all health records for a workspace.
 */
export function getHealthRecords(workspaceId: number): AgentHealthRecord[] {
  const db = getDatabase()
  return db.prepare(
    'SELECT * FROM agent_health WHERE workspace_id = ? ORDER BY agent_id'
  ).all(workspaceId) as AgentHealthRecord[]
}

/**
 * Get a single agent's health record.
 */
export function getAgentHealth(workspaceId: number, agentId: string): AgentHealthRecord | null {
  const db = getDatabase()
  return (db.prepare(
    'SELECT * FROM agent_health WHERE workspace_id = ? AND agent_id = ?'
  ).get(workspaceId, agentId) as AgentHealthRecord | undefined) ?? null
}

/**
 * Sweep all agents in a workspace: derive fresh health status from current signals.
 * Intended to be called by a scheduler/cron job.
 */
export function sweepAgentHealth(workspaceId: number): { updated: number; unhealthy: string[] } {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Get all agents in workspace
  const agents = db.prepare(
    'SELECT id, name, status FROM agents WHERE workspace_id = ?'
  ).all(workspaceId) as Array<{ id: number; name: string; status: string }>

  let updated = 0
  const unhealthy: string[] = []

  for (const agent of agents) {
    const health = ensureHealthRecord(workspaceId, agent.name)

    // Check if agent has an active task
    const activeTask = db.prepare(
      "SELECT id FROM tasks WHERE assigned_to = ? AND workspace_id = ? AND status IN ('assigned', 'in_progress') LIMIT 1"
    ).get(agent.name, workspaceId) as { id: number } | undefined

    const newStatus = deriveHealthStatus(
      agent.status,
      !!activeTask,
      health.last_real_activity_at,
      health.last_heartbeat_at,
      now
    )

    if (newStatus !== health.status) {
      updateHealthStatus(workspaceId, agent.name, newStatus, activeTask?.id?.toString())
      updated++
    }

    if (newStatus === 'stalled' || newStatus === 'stuck' || newStatus === 'zombie') {
      unhealthy.push(agent.name)
    }
  }

  if (unhealthy.length > 0) {
    logger.warn({ workspaceId, unhealthy }, 'Unhealthy agents detected during health sweep')
  }

  return { updated, unhealthy }
}
