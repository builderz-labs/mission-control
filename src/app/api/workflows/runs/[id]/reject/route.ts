import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { rejectPhase } from '@/lib/workflow-engine'

const rejectSchema = z.object({
  phase_run_id: z.number().int().positive('Phase run ID is required'),
  reason: z.string().min(1, 'Rejection reason is required').max(5000),
})

/**
 * POST /api/workflows/runs/[id]/reject - Reject a paused phase
 *
 * Rejects a phase that was paused for approval. The phase transitions
 * to 'rejected' and the entire workflow run transitions to 'failed'.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const runId = parseInt(id, 10)
    if (isNaN(runId)) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 })
    }

    const result = await validateBody(request, rejectSchema)
    if ('error' in result) return result.error
    const { phase_run_id, reason } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify run exists and belongs to workspace
    const run = db
      .prepare('SELECT id, workspace_id FROM workflow_runs WHERE id = ?')
      .get(runId) as { id: number; workspace_id: number } | undefined
    if (!run || run.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const rejectResult = rejectPhase(db, runId, phase_run_id, reason)

    return NextResponse.json({
      status: rejectResult.status,
      reason,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reject phase'
    logger.error({ err: error }, 'POST /api/workflows/runs/[id]/reject error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
