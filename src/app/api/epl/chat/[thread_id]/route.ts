import { NextRequest, NextResponse } from 'next/server'
import { readCockpit } from '@/lib/atlas-cockpit'
import { cockpitChatEnabled } from '@/lib/cockpit-flags'

/**
 * GET /api/epl/chat/[thread_id]
 *
 * Phase-2 chat poll. After POST /api/epl/chat returns 202, the client polls this
 * (≥3s interval, with a hard per-turn timeout on the client) for the agent's
 * reply + per-turn cost. There is intentionally NO WebSocket/SSE fan-out — plain
 * request/response polling keeps the box load bounded (the 23 Jun crash-loop
 * lesson).
 *
 * Source of truth = the Atlas cockpit export (mc_cockpit.json conversations[]),
 * keyed by thread_id. MC stays READ-ONLY on Atlas state — it never writes the
 * turn, just renders what Atlas has produced so far. Unknown thread → 'pending'
 * (the turn may not have been flushed to the export yet), never a 500.
 *
 * 🔒 GATED: COCKPIT_CHAT_ENABLED (default OFF) → 404 when off.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ thread_id: string }> }
) {
  if (!cockpitChatEnabled()) {
    return NextResponse.json({ error: 'Chat surface disabled' }, { status: 404 })
  }

  const threadId = (await params).thread_id
  if (!threadId || typeof threadId !== 'string') {
    return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 })
  }

  const cockpit = await readCockpit()
  const conv = cockpit.conversations.find((c) => c.id === threadId)

  if (!conv) {
    // Not in the export yet — Atlas hasn't flushed this turn. Tell the client to
    // keep polling rather than failing.
    return NextResponse.json({
      thread_id: threadId,
      status: 'pending',
      source: cockpit.source,
    })
  }

  // If a turn triggered an action it parks in the approvals inbox — surface that
  // honestly so the UI routes the user to Panel 5 instead of waiting forever.
  const status = conv.awaiting_approval ? 'awaiting_approval' : conv.status || 'done'

  return NextResponse.json({
    thread_id: threadId,
    status,
    agent: conv.agent,
    reply: conv.reply ?? null,
    cost_usd: conv.cost_usd,
    turns: conv.turns,
    last_ts: conv.last_ts,
    awaiting_approval: conv.awaiting_approval === true,
    source: cockpit.source,
  })
}
