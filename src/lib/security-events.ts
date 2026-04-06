/**
 * Security Events — structured security event logging and agent trust scoring.
 *
 * Persists events to the security_events table and broadcasts via the event bus.
 * Trust scores are recalculated on each security event using weighted factors.
 */

import { getDatabase } from '@/lib/db'
import { eventBus, type EventType } from '@/lib/event-bus'
import { logger } from '@/lib/logger'

export type SecuritySeverity = 'info' | 'warning' | 'critical'

export interface SecurityEvent {
  event_type: string
  severity?: SecuritySeverity
  source?: string
  agent_name?: string
  detail?: string
  ip_address?: string
  workspace_id?: number
  tenant_id?: number
}

export interface SecurityPosture {
  score: number
  totalEvents: number
  criticalEvents: number
  warningEvents: number
  avgTrustScore: number
  recentIncidents: number
}

const TRUST_WEIGHTS: Record<string, { field: string; delta: number }> = {
  'auth.failure': { field: 'auth_failures', delta: -0.05 },
  'injection.attempt': { field: 'injection_attempts', delta: -0.15 },
  'rate_limit.hit': { field: 'rate_limit_hits', delta: -0.03 },
  'secret.exposure': { field: 'secret_exposures', delta: -0.20 },
  'task.success': { field: 'successful_tasks', delta: 0.02 },
  'task.failure': { field: 'failed_tasks', delta: -0.01 },
}

export function logSecurityEvent(event: SecurityEvent): number {
  const db = getDatabase()
  const severity = event.severity ?? 'info'
  const workspaceId = event.workspace_id ?? 1
  const tenantId = event.tenant_id ?? 1

  const result = db.prepare(`
    INSERT INTO security_events (event_type, severity, source, agent_name, detail, ip_address, workspace_id, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.event_type,
    severity,
    event.source ?? null,
    event.agent_name ?? null,
    event.detail ?? null,
    event.ip_address ?? null,
    workspaceId,
    tenantId,
  )

  const id = result.lastInsertRowid as number

  eventBus.broadcast('security.event' as EventType, {
    id,
    ...event,
    severity,
    workspace_id: workspaceId,
    timestamp: Math.floor(Date.now() / 1000),
  })

  return id
}

export function updateAgentTrustScore(
  agentName: string,
  eventType: string,
  workspaceId: number = 1,
): void {
  const db = getDatabase()
  const weight = TRUST_WEIGHTS[eventType]

  // Ensure row exists
  db.prepare(`
    INSERT OR IGNORE INTO agent_trust_scores (agent_name, workspace_id)
    VALUES (?, ?)
  `).run(agentName, workspaceId)

  if (weight) {
    // Increment the counter field
    db.prepare(`
      UPDATE agent_trust_scores
      SET ${weight.field} = ${weight.field} + 1,
          updated_at = unixepoch()
      WHERE agent_name = ? AND workspace_id = ?
    `).run(agentName, workspaceId)

    // Recalculate trust score (clamped 0..1)
    const row = db.prepare(`
      SELECT id, agent_name, trust_score, auth_failures, injection_attempts, rate_limit_hits, secret_exposures, workspace_id, created_at, updated_at FROM agent_trust_scores WHERE agent_name = ? AND workspace_id = ?
    `).get(agentName, workspaceId) as {
      id: number; agent_name: string; trust_score: number
      auth_failures: number; injection_attempts: number; rate_limit_hits: number
      secret_exposures: number; successful_tasks: number; failed_tasks: number
      workspace_id: number; created_at: number; updated_at: number
    } | undefined

    if (row) {
      let score = 1.0
      score += (row.auth_failures || 0) * -0.05
      score += (row.injection_attempts || 0) * -0.15
      score += (row.rate_limit_hits || 0) * -0.03
      score += (row.secret_exposures || 0) * -0.20
      score += (row.successful_tasks || 0) * 0.02
      score += (row.failed_tasks || 0) * -0.01
      score = Math.max(0, Math.min(1, score))

      const isAnomaly = weight.delta < 0
      db.prepare(`
        UPDATE agent_trust_scores
        SET trust_score = ?,
            last_anomaly_at = CASE WHEN ? THEN unixepoch() ELSE last_anomaly_at END,
            updated_at = unixepoch()
        WHERE agent_name = ? AND workspace_id = ?
      `).run(score, isAnomaly ? 1 : 0, agentName, workspaceId)
    }
  }
}

export function getSecurityPosture(workspaceId: number = 1): SecurityPosture {
  const db = getDatabase()
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning
    FROM security_events
    WHERE workspace_id = ?
  `).get(workspaceId) as { total: number; critical: number; warning: number } | undefined

  const recent = db.prepare(`
    SELECT COUNT(*) as count
    FROM security_events
    WHERE workspace_id = ? AND severity IN ('warning', 'critical') AND created_at > ?
  `).get(workspaceId, oneDayAgo) as { count: number } | undefined

  const trustAvg = db.prepare(`
    SELECT AVG(trust_score) as avg_trust
    FROM agent_trust_scores
    WHERE workspace_id = ?
  `).get(workspaceId) as { avg_trust: number | null } | undefined

  const avgTrust = trustAvg?.avg_trust ?? 1.0
  const criticalCount = totals?.critical ?? 0
  const warningCount = totals?.warning ?? 0
  const recentCount = recent?.count ?? 0

  // Score: start at 100, deduct for incidents
  let score = 100
  score -= criticalCount * 10
  score -= warningCount * 3
  score -= recentCount * 2
  score = Math.round(Math.max(0, Math.min(100, score * avgTrust)))

  return {
    score,
    totalEvents: totals?.total ?? 0,
    criticalEvents: criticalCount,
    warningEvents: warningCount,
    avgTrustScore: Math.round(avgTrust * 100) / 100,
    recentIncidents: recentCount,
  }
}
