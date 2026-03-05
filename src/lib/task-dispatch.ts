import { runOpenClaw } from '@/lib/command'
import { getAllGatewaySessions } from '@/lib/sessions'
import { logger } from '@/lib/logger'
import { db_helpers } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'

interface TaskLike {
  id: number
  title: string
  description?: string | null
  status: string
  priority?: string | null
  assigned_to: string
  project_ticket_no?: number | null
  project_prefix?: string | null
}

/**
 * Dispatch a task to an agent via the OpenClaw gateway.
 * Sends a structured message to the agent's session so it can begin work.
 */
export async function dispatchTaskToAgent(
  db: ReturnType<typeof import('@/lib/db').getDatabase>,
  workspaceId: number,
  task: TaskLike
) {
  const agentName = task.assigned_to

  // Look up agent record for session key / openclawId
  const agent = db
    .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
    .get(agentName, workspaceId) as any

  let sessionKey: string | null = agent?.session_key || null

  // Fallback: derive session from on-disk gateway session stores
  if (!sessionKey) {
    const sessions = getAllGatewaySessions()
    const match = sessions.find(
      (s) => s.agent.toLowerCase() === agentName.toLowerCase()
    )
    sessionKey = match?.key || match?.sessionId || null
  }

  // Resolve openclawId
  let openclawAgentId: string | null = null
  if (agent?.config) {
    try {
      const cfg = JSON.parse(agent.config)
      if (cfg?.openclawId && typeof cfg.openclawId === 'string') {
        openclawAgentId = cfg.openclawId
      }
    } catch {
      // ignore
    }
  }
  if (!openclawAgentId) {
    openclawAgentId = agentName.toLowerCase().replace(/\s+/g, '-')
  }

  if (!sessionKey && !openclawAgentId) {
    logger.warn({ taskId: task.id, agent: agentName }, 'Cannot dispatch task: no active session or agent ID')
    return
  }

  const ticketRef = task.project_prefix && task.project_ticket_no
    ? `${task.project_prefix}-${String(task.project_ticket_no).padStart(3, '0')}`
    : `#${task.id}`

  const mcBase = process.env.MC_BASE_URL || 'http://127.0.0.1:3000'

  const taskMessage = [
    `[Task Assignment] ${ticketRef}: ${task.title}`,
    task.priority ? `Priority: ${task.priority}` : null,
    task.description ? `\nDescription:\n${task.description}` : null,
    `\nPlease begin working on this task. Update your progress as you go.`,
    `\n--- Mission Control API ---`,
    `Base URL: ${mcBase}`,
    `Identify yourself with header: x-agent-name: ${agentName}`,
    `Update task status: PUT ${mcBase}/api/tasks/${task.id}  body: {"status":"review"}`,
    `Add comment:       POST ${mcBase}/api/tasks/${task.id}/comments  body: {"content":"...","author":"${agentName}"}`,
    `Valid statuses: in_progress → review → quality_review → done`,
    `When finished, set status to "review" so the team can verify your work.`,
  ].filter(Boolean).join('\n')

  const invokeParams: any = {
    message: taskMessage,
    idempotencyKey: `mc-task-${task.id}-${Date.now()}`,
  }
  if (sessionKey) invokeParams.sessionKey = sessionKey
  else invokeParams.agentId = openclawAgentId

  try {
    await runOpenClaw(
      [
        'gateway',
        'call',
        'agent',
        '--timeout',
        '10000',
        '--params',
        JSON.stringify(invokeParams),
        '--json',
      ],
      { timeoutMs: 12000 }
    )
    logger.info({ taskId: task.id, agent: agentName }, 'Task dispatched to agent via gateway')
    markTaskInProgress(db, workspaceId, task)
  } catch (err) {
    // Check if it was accepted despite stderr noise
    const maybeStdout = String((err as any)?.stdout || '')
    if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
      logger.info({ taskId: task.id, agent: agentName }, 'Task dispatched to agent (accepted with warnings)')
      markTaskInProgress(db, workspaceId, task)
      return
    }
    throw err
  }
}

function markTaskInProgress(
  db: ReturnType<typeof import('@/lib/db').getDatabase>,
  workspaceId: number,
  task: TaskLike
) {
  const now = Math.floor(Date.now() / 1000)
  const result = db.prepare(
    `UPDATE tasks SET status = 'in_progress', updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'assigned'`
  ).run(now, task.id, workspaceId)

  if (result.changes > 0) {
    logger.info({ taskId: task.id, agent: task.assigned_to }, 'Task moved to in_progress after dispatch')
    db_helpers.logActivity(
      'task_updated', 'task', task.id, 'system',
      `Task dispatched to ${task.assigned_to} — moved to in_progress`,
      { oldStatus: 'assigned', newStatus: 'in_progress' },
      workspaceId
    )
    eventBus.broadcast('task.status_changed', { id: task.id, status: 'in_progress', updated_at: now })
  }
}
