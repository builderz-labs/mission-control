import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { getExecutionSnapshotForAgent, OpenClawRuntimeError } from '@/lib/openclaw-runtime'
import { logger } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dispatchId: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const resolvedParams = await params
  const dispatchId = Number.parseInt(resolvedParams.dispatchId, 10)
  if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
    return NextResponse.json({ error: 'Invalid dispatch ID' }, { status: 400 })
  }

  const agentId = (request.headers.get('x-agent-id') || request.nextUrl.searchParams.get('agent_id') || '').trim()
  const runtimeSessionId = (request.headers.get('x-runtime-session-id') || request.nextUrl.searchParams.get('runtime_session_id') || '').trim()

  if (!agentId || !runtimeSessionId) {
    return NextResponse.json(
      { error: 'agent_id and runtime_session_id are required' },
      { status: 400 },
    )
  }

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const snapshot = getExecutionSnapshotForAgent(db, {
      dispatchId,
      agentId,
      runtimeSessionId,
      workspaceId,
    })

    return NextResponse.json({ ok: true, data: snapshot })
  } catch (error) {
    if (error instanceof OpenClawRuntimeError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status },
      )
    }

    logger.error({ err: error, dispatchId }, 'GET /api/runtime/openclaw/execution-tasks/[dispatchId] error')
    return NextResponse.json({ error: 'Failed to fetch execution snapshot' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
