import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { completePhase, advanceWorkflow } from '@/lib/workflow-engine'

const advanceSchema = z.object({
  phase_run_id: z.number().int().positive('Phase run ID is required'),
  output: z.unknown(),
})

/**
 * POST /api/workflows/runs/[id]/advance - Submit phase output and advance workflow
 *
 * Completes the current phase with output data, then advances to the next phase.
 * If the next phase requires approval, the run pauses.
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

    const result = await validateBody(request, advanceSchema)
    if ('error' in result) return result.error
    const { phase_run_id, output } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify run exists and belongs to workspace
    const run = db
      .prepare('SELECT id, workspace_id FROM workflow_runs WHERE id = ?')
      .get(runId) as { id: number; workspace_id: number } | undefined
    if (!run || run.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    const outputStr = output !== undefined ? JSON.stringify(output) : '{}'

    // Complete the current phase
    const completeResult = completePhase(db, runId, phase_run_id, outputStr)
    if (completeResult.status === 'validation_error') {
      return NextResponse.json({
        error: 'Phase output validation failed',
        validationError: completeResult.validationError,
      }, { status: 422 })
    }

    // Advance to the next phase
    const advanceResult = advanceWorkflow(db, runId)

    return NextResponse.json({
      status: advanceResult.status,
      nextPhase: advanceResult.nextPhase || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to advance workflow'
    logger.error({ err: error }, 'POST /api/workflows/runs/[id]/advance error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
