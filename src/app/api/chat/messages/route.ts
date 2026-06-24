import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { scanForInjection } from '@/lib/injection-guard'
import { dispatchChatToAgent } from '@/lib/chat-dispatch'

type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
}

const COORDINATOR_AGENT =
  String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
  'coordinator'

function safeParseMetadata(raw: string | null | undefined): any | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function createChatReply(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' | 'tool_call' = 'status',
  metadata: Record<string, any> | null = null
) {
  const replyInsert = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversationId,
      fromAgent,
      toAgent,
      content,
      messageType,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(replyInsert.lastInsertRowid, workspaceId) as Message

  eventBus.broadcast('chat.message', {
    ...row,
    metadata: safeParseMetadata(row.metadata),
  })
}

/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query = 'SELECT * FROM messages WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (conversation_id) {
      query += ' AND conversation_id = ?'
      params.push(conversation_id)
    }

    if (from_agent) {
      query += ' AND from_agent = ?'
      params.push(from_agent)
    }

    if (to_agent) {
      query += ' AND to_agent = ?'
      params.push(to_agent)
    }

    if (since) {
      query += ' AND created_at > ?'
      params.push(parseInt(since))
    }

    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const messages = db.prepare(query).all(...params) as Message[]

    const parsed = messages.map((msg) => ({
      ...msg,
      metadata: safeParseMetadata(msg.metadata),
    }))

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE workspace_id = ?'
    const countParams: any[] = [workspaceId]
    if (conversation_id) {
      countQuery += ' AND conversation_id = ?'
      countParams.push(conversation_id)
    }
    if (from_agent) {
      countQuery += ' AND from_agent = ?'
      countParams.push(from_agent)
    }
    if (to_agent) {
      countQuery += ' AND to_agent = ?'
      countParams.push(to_agent)
    }
    if (since) {
      countQuery += ' AND created_at > ?'
      countParams.push(parseInt(since))
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({ messages: parsed, total: countRow.total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/chat/messages - Send a new message
 * Body: { to, content, message_type, conversation_id, metadata }
 * Sender identity is always resolved server-side from authenticated user.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const requestedFrom = typeof body.from === 'string' ? body.from.trim() : ''
    const isCoordinatorOverride = requestedFrom.toLowerCase() === COORDINATOR_AGENT.toLowerCase()
    const from = isCoordinatorOverride
      ? COORDINATOR_AGENT
      : (auth.user.display_name || auth.user.username || 'system')
    const to = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null

    if (!content) {
      return NextResponse.json(
        { error: '"content" is required' },
        { status: 400 }
      )
    }

    // Scan content for injection when it will be forwarded to an agent
    if (body.forward && to) {
      const injectionReport = scanForInjection(content, { context: 'prompt' })
      if (!injectionReport.safe) {
        const criticals = injectionReport.matches.filter(m => m.severity === 'critical')
        if (criticals.length > 0) {
          logger.warn({ to, rules: criticals.map(m => m.rule) }, 'Blocked chat message: injection detected')
          return NextResponse.json(
            { error: 'Message blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) },
            { status: 422 }
          )
        }
      }
    }

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      content,
      message_type,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

    const messageId = result.lastInsertRowid as number

    let forwardInfo: ForwardInfo | null = null

    // Log activity
    db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type },
      workspaceId
    )

    // Create notification for recipient if specified
    if (to) {
      db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        'message',
        messageId,
        workspaceId
      )

      // Forward to the agent via the Atlas control plane. Replaces the
      // removed OpenClaw gateway: a bare message goes to the coordinator
      // (Atlas), which triages and may dispatch onward; a named recipient is
      // dispatched straight into that agent's repo. The agent's reply arrives
      // asynchronously via PATCH /api/chat/dispatch-callback.
      if (body.forward) {
        forwardInfo = { attempted: true, delivered: false }

        const isCoordinatorSend =
          String(to).toLowerCase() === COORDINATOR_AGENT.toLowerCase()
        const targetAgent = isCoordinatorSend ? COORDINATOR_AGENT : String(to)

        try {
          const dispatched = await dispatchChatToAgent({
            agent: targetAgent,
            prompt: content,
            conversationId: conversation_id,
            fromUser: from,
            originMessageId: messageId,
            requestedBy: auth.user.username || auth.user.email || 'mc-chat',
            mcBase: process.env.MC_PUBLIC_URL || request.nextUrl.origin,
          })

          forwardInfo.delivered = dispatched.accepted
          forwardInfo.session = targetAgent
          if (dispatched.dispatchId) forwardInfo.runId = String(dispatched.dispatchId)
          if (!dispatched.accepted) {
            forwardInfo.reason = dispatched.reason || 'dispatch_rejected'
          }

          // Immediate "working..." turn so the thread shows the agent picked it
          // up. The real answer lands later via the dispatch callback.
          const ackText = dispatched.accepted
            ? dispatched.autoRunning
              ? `On it \u2014 running a session in \`${targetAgent}\` now. I'll post the result here when it finishes.`
              : `Queued \u2014 awaiting approval in #operations before I run this in \`${targetAgent}\`.`
            : `I couldn't start a run for \`${targetAgent}\`: ${dispatched.reason || 'dispatch rejected'}.`
          createChatReply(
            db,
            workspaceId,
            conversation_id,
            targetAgent,
            from,
            ackText,
            'status',
            {
              status: dispatched.accepted
                ? dispatched.autoRunning
                  ? 'running'
                  : 'pending_approval'
                : 'delivery_failed',
              dispatchId: dispatched.dispatchId || null,
            },
          )
        } catch (err) {
          forwardInfo.reason = 'dispatch_unreachable'
          logger.error({ err, targetAgent }, 'Failed to dispatch chat message via Atlas')
          createChatReply(
            db,
            workspaceId,
            conversation_id,
            targetAgent,
            from,
            'I received your message, but the Atlas dispatch service is unreachable right now. Try again shortly.',
            'status',
            { status: 'delivery_failed', reason: 'dispatch_unreachable' },
          )
        }
      }
    }

    const created = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?').get(messageId, workspaceId) as Message
    const parsedMessage = {
      ...created,
      metadata: {
        ...(safeParseMetadata(created.metadata) || {}),
        forwardInfo: forwardInfo || undefined,
      },
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
