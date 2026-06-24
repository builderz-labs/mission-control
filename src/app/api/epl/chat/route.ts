import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import { cockpitChatEnabled } from '@/lib/cockpit-flags'

/**
 * POST /api/epl/chat  { agent, thread_id?, message }
 *
 * Phase-2 conversational dispatch. MC forwards a chat turn to Atlas's existing
 * dispatch bridge (POST {dispatchUrl}/dispatch with a thread_id + the message),
 * which runs the agent threaded and returns 202 accepted (async). The client
 * then POLLS GET /api/epl/chat/[thread_id] for the reply + per-turn cost.
 *
 * 🔒 GATED: COCKPIT_CHAT_ENABLED (default OFF) → 404 when off. The interactive
 * polling chat is the closest thing to the always-on load that crash-looped the
 * box on 23 Jun, so it ships INERT and is armed later under supervision.
 *
 * Safety: read-only Q&A runs ungated through Atlas; Atlas keeps its approval
 * gate for any ACTION-triggering turn (it drops into the approvals inbox) and
 * its cost cap + destructive-op protection still apply. MC adds nothing that
 * bypasses those — it just relays the turn.
 */
export async function POST(request: NextRequest) {
  if (!cockpitChatEnabled()) {
    return NextResponse.json({ error: 'Chat surface disabled' }, { status: 404 })
  }

  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  if (!config.atlas.dispatchUrl || !config.atlas.dispatchKey) {
    return NextResponse.json(
      { error: 'Dispatch not configured — set ATLAS_DISPATCH_URL and ATLAS_DISPATCH_KEY' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => ({} as any))
  const agent = String(body?.agent || '').trim().toLowerCase()
  const message = String(body?.message || '').trim()
  // Reuse an existing thread, or mint one so the first turn is threadable too.
  const threadId =
    typeof body?.thread_id === 'string' && body.thread_id.trim()
      ? body.thread_id.trim()
      : `chat-${randomUUID()}`

  if (!agent) return NextResponse.json({ error: 'agent is required' }, { status: 400 })
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (message.length > 8000) {
    return NextResponse.json({ error: 'message too long (max 8000 chars)' }, { status: 400 })
  }

  const requestedBy = auth.user.username || auth.user.email || 'mc'

  let atlasRes: Response
  try {
    atlasRes = await fetch(`${config.atlas.dispatchUrl.replace(/\/$/, '')}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dispatch-Key': config.atlas.dispatchKey },
      body: JSON.stringify({
        agent,
        thread_id: threadId,
        prompt: message,
        mode: 'chat',
        requested_by: requestedBy,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    logger.error({ threadId, err: String(err) }, 'chat: Atlas dispatch unreachable')
    return NextResponse.json(
      { error: 'Atlas dispatch service unreachable', detail: String(err) },
      { status: 502 }
    )
  }

  const atlasBody = await atlasRes.json().catch(() => ({}))
  if (!atlasRes.ok) {
    logger.warn({ threadId, status: atlasRes.status, atlasBody }, 'chat: Atlas rejected turn')
    return NextResponse.json(
      { ok: false, error: atlasBody.error || 'Atlas rejected the chat turn', atlasStatus: atlasRes.status },
      { status: atlasRes.status }
    )
  }

  logger.info({ threadId, agent }, 'chat: turn dispatched to Atlas')
  // 202 accepted — async. Client polls GET /api/epl/chat/[thread_id].
  return NextResponse.json(
    { ok: true, thread_id: threadId, agent, status: 'accepted', ...atlasBody },
    { status: 202 }
  )
}
