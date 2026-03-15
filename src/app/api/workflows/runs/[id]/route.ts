import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getWorkflowRunStatus } from '@/lib/workflow-engine'

/**
 * GET /api/workflows/runs/[id] - Get full run status with phase states
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const runId = parseInt(id, 10)
    if (isNaN(runId)) {
      return NextResponse.json({ error: 'Invalid run ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const result = getWorkflowRunStatus(db, runId)
    if (!result) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    // Verify workspace ownership
    if (result.run.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    }

    // Get template name
    const template = db
      .prepare('SELECT name FROM workflow_templates WHERE id = ?')
      .get(result.run.template_id) as { name: string } | undefined

    return NextResponse.json({
      run: {
        ...result.run,
        template_name: template?.name || 'Unknown',
        input_data: result.run.input_data ? JSON.parse(result.run.input_data) : null,
      },
      phases: result.phases.map(p => ({
        ...p,
        input_artifact: p.input_artifact ? JSON.parse(p.input_artifact) : null,
        output_artifact: p.output_artifact ? JSON.parse(p.output_artifact) : null,
      })),
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workflows/runs/[id] error')
    return NextResponse.json({ error: 'Failed to fetch run status' }, { status: 500 })
  }
}
