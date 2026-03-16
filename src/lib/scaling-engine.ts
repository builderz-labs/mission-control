/**
 * Auto-Scaling Engine — lazy evaluation, cooldown, agent cap enforcement.
 *
 * No setInterval. Evaluation happens on-demand when triggered via API.
 * Integrates with existing task queue and agent infrastructure.
 */

import type Database from 'better-sqlite3'
import { eventBus } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

// --- Types ---

export interface ScalingPolicy {
  id: number
  name: string
  min_agents: number
  max_agents: number
  scale_up_threshold: number
  scale_down_threshold: number
  cooldown_seconds: number
  idle_timeout_seconds: number
  auto_approve: number
  agent_template: string | null
  enabled: number
  workspace_id: number
  created_at: number
  updated_at: number
}

export interface ScalingEvent {
  id: number
  policy_id: number | null
  event_type: string // 'scale_up' | 'scale_down'
  agent_id: number | null
  status: string // 'pending' | 'approved' | 'rejected' | 'completed'
  reason: string
  metrics_snapshot: string | null
  workspace_id: number
  created_at: number
  resolved_at: number | null
}

export interface ScalingMetrics {
  queueDepth: number
  activeAgents: number
  idleAgents: number
  busyAgents: number
  busyRatio: number
}

// --- Constants ---

const DEFAULT_GLOBAL_CAP = 20

// --- Core Functions ---

/**
 * Get the global agent cap from env or default.
 */
export function getGlobalAgentCap(): number {
  const envCap = process.env.MC_GLOBAL_AGENT_CAP
  if (envCap) {
    const parsed = parseInt(envCap, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_GLOBAL_CAP
}

/**
 * Compute current scaling metrics from DB state.
 */
export function getScalingMetrics(db: Database.Database, workspaceId: number): ScalingMetrics {
  const queueRow = db.prepare(
    `SELECT COUNT(*) as count FROM tasks WHERE status IN ('inbox', 'assigned') AND workspace_id = ?`
  ).get(workspaceId) as { count: number }

  const agentRows = db.prepare(
    `SELECT status, COUNT(*) as count FROM agents WHERE workspace_id = ? GROUP BY status`
  ).all(workspaceId) as Array<{ status: string; count: number }>

  let idleAgents = 0
  let busyAgents = 0
  let totalActive = 0

  for (const row of agentRows) {
    if (row.status === 'idle') {
      idleAgents = row.count
      totalActive += row.count
    } else if (row.status === 'busy') {
      busyAgents = row.count
      totalActive += row.count
    }
  }

  return {
    queueDepth: queueRow.count,
    activeAgents: totalActive,
    idleAgents,
    busyAgents,
    busyRatio: totalActive > 0 ? busyAgents / totalActive : 0,
  }
}

/**
 * Evaluate a scaling policy lazily. Returns a new ScalingEvent if action needed, null otherwise.
 */
export function evaluateScaling(
  db: Database.Database,
  policyId: number,
  workspaceId: number,
): ScalingEvent | null {
  const policy = db.prepare(
    'SELECT * FROM scaling_policies WHERE id = ? AND workspace_id = ?'
  ).get(policyId, workspaceId) as ScalingPolicy | undefined

  if (!policy || !policy.enabled) {
    return null
  }

  // Check cooldown — find last resolved event for this policy
  const now = Math.floor(Date.now() / 1000)
  const lastEvent = db.prepare(
    `SELECT resolved_at FROM scaling_events WHERE policy_id = ? AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 1`
  ).get(policyId) as { resolved_at: number } | undefined

  if (lastEvent && (now - lastEvent.resolved_at) < policy.cooldown_seconds) {
    return null // still in cooldown
  }

  const metrics = getScalingMetrics(db, workspaceId)
  const globalCap = getGlobalAgentCap()

  // Count all agents (including offline) for global cap
  const totalAgents = (db.prepare(
    'SELECT COUNT(*) as count FROM agents WHERE workspace_id = ?'
  ).get(workspaceId) as { count: number }).count

  eventBus.broadcast('scaling.evaluation.triggered', {
    queueDepth: metrics.queueDepth,
    activeAgents: metrics.activeAgents,
    threshold: policy.scale_up_threshold,
  })

  // Scale UP check
  if (metrics.queueDepth > policy.scale_up_threshold && metrics.activeAgents < policy.max_agents && totalAgents < globalCap) {
    const reason = `Queue depth ${metrics.queueDepth} exceeds threshold ${policy.scale_up_threshold} (active: ${metrics.activeAgents}/${policy.max_agents}, global: ${totalAgents}/${globalCap})`
    const event = createScalingEvent(db, policyId, 'scale_up', null, reason, metrics, workspaceId)
    return event
  }

  // Scale DOWN check
  if (metrics.idleAgents > 0 && metrics.activeAgents > policy.min_agents) {
    // Find an idle agent that has been idle longer than idle_timeout_seconds
    const idleAgent = db.prepare(`
      SELECT id, name FROM agents
      WHERE workspace_id = ? AND status = 'idle'
        AND (? - COALESCE(last_seen, created_at)) > ?
      ORDER BY last_seen ASC LIMIT 1
    `).get(workspaceId, now, policy.idle_timeout_seconds) as { id: number; name: string } | undefined

    if (idleAgent) {
      const reason = `Agent ${idleAgent.name} idle beyond ${policy.idle_timeout_seconds}s threshold (active: ${metrics.activeAgents}, min: ${policy.min_agents})`
      const event = createScalingEvent(db, policyId, 'scale_down', idleAgent.id, reason, metrics, workspaceId)
      return event
    }
  }

  return null
}

/**
 * Execute a scale-up: create a new agent from template, update event.
 */
export function executeScaleUp(
  db: Database.Database,
  eventId: number,
  workspaceId: number,
): number {
  const event = db.prepare(
    'SELECT * FROM scaling_events WHERE id = ? AND workspace_id = ?'
  ).get(eventId, workspaceId) as ScalingEvent | undefined

  if (!event || event.status !== 'pending') {
    throw new Error(`Event ${eventId} not found or not pending`)
  }

  // Get template from policy
  let template: string | null = null
  if (event.policy_id) {
    const policy = db.prepare('SELECT agent_template FROM scaling_policies WHERE id = ?').get(event.policy_id) as { agent_template: string | null } | undefined
    template = policy?.agent_template ?? null
  }

  const now = Math.floor(Date.now() / 1000)
  const agentName = `auto-agent-${now}-${Math.random().toString(36).slice(2, 6)}`

  const result = db.prepare(
    `INSERT INTO agents (name, role, status, config, workspace_id, created_at, updated_at)
     VALUES (?, ?, 'idle', ?, ?, ?, ?)`
  ).run(agentName, template ?? 'auto-scaled', template ? JSON.stringify({ template }) : '{}', workspaceId, now, now)

  const agentId = Number(result.lastInsertRowid)

  // Update event
  db.prepare(
    `UPDATE scaling_events SET status = 'completed', agent_id = ?, resolved_at = ? WHERE id = ?`
  ).run(agentId, now, eventId)

  eventBus.broadcast('scaling.hire.approved', {
    requestId: String(eventId),
    agentId,
    templateName: template ?? 'default',
  })

  logger.info({ eventId, agentId, agentName }, 'Scale-up executed')
  return agentId
}

/**
 * Execute a scale-down: retire an agent by setting status to offline.
 */
export function executeScaleDown(
  db: Database.Database,
  eventId: number,
  agentId: number,
  workspaceId: number,
): void {
  const now = Math.floor(Date.now() / 1000)

  db.prepare(
    `UPDATE agents SET status = 'offline', updated_at = ? WHERE id = ? AND workspace_id = ?`
  ).run(now, agentId, workspaceId)

  db.prepare(
    `UPDATE scaling_events SET status = 'completed', resolved_at = ? WHERE id = ?`
  ).run(now, eventId)

  eventBus.broadcast('scaling.retire.initiated', {
    agentId,
    reason: 'idle_timeout',
    idleDuration: 0,
  })

  logger.info({ eventId, agentId }, 'Scale-down executed')
}

// --- Internal Helpers ---

function createScalingEvent(
  db: Database.Database,
  policyId: number,
  eventType: string,
  agentId: number | null,
  reason: string,
  metrics: ScalingMetrics,
  workspaceId: number,
): ScalingEvent {
  const now = Math.floor(Date.now() / 1000)
  const snapshot = JSON.stringify(metrics)

  const result = db.prepare(`
    INSERT INTO scaling_events (policy_id, event_type, agent_id, status, reason, metrics_snapshot, workspace_id, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(policyId, eventType, agentId, reason, snapshot, workspaceId, now)

  return {
    id: Number(result.lastInsertRowid),
    policy_id: policyId,
    event_type: eventType,
    agent_id: agentId,
    status: 'pending',
    reason,
    metrics_snapshot: snapshot,
    workspace_id: workspaceId,
    created_at: now,
    resolved_at: null,
  }
}
