import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getRunProvenance } from '@/lib/runs'
import { logger } from '@/lib/logger'

/**
 * GET /api/v1/runs/:run_id/provenance — Get the provenance record for a run.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> },
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { run_id } = await params
    const workspaceId = auth.user.workspace_id ?? 1
    const provenance = getRunProvenance(run_id, workspaceId)

    if (!provenance) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

    return NextResponse.json(provenance, {
      headers: { 'X-Agent-Run-Protocol': '0.1.0' },
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to get provenance')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
