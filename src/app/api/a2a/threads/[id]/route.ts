import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getThread, normalizeThreadId } from '@/lib/a2a'

/**
 * GET /api/a2a/threads/{id} — all messages in a thread, oldest first.
 * `id` may be the full `a2a:<id>` or the bare id. Agent-scoped keys can only
 * read threads they take part in.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const threadId = normalizeThreadId(decodeURIComponent((await params).id))
    if (!threadId) return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const messages = getThread(getDatabase(), auth.user.workspace_id ?? 1, threadId,
      parseInt(searchParams.get('limit') || '0', 10) || undefined)

    if (auth.user.agent_id) {
      const own = (auth.user.agent_name || auth.user.display_name).toLowerCase()
      const participant = messages.some((m) => m.from.toLowerCase() === own || m.to.toLowerCase() === own)
      if (!participant) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
    }
    if (messages.length === 0) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    return NextResponse.json({ thread_id: threadId, messages })
  } catch (err) {
    logger.error({ err }, 'Failed to load A2A thread')
    return NextResponse.json({ error: 'Failed to load thread' }, { status: 500 })
  }
}
