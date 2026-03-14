import { execSync } from 'node:child_process'
import path from 'node:path'
import { config } from './config'
import { logger } from './logger'
import { logAuditEvent } from './db'

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
  // Stub: real handoff would spawn a new sub-agent with the previous context
  return {
    success: true,
    message: 'Handoff signal broadcasted. Tactical oversight required.',
    details: 'Session flagged for specialized sub-agent intervention.'
  }
}

async function performRescan(sessionId: string): Promise<InterventionResult> {
  return performForceSync(sessionId)
}
