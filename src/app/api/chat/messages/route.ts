import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { getAllGatewaySessions } from '@/lib/sessions'
import { ensureGatewaySessionForAgent } from '@/lib/sessions'
import { spawnOrchestrator } from '@/lib/orchestrator-spawn'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getGatewayDeliveryStatus } from '@/lib/gateway-runtime'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
}

const DEFAULT_COORDINATOR_AGENT = 'TechLead'
const rawCoordinatorAgent = String(
  process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || DEFAULT_COORDINATOR_AGENT
).trim()
const COORDINATOR_AGENT =
  rawCoordinatorAgent && rawCoordinatorAgent.toLowerCase() !== 'coordinator'
    ? rawCoordinatorAgent
    : DEFAULT_COORDINATOR_AGENT

function resolveCoordinatorTarget(db: ReturnType<typeof getDatabase>) {
  const candidates = db.prepare(`
    SELECT name, role, status, config
    FROM agents
    ORDER BY
      CASE
        WHEN lower(name) = lower(?) THEN 0
        WHEN lower(name) LIKE '%orchestrator%' THEN 1
        WHEN lower(name) LIKE '%techlead%' THEN 2
        WHEN lower(role) LIKE '%orchestrator%' THEN 3
        WHEN lower(role) LIKE '%coordinator%' THEN 4
        WHEN lower(COALESCE(config, '')) LIKE '%"team":"orchestrator"%' THEN 5
        ELSE 99
      END,
      CASE WHEN status IN ('idle', 'busy') THEN 0 ELSE 1 END,
      updated_at DESC,
      created_at ASC
  `).all(COORDINATOR_AGENT) as Array<{ name: string }>

  return candidates[0]?.name || COORDINATOR_AGENT
}

function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

function createChatReply(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' = 'status',
  metadata: Record<string, any> | null = null
) {
  const replyInsert = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversationId,
      fromAgent,
      toAgent,
      content,
      messageType,
      metadata ? JSON.stringify(metadata) : null
    )

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .get(replyInsert.lastInsertRowid) as Message

  eventBus.broadcast('chat.message', {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  })
}

function extractReplyText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  const directCandidates = [
    waitPayload.text,
    waitPayload.message,
    waitPayload.response,
    waitPayload.output,
    waitPayload.result,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof waitPayload.output === 'object' && waitPayload.output) {
    const nested = [
      waitPayload.output.text,
      waitPayload.output.message,
      waitPayload.output.content,
    ]
    for (const value of nested) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  return null
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildLocalCoordinatorTask(content: string) {
  return [
    'Coordinator chat fallback.',
    'Answer the user message directly as the Mission Control orchestrator.',
    'Do not modify repository files.',
    'Keep the answer concise and practical.',
    'Write the final reply to output/chat-reply.md and also print the reply to stdout.',
    '',
    `User message: ${content}`,
  ].join('\n')
}

function extractLocalFallbackReply(folder: string, run: any): string | null {
  const replyFile = join(folder, 'output', 'chat-reply.md')
  if (existsSync(replyFile)) {
    try {
      const text = readFileSync(replyFile, 'utf-8').trim()
      if (text) return text
    } catch {
      // ignore
    }
  }

  const output = String(run?.output || '').trim()
  if (!output) return null
  const cleaned = output
    .replace(/\x1B\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('[system]'))
    .filter((line) => !line.startsWith('[stderr]'))
  return cleaned.slice(-12).join('\n').trim() || null
}

async function runLocalCoordinatorFallback(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  coordinatorTarget: string,
  from: string,
  content: string
) {
  const project = db.prepare(
    `SELECT id, name, folder FROM orchestrator_projects ORDER BY updated_at DESC, id DESC LIMIT 1`
  ).get() as { id: number; name: string; folder: string } | undefined

  if (!project?.folder || !existsSync(join(project.folder, 'index.js'))) {
    return { ok: false, reason: 'no_local_orchestrator_project' }
  }

  const now = Math.floor(Date.now() / 1000)
  const task = buildLocalCoordinatorTask(content)
  const runRow = db.prepare(
    `INSERT INTO orchestrator_runs (project_id, folder, task_description, status, started_at, task_id)
     VALUES (?, ?, ?, 'running', ?, NULL)`
  ).run(project.id, project.folder, task, now)
  const runId = Number(runRow.lastInsertRowid)

  createChatReply(
    db,
    conversationId,
    coordinatorTarget,
    from,
    `Gateway delivery is unavailable. Falling back to the local orchestrator project "${project.name}" now.`,
    'status',
    { status: 'local_fallback_started', runId, project: project.name }
  )

  spawnOrchestrator(runId, project.folder, task)

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    await sleep(500)
    const run = db.prepare('SELECT * FROM orchestrator_runs WHERE id = ?').get(runId) as any
    if (!run || run.status === 'running') continue

    if (run.status === 'completed') {
      const reply = extractLocalFallbackReply(project.folder, run)
      if (reply) {
        createChatReply(
          db,
          conversationId,
          coordinatorTarget,
          from,
          reply,
          'text',
          { status: 'local_fallback_completed', runId, project: project.name }
        )
      } else {
        createChatReply(
          db,
          conversationId,
          coordinatorTarget,
          from,
          'The local orchestrator finished, but it did not return a reply body.',
          'status',
          { status: 'local_fallback_empty', runId, project: project.name }
        )
      }
      return { ok: true, runId, reason: 'local_orchestrator_fallback' }
    }

    createChatReply(
      db,
      conversationId,
      coordinatorTarget,
      from,
      `The local orchestrator fallback failed${run?.error ? `: ${run.error}` : '.'}`,
      'status',
      { status: 'local_fallback_failed', runId, project: project.name }
    )
    return { ok: false, runId, reason: 'local_fallback_failed' }
  }

  createChatReply(
    db,
    conversationId,
    coordinatorTarget,
    from,
    'The local orchestrator is still processing your message. Check the Orchestrator panel for the active run.',
    'status',
    { status: 'local_fallback_processing', runId, project: project.name }
  )
  return { ok: true, runId, reason: 'local_orchestrator_processing' }
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
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query = 'SELECT * FROM messages WHERE 1=1'
    const params: any[] = []

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
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null
    }))

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE 1=1'
    const countParams: any[] = []
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
 * Body: { from, to, content, message_type, conversation_id, metadata }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const coordinatorTarget = resolveCoordinatorTarget(db)

    const from = (body.from || '').trim()
    const requestedTo = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null
    const isCoordinatorConversation =
      typeof conversation_id === 'string' && conversation_id.startsWith('coord:')
    const to = isCoordinatorConversation
      ? requestedTo || coordinatorTarget
      : requestedTo

    if (!from || !content) {
      return NextResponse.json(
        { error: '"from" and "content" are required' },
        { status: 400 }
      )
    }

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      content,
      message_type,
      metadata ? JSON.stringify(metadata) : null
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
      { conversation_id, to, message_type }
    )

    // Create notification for recipient if specified
    if (to) {
      db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        'message',
        messageId
      )

      // Optionally forward to agent via gateway
      if (body.forward) {
        forwardInfo = { attempted: true, delivered: false }

        const agent = db
          .prepare('SELECT * FROM agents WHERE lower(name) = lower(?)')
          .get(to) as any

        let sessionKey: string | null = agent?.session_key || null

        if (!sessionKey && typeof to === 'string') {
          const ensuredSession = ensureGatewaySessionForAgent(to, {
            chatType: 'main',
            channel: isCoordinatorConversation ? 'orchestrator' : 'chat',
          })
          if (ensuredSession?.key) {
            sessionKey = ensuredSession.key
            if (agent?.id) {
              db.prepare('UPDATE agents SET session_key = ?, updated_at = ? WHERE id = ?')
                .run(sessionKey, Math.floor(Date.now() / 1000), agent.id)
            }
          }
        }

        // Fallback: derive session from on-disk gateway session stores
        if (!sessionKey) {
          const sessions = getAllGatewaySessions()
          const match = sessions.find(
            (s) => s.agent.toLowerCase() === String(to).toLowerCase()
          )
          sessionKey = match?.key || match?.sessionId || null
        }

        // Prefer configured openclawId when present.
        let openclawAgentId: string | null = null
        if (agent?.config) {
          try {
            const cfg = JSON.parse(agent.config)
            if (cfg?.openclawId && typeof cfg.openclawId === 'string') {
              openclawAgentId = cfg.openclawId
            }
          } catch {
            // ignore parse issues
          }
        }
        const isCoordinatorTarget =
          typeof to === 'string' &&
          to.toLowerCase() === COORDINATOR_AGENT.toLowerCase()

        // For non-coordinator messaging, fallback to a normalized name.
        // Coordinator flow should require a real live session (or explicit openclawId)
        // so we can provide accurate offline status feedback.
        if (!openclawAgentId && typeof to === 'string' && !isCoordinatorTarget) {
          openclawAgentId = to.toLowerCase().replace(/\s+/g, '-')
        }

        if (!sessionKey && !openclawAgentId) {
          forwardInfo.reason = 'no_active_session'

          // For coordinator messages, emit an immediate visible status reply
          if (isCoordinatorConversation) {
            try {
                createChatReply(
                  db,
                  conversation_id,
                  coordinatorTarget,
                  from,
                  'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.',
                  'status',
                  { status: 'offline', reason: 'no_active_session' }
                )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create offline status reply')
            }
          }
        } else {
          const gatewayStatus = await getGatewayDeliveryStatus()
          if (!gatewayStatus.canDeliver) {
            forwardInfo.reason = gatewayStatus.portListening ? 'gateway_cli_unavailable' : 'gateway_offline'

            if (isCoordinatorConversation) {
              const fallback = await runLocalCoordinatorFallback(db, conversation_id, coordinatorTarget, from, content)
              if (fallback.ok) {
                forwardInfo.delivered = true
                forwardInfo.runId = fallback.runId ? String(fallback.runId) : undefined
                forwardInfo.reason = fallback.reason
              } else {
                try {
                  createChatReply(
                    db,
                    conversation_id,
                    coordinatorTarget,
                    from,
                    `I received your message, but coordinator delivery is unavailable: ${gatewayStatus.reason}. Start or restore the OpenClaw gateway, then retry.`,
                    'status',
                    {
                      status: 'gateway_unavailable',
                      reason: gatewayStatus.reason,
                      host: gatewayStatus.host,
                      port: gatewayStatus.port,
                    }
                  )
                } catch (e) {
                  logger.error({ err: e }, 'Failed to create gateway unavailable status reply')
                }
              }
            }
          } else {
          try {
            const invokeParams: any = {
              message: `Message from ${from}: ${content}`,
              idempotencyKey: `mc-${messageId}-${Date.now()}`,
              deliver: true,
            }
            if (sessionKey) invokeParams.sessionKey = sessionKey
            else invokeParams.agentId = openclawAgentId

            const invokeResult = await runOpenClaw(
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
            const acceptedPayload = parseGatewayJson(invokeResult.stdout)
            forwardInfo.delivered = true
            forwardInfo.session = sessionKey || openclawAgentId || undefined
            if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
              forwardInfo.runId = acceptedPayload.runId
            }
          } catch (err) {
            // OpenClaw may return accepted JSON on stdout but still emit a late stderr warning.
            // Treat accepted runs as successful delivery.
            const maybeStdout = String((err as any)?.stdout || '')
            const acceptedPayload = parseGatewayJson(maybeStdout)
            if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
              forwardInfo.delivered = true
              forwardInfo.session = sessionKey || openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
            } else {
              forwardInfo.reason = 'gateway_send_failed'
              logger.warn({ err }, 'Failed to forward message via gateway')

              // For coordinator messages, emit visible status when send fails
              if (isCoordinatorConversation) {
                try {
                  createChatReply(
                    db,
                    conversation_id,
                    coordinatorTarget,
                    from,
                    'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.',
                    'status',
                    { status: 'delivery_failed', reason: 'gateway_send_failed' }
                  )
                } catch (e) {
                  logger.error({ err: e }, 'Failed to create gateway failure status reply')
                }
              }
            }
          }

          // Coordinator mode should always show visible coordinator feedback in thread.
          if (
            isCoordinatorConversation &&
            forwardInfo.delivered
          ) {
            try {
              createChatReply(
                db,
                conversation_id,
                coordinatorTarget,
                from,
                'Received. I am coordinating downstream agents now.',
                'status',
                { status: 'accepted', runId: forwardInfo.runId || null }
              )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create accepted status reply')
            }

            // Best effort: wait briefly and surface completion/error feedback.
            if (forwardInfo.runId) {
              try {
                const waitResult = await runOpenClaw(
                  [
                    'gateway',
                    'call',
                    'agent.wait',
                    '--timeout',
                    '8000',
                    '--params',
                    JSON.stringify({ runId: forwardInfo.runId, timeoutMs: 6000 }),
                    '--json',
                  ],
                  { timeoutMs: 9000 }
                )

                const waitPayload = parseGatewayJson(waitResult.stdout)
                const waitStatus = String(waitPayload?.status || '').toLowerCase()

                if (waitStatus === 'error') {
                  const reason =
                    typeof waitPayload?.error === 'string'
                      ? waitPayload.error
                      : 'Unknown runtime error'
                  createChatReply(
                    db,
                    conversation_id,
                    coordinatorTarget,
                    from,
                    `I received your message, but execution failed: ${reason}`,
                    'status',
                    { status: 'error', runId: forwardInfo.runId }
                  )
                } else if (waitStatus === 'timeout') {
                  createChatReply(
                    db,
                    conversation_id,
                    coordinatorTarget,
                    from,
                    'I received your message and I am still processing it. I will post results as soon as execution completes.',
                    'status',
                    { status: 'processing', runId: forwardInfo.runId }
                  )
                } else {
                  const replyText = extractReplyText(waitPayload)
                  if (replyText) {
                    createChatReply(
                      db,
                      conversation_id,
                      coordinatorTarget,
                      from,
                      replyText,
                      'text',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  } else {
                    createChatReply(
                      db,
                      conversation_id,
                      coordinatorTarget,
                      from,
                      'Execution accepted and completed. No textual response payload was returned by the runtime.',
                      'status',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  }
                }
              } catch (waitErr) {
                const maybeWaitStdout = String((waitErr as any)?.stdout || '')
                const maybeWaitStderr = String((waitErr as any)?.stderr || '')
                const waitPayload = parseGatewayJson(maybeWaitStdout)
                const reason =
                  typeof waitPayload?.error === 'string'
                    ? waitPayload.error
                    : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim()

                createChatReply(
                  db,
                  conversation_id,
                  coordinatorTarget,
                  from,
                  `I received your message, but I could not retrieve completion output yet: ${reason}`,
                  'status',
                  { status: 'unknown', runId: forwardInfo.runId }
                )
              }
            }
          }
          }
        }
      }
    }

    const created = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId) as Message
    const parsedMessage = {
      ...created,
      metadata: created.metadata ? JSON.parse(created.metadata) : null
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
