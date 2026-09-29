import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { validateBody } from '@/lib/validation'
import { A2A_KINDS, A2A_MAX_CONTENT_LENGTH, countUnread, listInbox, markRead } from '@/lib/a2a'
import { A2AError, resolveInboxAgent, sendA2AMessage } from '@/lib/a2a-service'

const sendSchema = z.object({
  to: z.string().trim().min(1).max(100).optional(),
  content: z.string().trim().min(1, 'content is required').max(A2A_MAX_CONTENT_LENGTH),
  kind: z.enum(A2A_KINDS).optional(),
  subject: z.string().trim().max(200).optional(),
  thread_id: z.string().trim().max(80).optional(),
  reply_to: z.number().int().positive().optional(),
  task_id: z.number().int().positive().optional(),
  from: z.string().trim().max(100).optional(),
}).refine((body) => Boolean(body.to || body.reply_to), { message: '"to" or "reply_to" is required' })

function errorResponse(err: unknown, fallback: string) {
  if (err instanceof A2AError) {
    return NextResponse.json({ error: err.message, ...(err.details as object | undefined) }, { status: err.status })
  }
  logger.error({ err }, fallback)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

/**
 * GET /api/a2a/messages — an agent's inbox (newest first).
 * Query: agent (defaults to X-Agent-Name / the calling agent key), unread=1,
 * since (unix seconds), limit, mark_read=1 (marks the returned messages read).
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const agent = resolveInboxAgent(auth.user, searchParams.get('agent'))
    const markAsRead = searchParams.get('mark_read') === '1'
    // Marking read is a mutation: operators, or the agent itself.
    if (markAsRead && !auth.user.agent_id && auth.user.role === 'viewer') {
      return NextResponse.json({ error: 'Requires operator role or higher to mark messages read' }, { status: 403 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    let messages = listInbox(db, workspaceId, agent, {
      unreadOnly: searchParams.get('unread') === '1',
      since: parseInt(searchParams.get('since') || '0', 10) || undefined,
      limit: parseInt(searchParams.get('limit') || '50', 10),
    })
    if (markAsRead && messages.length > 0) {
      markRead(db, workspaceId, agent, { ids: messages.map((m) => m.id) })
      const readAt = Math.floor(Date.now() / 1000)
      messages = messages.map((m) => (m.read_at ? m : { ...m, read_at: readAt }))
    }
    return NextResponse.json({ agent, messages, unread: countUnread(db, workspaceId, agent) })
  } catch (err) {
    return errorResponse(err, 'Failed to load inbox')
  }
}

/**
 * POST /api/a2a/messages — send a message to another agent.
 * Body: { to, content, kind?, subject?, thread_id?, reply_to?, task_id?, from? }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, sendSchema)
  if ('error' in result) return result.error
  const body = result.data

  try {
    const message = await sendA2AMessage(auth.user, {
      to: body.to,
      content: body.content,
      kind: body.kind,
      subject: body.subject,
      threadId: body.thread_id,
      replyTo: body.reply_to,
      taskId: body.task_id,
      from: body.from,
    })
    return NextResponse.json({ message }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'Failed to send message')
  }
}
