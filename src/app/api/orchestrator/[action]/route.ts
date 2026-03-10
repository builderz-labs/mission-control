import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { applyOrchestratorAction } from '@/lib/orchestrator-control'
import { logger } from '@/lib/logger'

const ALLOWED_ACTIONS = new Set(['wake', 'start', 'pause', 'stop', 'restart'])

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { action } = await params
    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unknown orchestrator action' }, { status: 404 })
    }

    const result = await applyOrchestratorAction(
      action as 'wake' | 'start' | 'pause' | 'stop' | 'restart',
      auth.user.username
    )

    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error }, 'POST /api/orchestrator/[action] error')
    return NextResponse.json({ error: 'Failed to execute orchestrator action' }, { status: 500 })
  }
}
