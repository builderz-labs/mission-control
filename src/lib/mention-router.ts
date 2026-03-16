import type { Database } from 'better-sqlite3'
import { resolveMentionRecipients } from './mentions'
import { eventBus } from './event-bus'
import { logger } from './logger'

const MAX_AGENT_TURNS_PER_THREAD = 3

interface RoutingResult {
  routed: string[]
  unresolved: string[]
  humanNotified: boolean
  loopPrevented: string[]
}

/**
 * Parse @mentions in a message and route to targets.
 * Broadcasts EventBus events for each agent recipient.
 * Enforces per-thread turn limit to prevent agent-to-agent loops.
 */
export function routeMentions(
  db: Database,
  messageId: number,
  content: string,
  conversationId: string,
  fromAgent: string,
  workspaceId: number
): RoutingResult {
  const result: RoutingResult = {
    routed: [],
    unresolved: [],
    humanNotified: false,
    loopPrevented: [],
  }

  const resolution = resolveMentionRecipients(content, db, workspaceId)
  result.unresolved = resolution.unresolved

  if (resolution.resolved.length === 0) return result

  // Check agent-to-agent turn count for loop prevention
  const agentTurnCount = getAgentTurnCount(db, conversationId)

  for (const target of resolution.resolved) {
    if (target.type === 'special' && target.recipient === '__human__') {
      // Create notification for workspace admin(s)
      try {
        const adminUser = db.prepare(
          "SELECT id FROM users WHERE workspace_id = ? AND role = 'admin' ORDER BY id ASC LIMIT 1"
        ).get(workspaceId) as { id: number } | undefined
        const targetUserId = adminUser?.id ?? 1

        db.prepare(`
          INSERT INTO notifications (user_id, type, title, message, workspace_id)
          VALUES (?, 'mention', ?, ?, ?)
        `).run(
          targetUserId,
          `@human mention from ${fromAgent}`,
          content.slice(0, 200),
          workspaceId
        )
        result.humanNotified = true
        eventBus.broadcast('notification.created', {})
      } catch (err) {
        logger.warn({ err }, 'Failed to create @human notification')
      }
      continue
    }

    if (target.type !== 'agent') continue

    // Check loop prevention — only for agent-originated messages
    const isAgentOriginated = !isHumanUser(db, fromAgent, workspaceId)
    if (isAgentOriginated && agentTurnCount >= MAX_AGENT_TURNS_PER_THREAD) {
      result.loopPrevented.push(target.recipient)
      eventBus.broadcast('chat.mention.loop_prevented', {
        conversationId,
        agentName: target.recipient,
        turnCount: agentTurnCount,
      })
      logger.info(
        `Loop prevented: ${target.recipient} in ${conversationId} (${agentTurnCount} agent turns)`
      )
      continue
    }

    result.routed.push(target.recipient)
    eventBus.broadcast('chat.mention.routed', {
      messageId,
      targetAgent: target.recipient,
      conversationId,
    })
  }

  return result
}

/**
 * Count consecutive agent-to-agent messages in a conversation thread
 * (messages without a human in between).
 */
function getAgentTurnCount(db: Database, conversationId: string): number {
  const recentMessages = db.prepare(`
    SELECT from_agent FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(conversationId) as Array<{ from_agent: string }>

  let count = 0
  for (const msg of recentMessages) {
    // If we hit a human message, stop counting
    if (msg.from_agent === 'user' || msg.from_agent === 'human' || msg.from_agent === 'system') {
      break
    }
    count++
  }
  return count
}

/**
 * Check if the sender is a human user (not an agent).
 */
function isHumanUser(db: Database, name: string, workspaceId: number): boolean {
  if (name === 'user' || name === 'human' || name === 'system') return true
  const user = db.prepare(
    'SELECT id FROM users WHERE username = ? AND workspace_id = ?'
  ).get(name, workspaceId)
  return !!user
}
