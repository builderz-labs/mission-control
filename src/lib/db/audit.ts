import { eventBus } from '../event-bus';
import { getDatabase } from './connection';

/**
 * Log a security/admin audit event into the audit_log table.
 * Security-sensitive actions (login_failed, user_created, etc.) are also
 * broadcast over the SSE event bus so webhook listeners can react immediately.
 */
export function logAuditEvent(event: {
  action: string
  actor: string
  actor_id?: number
  target_type?: string
  target_id?: number
  detail?: unknown
  ip_address?: string
  user_agent?: string
}): void {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO audit_log (action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.action,
    event.actor,
    event.actor_id ?? null,
    event.target_type ?? null,
    event.target_id ?? null,
    event.detail ? JSON.stringify(event.detail) : null,
    event.ip_address ?? null,
    event.user_agent ?? null,
  )

  // Broadcast audit events (webhooks listen here too)
  const securityEvents = ['login_failed', 'user_created', 'user_deleted', 'password_change']
  if (securityEvents.includes(event.action)) {
    eventBus.broadcast('audit.security', {
      action: event.action,
      actor: event.actor,
      target_type: event.target_type ?? null,
      target_id: event.target_id ?? null,
      timestamp: Math.floor(Date.now() / 1000),
    })
  }
}

/**
 * Append a structured log entry to the provision_events table for a running job.
 */
export function appendProvisionEvent(event: {
  job_id: number
  level?: 'info' | 'warn' | 'error'
  step_key?: string
  message: string
  data?: unknown
}): void {
  const db = getDatabase()
  db.prepare(`
    INSERT INTO provision_events (job_id, level, step_key, message, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    event.job_id,
    event.level || 'info',
    event.step_key ?? null,
    event.message,
    event.data ? JSON.stringify(event.data) : null
  )
}
