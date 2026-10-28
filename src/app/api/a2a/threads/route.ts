import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { listThreads } from '@/lib/a2a'

/**
 * GET /api/a2a/threads — A2A conversations, most recently active first.
 * Query: agent (only threads it takes part in), limit.
 * Agent-scoped keys only see their own threads.
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { searchParams } = new URL(request.url)
    const agent = auth.user.agent_id
      ? (auth.user.agent_name || auth.user.display_name)
      : (searchParams.get('agent')?.trim() || undefined)
    const threads = listThreads(getDatabase(), auth.user.workspace_id ?? 1, {
      agent,
      limit: parseInt(searchParams.get('limit') || '50', 10),
    })
    return NextResponse.json({ threads })
  } catch (err) {
    logger.error({ err }, 'Failed to list A2A threads')
    return NextResponse.json({ error: 'Failed to list threads' }, { status: 500 })
  }
}
