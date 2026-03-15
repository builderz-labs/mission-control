import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createWorkflowRun } from '@/lib/workflow-engine'

interface WorkflowRunRow {
  id: number
  template_id: number
  status: string
  current_phase_id: number | null
  input_data: string | null
  started_at: number | null
  completed_at: number | null
  workspace_id: number
  created_by: string
  created_at: number
  updated_at: number
}

interface RunWithTemplateName extends WorkflowRunRow {
  template_name: string
}

const startRunSchema = z.object({
  template_id: z.number().int().positive('Template ID is required'),
  input_data: z.record(z.string(), z.unknown()).optional(),
})

/**
 * GET /api/workflows/runs - List workflow runs, workspace scoped, with optional status filter
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200)
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10), 0)

    let query = `
      SELECT r.*, wt.name as template_name
      FROM workflow_runs r
      JOIN workflow_templates wt ON wt.id = r.template_id
      WHERE r.workspace_id = ?
    `
    const params: unknown[] = [workspaceId]

    if (statusFilter) {
      const validStatuses = ['pending', 'running', 'paused', 'completed', 'failed']
      if (!validStatuses.includes(statusFilter)) {
        return NextResponse.json({ error: `Invalid status filter. Valid: ${validStatuses.join(', ')}` }, { status: 400 })
      }
      query += ' AND r.status = ?'
      params.push(statusFilter)
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const runs = db.prepare(query).all(...params) as RunWithTemplateName[]

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as count FROM workflow_runs WHERE workspace_id = ?'
    const countParams: unknown[] = [workspaceId]
    if (statusFilter) {
      countQuery += ' AND status = ?'
      countParams.push(statusFilter)
    }
    const { count } = db.prepare(countQuery).get(...countParams) as { count: number }

    return NextResponse.json({
      runs: runs.map(r => ({
        ...r,
        input_data: r.input_data ? JSON.parse(r.input_data) : null,
      })),
      total: count,
      limit,
      offset,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workflows/runs error')
    return NextResponse.json({ error: 'Failed to fetch runs' }, { status: 500 })
  }
}

/**
 * POST /api/workflows/runs - Start a new workflow run from template
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, startRunSchema)
    if ('error' in result) return result.error
    const { template_id, input_data } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const username = auth.user.username || 'system'

    // Verify template exists and belongs to workspace
    const template = db
      .prepare('SELECT id, name FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(template_id, workspaceId) as { id: number; name: string } | undefined
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // Check template has phases
    const phaseCount = db
      .prepare('SELECT COUNT(*) as count FROM workflow_phases WHERE template_id = ?')
      .get(template_id) as { count: number }
    if (phaseCount.count === 0) {
      return NextResponse.json({ error: 'Template has no phases defined' }, { status: 400 })
    }

    const inputDataStr = input_data ? JSON.stringify(input_data) : null
    const { runId } = createWorkflowRun(db, template_id, inputDataStr, username, workspaceId)

    return NextResponse.json({
      runId,
      status: 'running',
      template_name: template.name,
    }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start workflow run'
    logger.error({ err: error }, 'POST /api/workflows/runs error')
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
