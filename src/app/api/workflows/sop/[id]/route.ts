import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getWorkflowArtifacts, getWorkflowRoleStates } from '@/lib/sop-engine'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const resolvedParams = await params
  const runId = resolvedParams.id

  try {
    const artifacts = getWorkflowArtifacts(runId)
    const roleStates = getWorkflowRoleStates(runId)

    if (artifacts.length === 0 && roleStates.length === 0) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    }

    return NextResponse.json({
      runId,
      artifacts,
      roleStates,
    })
  } catch (err) {
    logger.error({ err, runId }, 'GET /api/workflows/sop/[id] error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
