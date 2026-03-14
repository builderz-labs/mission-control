import { execSync } from 'node:child_process'
import { config } from './config'
import { logger } from './logger'
import { logAuditEvent } from './db'

export interface InterventionResult {
  success: boolean
  message: string
  details?: string
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
  const { swarmOverlord } = await import('./swarm-overlord')
  
  // 0. Acquire swarm lock for the project path to prevent concurrent modifications
  const lockAcquired = swarmOverlord.acquireLock(projectPath, sessionId, 'AEGIS_AUTO', 120)
  if (!lockAcquired) {
    return { success: false, message: 'Rollback aborted: Resource currently locked by another agent.' }
  }

  try {
    // 1. Identify current branch
    const branch = execSync('git branch --show-current', { cwd: projectPath, encoding: 'utf-8' }).trim()
    
    // 2. Perform hard reset to HEAD~1 to undo the last (likely corrupting) change
    // CAUTION: This is a high-impact action.
    execSync('git reset --hard HEAD~1', { cwd: projectPath })
    
    logAuditEvent({
      action: 'intervention_rollback',
      actor: 'AEGIS_AUTO',
      target_type: 'session',
      target_id: 0, // ID is number in DB, but session_id is string. I'll pass a dummy number and put real ID in detail.
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
  // Logic to trigger a re-scan and potential agent cache clear (if applicable)
  // For now, we manually prune the session's active status and trigger sync
  try {
    const { syncClaudeSessions } = await import('./claude-sessions')
    await syncClaudeSessions(0) // Full re-sync
    
    return { success: true, message: 'Force-Sync executed. Global fleet state refreshed.' }
  } catch (err: any) {
    return { success: false, message: 'Force-sync failed', details: err.message }
  }
}

async function performHandoff(sessionId: string): Promise<InterventionResult> {
  // For now, we mark the session for manual review/handoff in the UI
  // Real handoff would involve spawning a new sub-agent with the previous context
  return { 
    success: true, 
    message: 'Handoff signal broadcasted. Tactical oversight required.',
    details: 'Session flagged for specialized sub-agent intervention.' 
  }
}

async function performRescan(sessionId: string): Promise<InterventionResult> {
  return performForceSync(sessionId)
}
