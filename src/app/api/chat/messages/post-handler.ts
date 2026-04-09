import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, type Message } from '@/lib/db'
import { getAllGatewaySessions } from '@/lib/sessions'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { scanForInjection } from '@/lib/injection-guard'
import { resolveCoordinatorDeliveryTarget } from '@/lib/coordinator-routing'
import { safeParseMetadata } from './get-handler'
import { COORDINATOR_AGENT, forwardMessageToGateway, type ForwardInfo } from './forward-utils'

interface AgentRow {
  name: string
  session_key: string | null
  config: string | null
  id: number
  role: string | null
  status: string | null
  last_seen: string | null
  last_activity: string | null
  created_at: string
  updated_at: string
  workspace_id: number
  source: string | null
  content_hash: string | null
  workspace_path: string | null
}

/**
 * POST /api/chat/messages — Send a new message.
 * WHY: Agent-to-agent messaging uses the `from` field to identify the sending agent
 * (e.g. "coordinator", "e2e-operator-123"), not the authenticated API user. The auth
 * check still enforces that only authorised operators can post; the `from` field is
 * preserved as-is to maintain correct agent conversation threading. If `from` is
 * omitted, we fall back to the authenticated user's display name.
 */
export async function handlePostMessage(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const requestedFrom = typeof body.from === 'string' ? body.from.trim() : ''
    // Preserve client-supplied agent identity; fall back to auth user only when absent.
    const from = requestedFrom || (auth.user.display_name || auth.user.username || 'system')
    const to = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null

    if (!content) {
      return NextResponse.json({ error: '"content" is required' }, { status: 400 })
    }

    // Block critical-severity injection attempts on forwarded messages
    if (body.forward && to) {
      const injectionReport = scanForInjection(content, { context: 'prompt' })
      if (!injectionReport.safe) {
        const criticals = injectionReport.matches.filter((m) => m.severity === 'critical')
        if (criticals.length > 0) {
          logger.warn({ to, rules: criticals.map((m) => m.rule) }, 'Blocked chat message: injection detected')
          return NextResponse.json(
            { error: 'Message blocked: potentially unsafe content detected', injection: criticals.map((m) => ({ rule: m.rule, description: m.description })) },
            { status: 422 },
          )
        }
      }
    }

    const result = db
      .prepare(
        `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(conversation_id, from, to, content, message_type, metadata ? JSON.stringify(metadata) : null, workspaceId)

    const messageId = result.lastInsertRowid as number
    let forwardInfo: ForwardInfo | null = null

    db_helpers.logActivity(
      'chat_message', 'message', messageId, from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type },
      workspaceId,
    )

    if (to) {
      db_helpers.createNotification(
        to, 'chat_message', `Message from ${from}`,
        content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        'message', messageId, workspaceId,
      )

      if (body.forward) {
        const agent = db
          .prepare(
            'SELECT id, name, role, session_key, status, last_seen, last_activity, created_at, updated_at, config, workspace_id, source, content_hash, workspace_path FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?',
          )
          .get(to, workspaceId) as AgentRow | undefined

        const explicitSessionKey =
          typeof body.sessionKey === 'string' && body.sessionKey ? body.sessionKey : null
        const sessions = getAllGatewaySessions()
        const isCoordinatorSend = String(to).toLowerCase() === COORDINATOR_AGENT.toLowerCase()

        const allAgents = isCoordinatorSend
          ? (db.prepare('SELECT name, session_key, config FROM agents WHERE workspace_id = ?').all(workspaceId) as Array<{ name: string; session_key?: string | null; config?: string | null }>)
          : []

        const configuredCoordinatorTarget = isCoordinatorSend
          ? (db.prepare("SELECT value FROM settings WHERE key = 'chat.coordinator_target_agent'").get() as { value?: string } | undefined)?.value ?? null
          : null

        const coordinatorResolution = resolveCoordinatorDeliveryTarget({
          to: String(to),
          coordinatorAgent: COORDINATOR_AGENT,
          directAgent: agent ? { name: String(agent.name || to), session_key: typeof agent.session_key === 'string' ? agent.session_key : null, config: typeof agent.config === 'string' ? agent.config : null } : null,
          allAgents,
          sessions,
          explicitSessionKey,
          configuredCoordinatorTarget,
        })

        let sessionKey: string | null = coordinatorResolution.sessionKey

        // Fallback: derive session from on-disk gateway session stores
        if (!sessionKey) {
          const match = sessions.find(
            (s) =>
              s.agent.toLowerCase() === String(to).toLowerCase() ||
              s.agent.toLowerCase() === coordinatorResolution.deliveryName.toLowerCase() ||
              s.agent.toLowerCase() === String(coordinatorResolution.openclawAgentId || '').toLowerCase(),
          )
          sessionKey = match?.key || match?.sessionId || null
        }

        forwardInfo = await forwardMessageToGateway({
          db,
          workspaceId,
          messageId,
          from,
          to,
          content,
          conversationId: conversation_id,
          sessionKey,
          openclawAgentId: coordinatorResolution.openclawAgentId,
          attachments: body.attachments,
        })
      }
    }

    const created = db
      .prepare(
        'SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at, created_at, workspace_id FROM messages WHERE id = ? AND workspace_id = ?',
      )
      .get(messageId, workspaceId) as Message

    const parsedMessage = {
      ...created,
      metadata: {
        ...(safeParseMetadata(created.metadata) as Record<string, unknown> || {}),
        forwardInfo: forwardInfo ?? undefined,
      },
    }

    eventBus.broadcast('chat.message', parsedMessage)
    return NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
