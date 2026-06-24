import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, Message } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * Callback from Atlas for a CHAT dispatch — the sibling of
 * /api/tasks/[id]/dispatch PATCH, but it writes the agent's reply into a chat
 * conversation instead of updating a task card.
 *
 * The target conversation + agent are carried in the query string of the
 * callback_url that MC handed Atlas (see src/lib/chat-dispatch.ts), so Atlas
 * needs no chat awareness — it PATCHes back the exact URL it was given.
 *
 *   PATCH|POST /api/chat/dispatch-callback?conv=<id>&agent=<name>&msg=<originId>
 *   body: { status, outcome, error, cost_usd, dispatch_id, agent, source }
 *   auth: x-api-key (admin) — same as the task dispatch callback.
 */

function writeReply(
  conversationId: string,
  fromAgent: string,
  content: string,
  messageType: 'text' | 'status',
  metadata: Record<string, unknown>,
  workspaceId: number,
): void {
  const db = getDatabase()
  const insert = db
    .prepare(
      `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(conversationId, fromAgent, null, content, messageType, JSON.stringify(metadata), workspaceId)

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(insert.lastInsertRowid, workspaceId) as Message

  eventBus.broadcast('chat.message', { ...row, metadata })
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const url = new URL(request.url)
  const conversationId = url.searchParams.get('conv')
  const agent = (url.searchParams.get('agent') || 'agent').toLowerCase()
  if (!conversationId) return NextResponse.json({ error: 'missing conv' }, { status: 400 })

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const status = String(payload.status || '').toLowerCase()
  const workspaceId = auth.user.workspace_id ?? 1
  const dispatchId = (payload.dispatch_id as string | number | undefined) ?? null

  try {
    if (status === 'done') {
      const text = String(payload.outcome || '').trim() || 'Done — no textual output was returned.'
      const costNum = typeof payload.cost_usd === 'number' ? payload.cost_usd : null
      const costSuffix = costNum != null ? ` _($${costNum.toFixed(2)})_` : ''
      writeReply(
        conversationId,
        agent,
        text + costSuffix,
        'text',
        { status: 'completed', costUsd: costNum, dispatchId },
        workspaceId,
      )
    } else if (status === 'failed') {
      writeReply(
        conversationId,
        agent,
        `❌ The run failed: ${String(payload.error || 'unknown error')}`,
        'status',
        { status: 'error', dispatchId },
        workspaceId,
      )
    } else if (status === 'rejected') {
      writeReply(
        conversationId,
        agent,
        '🔴 The run was rejected in Slack approval.',
        'status',
        { status: 'rejected', dispatchId },
        workspaceId,
      )
    } else if (status === 'in_progress' || status === 'running') {
      // Progress ping — stay quiet to avoid thread noise; just ack.
    } else {
      return NextResponse.json({ error: `unknown status '${status}'` }, { status: 400 })
    }
  } catch (err) {
    logger.error({ conversationId, err: String(err) }, 'chat dispatch callback: write failed')
    return NextResponse.json({ error: 'callback failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status })
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}
