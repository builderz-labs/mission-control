import { execSync } from 'node:child_process'
import path from 'node:path'
import { config } from './config'
import { logger } from './logger'
import { getDatabase, logAuditEvent } from './db'
import { eventBus } from './event-bus'

export interface InterventionResult {
  success: boolean
  message: string
  details?: string
}

/**
 * Validates that a project path is within a known, safe directory.
 * Prevents path traversal or command injection via projectPath.
 */
function isAllowedProjectPath(projectPath: string): boolean {
  if (!projectPath) return false
  const resolved = path.resolve(projectPath)
  const allowedRoots = [
    config.homeDir,
    ...Object.values(config.projects),
  ].filter(Boolean)
  return allowedRoots.some(root => resolved.startsWith(path.resolve(root)))
}

/**
 * Executes a strategic intervention on a specific session.
 */
export async function executeIntervention(
  sessionId: string,
  projectSlug: string,
  action: 'ROLLBACK' | 'HANDOFF' | 'FORCE_SYNC' | 'RESCAN',
  projectPath: string
): Promise<InterventionResult> {
  logger.info({ sessionId, action, projectSlug }, 'Executing Aegis Intervention')

  try {
    switch (action) {
      case 'ROLLBACK':
        return await performRollback(projectPath, sessionId)
      case 'FORCE_SYNC':
        return await performForceSync(sessionId)
      case 'HANDOFF':
        return await performHandoff(sessionId)
      case 'RESCAN':
        return await performRescan(sessionId)
      default:
        return { success: false, message: `Unknown intervention action: ${action}` }
    }
  } catch (err: any) {
    logger.error({ err, sessionId, action }, 'Intervention execution failed')
    return { success: false, message: 'Internal execution error', details: err.message }
  }
}

async function performRollback(projectPath: string, sessionId: string): Promise<InterventionResult> {
  if (!isAllowedProjectPath(projectPath)) {
    logger.warn({ projectPath, sessionId }, 'Rollback rejected: project path not in allowlist')
    return { success: false, message: 'Rollback rejected: project path is not within an allowed directory.' }
  }

  const { swarmOverlord } = await import('./swarm-overlord')

  const lockAcquired = swarmOverlord.acquireLock(projectPath, sessionId, 'AEGIS_AUTO', 120)
  if (!lockAcquired) {
    return { success: false, message: 'Rollback aborted: Resource currently locked by another agent.' }
  }

  try {
    const resolvedPath = path.resolve(projectPath)
    const branch = execSync('git branch --show-current', { cwd: resolvedPath, encoding: 'utf-8', timeout: 10000 }).trim()

    execSync('git reset --hard HEAD~1', { cwd: resolvedPath, timeout: 10000 })

    logAuditEvent({
      action: 'intervention_rollback',
      actor: 'AEGIS_AUTO',
      target_type: 'session',
      target_id: 0,
      detail: { session_id: sessionId, description: `Executed hard rollback to HEAD~1 on branch ${branch}` }
    })

    return {
      success: true,
      message: `Rollback successful on ${branch}. HEAD reset to HEAD~1.`,
      details: 'Agent changes reverted.'
    }
  } catch (err: any) {
    return { success: false, message: 'Rollback failed', details: err.message }
  } finally {
    swarmOverlord.releaseLock(projectPath, sessionId)
  }
}

async function performForceSync(sessionId: string): Promise<InterventionResult> {
  try {
    const { syncClaudeSessions } = await import('./claude-sessions')
    await syncClaudeSessions(0)

    return { success: true, message: 'Force-Sync executed. Global fleet state refreshed.' }
  } catch (err: any) {
    return { success: false, message: 'Force-sync failed', details: err.message }
  }
}

async function performHandoff(sessionId: string): Promise<InterventionResult> {
  try {
    const db = getDatabase()

    // Look up the session in claude_sessions
    const session = db.prepare(
      'SELECT id, session_id, project_slug, project_path, model, is_active, alert_status FROM claude_sessions WHERE session_id = ?'
    ).get(sessionId) as {
      id: number
      session_id: string
      project_slug: string
      project_path: string | null
      model: string | null
      is_active: number
      alert_status: string
    } | undefined

    if (!session) {
      return { success: false, message: 'Session not found', details: `No session with id "${sessionId}" exists.` }
    }

    // Mark session as handed_off
    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'UPDATE claude_sessions SET alert_status = ?, updated_at = ? WHERE session_id = ?'
    ).run('handed_off', now, sessionId)

    // Log audit event
    logAuditEvent({
      action: 'intervention.handoff',
      actor: 'AEGIS_AUTO',
      target_type: 'session',
      target_id: session.id,
      detail: {
        session_id: sessionId,
        project_slug: session.project_slug,
        project_path: session.project_path,
        model: session.model,
        previous_alert_status: session.alert_status,
        description: 'Session handed off for specialized sub-agent intervention',
      },
    })

    // Broadcast event to SSE watchers
    eventBus.broadcast('activity.created', {
      type: 'intervention_handoff',
      entity_type: 'session',
      entity_id: session.id,
      actor: 'AEGIS_AUTO',
      description: `Handoff initiated for session ${sessionId} (${session.project_slug})`,
      data: { session_id: sessionId, project_slug: session.project_slug },
      created_at: now,
    })

    return {
      success: true,
      message: `Handoff completed for session ${sessionId}.`,
      details: JSON.stringify({
        session_id: sessionId,
        project_slug: session.project_slug,
        project_path: session.project_path,
        model: session.model,
        new_alert_status: 'handed_off',
      }),
    }
  } catch (err: any) {
    return { success: false, message: 'Handoff failed', details: err.message }
  }
}

async function performRescan(sessionId: string): Promise<InterventionResult> {
  return performForceSync(sessionId)
}
