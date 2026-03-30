import { getDatabase, db_helpers } from './db'
import { eventBus } from './event-bus'
import { logger } from './logger'
import { runOpenClaw } from './command'
import {
  ensureHealthRecord,
  type AgentHealthRecord,
} from './agent-health'

const MAX_NUDGES = parseInt(process.env.HEALTH_MAX_NUDGES || '3', 10)

// Exponential backoff: 1min, 5min, 15min
const NUDGE_BACKOFF_SEC = [60, 300, 900]

/**
 * Check whether an agent is eligible for a nudge based on:
 * - Health status is stuck or zombie
 * - Hasn't exceeded MAX_NUDGES
 * - Enough time has passed since last nudge (exponential backoff)
 */
export function canNudge(health: AgentHealthRecord, now: number = Math.floor(Date.now() / 1000)): boolean {
  if (health.status !== 'stuck' && health.status !== 'zombie') return false
  if (health.nudge_count >= MAX_NUDGES) return false

  if (health.last_nudge_at) {
    const backoffIdx = Math.min(health.nudge_count, NUDGE_BACKOFF_SEC.length - 1)
    const cooldown = NUDGE_BACKOFF_SEC[backoffIdx]
    if (now - health.last_nudge_at < cooldown) return false
  }

  return true
}

/**
 * Send a nudge to an agent via the gateway session.
 * Returns true if the nudge was delivered successfully.
 */
export async function nudgeAgent(
  workspaceId: number,
  agentId: string,
  message?: string
): Promise<{ success: boolean; error?: string }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Look up agent
  const agent = db.prepare(
    'SELECT * FROM agents WHERE name = ? AND workspace_id = ?'
  ).get(agentId, workspaceId) as { id: number; name: string; session_key?: string; status: string } | undefined

  if (!agent) return { success: false, error: 'Agent not found' }
  if (!agent.session_key) return { success: false, error: 'Agent has no session key' }

  const health = ensureHealthRecord(workspaceId, agentId)

  if (health.nudge_count >= MAX_NUDGES) {
    return { success: false, error: `Max nudges (${MAX_NUDGES}) exceeded` }
  }

  // Build nudge message with checkpoint context if available
  const checkpoint = db.prepare(
    'SELECT * FROM work_checkpoints WHERE workspace_id = ? AND agent_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(workspaceId, agentId) as { state_summary: string; task_id: string } | undefined

  const nudgeMessage = message || buildNudgeMessage(agentId, health, checkpoint)

  try {
    const { stdout, stderr } = await runOpenClaw(
      ['gateway', 'sessions_send', '--session', agent.session_key, '--message', nudgeMessage],
      { timeoutMs: 10_000 }
    )

    if (stderr && stderr.includes('error')) {
      logger.warn({ agentId, stderr }, 'Nudge delivery returned error')
      return { success: false, error: stderr.trim() }
    }

    // Record nudge in health table
    db.prepare(`
      UPDATE agent_health
      SET last_nudge_at = ?, nudge_count = nudge_count + 1, updated_at = ?
      WHERE workspace_id = ? AND agent_id = ?
    `).run(now, now, workspaceId, agentId)

    // Log activity
    db_helpers.logActivity(
      'agent_nudge',
      'agent',
      agent.id,
      'system',
      `Auto-nudge #${health.nudge_count + 1} sent to ${agentId}`,
      { nudge_count: health.nudge_count + 1, health_status: health.status },
      workspaceId
    )

    eventBus.broadcast('agent.nudge_sent', {
      workspace_id: workspaceId,
      agent_id: agentId,
      status: health.status,
      nudge_count: health.nudge_count + 1,
      event: 'nudge_sent',
    })

    logger.info({ agentId, nudgeCount: health.nudge_count + 1 }, 'Agent nudge sent')
    return { success: true }
  } catch (err: any) {
    logger.error({ err, agentId }, 'Failed to nudge agent')
    return { success: false, error: err.message }
  }
}

function buildNudgeMessage(
  agentId: string,
  health: AgentHealthRecord,
  checkpoint?: { state_summary: string; task_id: string } | undefined
): string {
  const lines = [
    `[Health Monitor] Agent "${agentId}" appears ${health.status}.`,
    `This is nudge #${health.nudge_count + 1} of ${MAX_NUDGES}.`,
  ]

  if (health.task_id) {
    lines.push(`Current task: ${health.task_id}`)
  }

  if (checkpoint) {
    lines.push('', '--- Last Checkpoint ---', checkpoint.state_summary)
  }

  lines.push('', 'Please check in: review your current task and report progress.')

  return lines.join('\n')
}

/**
 * Auto-nudge all stuck/zombie agents in a workspace.
 * Intended to be called by the health sweep scheduler.
 */
export async function autoNudgeUnhealthyAgents(
  workspaceId: number
): Promise<{ nudged: string[]; skipped: string[]; errors: string[] }> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const unhealthy = db.prepare(
    "SELECT * FROM agent_health WHERE workspace_id = ? AND status IN ('stuck', 'zombie')"
  ).all(workspaceId) as AgentHealthRecord[]

  const nudged: string[] = []
  const skipped: string[] = []
  const errors: string[] = []

  for (const health of unhealthy) {
    if (!canNudge(health, now)) {
      skipped.push(health.agent_id)
      continue
    }

    const result = await nudgeAgent(workspaceId, health.agent_id)
    if (result.success) {
      nudged.push(health.agent_id)
    } else {
      errors.push(`${health.agent_id}: ${result.error}`)
    }
  }

  return { nudged, skipped, errors }
}
