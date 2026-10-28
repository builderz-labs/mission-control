import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { validateBody } from '@/lib/validation'
import { markRead, normalizeThreadId } from '@/lib/a2a'
import { A2AError, resolveInboxAgent } from '@/lib/a2a-service'

const readSchema = z.object({
  agent: z.string().trim().max(100).optional(),
  ids: z.array(z.number().int().positive()).max(500).optional(),
  thread_id: z.string().trim().max(80).optional(),
})

/**
 * POST /api/a2a/messages/read — mark inbox messages read.
 * Body: { agent?, ids?, thread_id? } — with neither ids nor thread_id, marks the whole inbox.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const result = await validateBody(request, readSchema)
  if ('error' in result) return result.error
  const body = result.data

  try {
    const agent = resolveInboxAgent(auth.user, body.agent)
    let threadId: string | undefined
    if (body.thread_id) {
      const normalized = normalizeThreadId(body.thread_id)
      if (!normalized) return NextResponse.json({ error: 'Invalid thread id' }, { status: 400 })
      threadId = normalized
    }
    const updated = markRead(getDatabase(), auth.user.workspace_id ?? 1, agent, { ids: body.ids, threadId })
    return NextResponse.json({ agent, updated })
  } catch (err) {
    if (err instanceof A2AError) return NextResponse.json({ error: err.message }, { status: err.status })
    logger.error({ err }, 'Failed to mark A2A messages read')
    return NextResponse.json({ error: 'Failed to mark messages read' }, { status: 500 })
  }
}
