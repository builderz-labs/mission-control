import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getDatabase, writeTransaction } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

interface WorkflowPhaseRow {
  id: number
  template_id: number
  name: string
  phase_order: number
  agent_role: string | null
  input_schema: string | null
  output_schema: string | null
  requires_approval: number
  description: string | null
}

function formatPhase(p: WorkflowPhaseRow) {
  return {
    ...p,
    requires_approval: p.requires_approval === 1,
    input_schema: p.input_schema ? JSON.parse(p.input_schema) : null,
    output_schema: p.output_schema ? JSON.parse(p.output_schema) : null,
  }
}

const addPhaseSchema = z.object({
  name: z.string().min(1, 'Phase name is required').max(200),
  phase_order: z.number().int().min(0),
  agent_role: z.string().max(100).optional(),
  input_schema: z.unknown().optional(),
  output_schema: z.unknown().optional(),
  requires_approval: z.boolean().default(false),
  description: z.string().max(5000).optional(),
})

const updatePhasesSchema = z.object({
  phases: z.array(z.object({
    id: z.number().int().positive().optional(),
    name: z.string().min(1).max(200),
    phase_order: z.number().int().min(0),
    agent_role: z.string().max(100).optional(),
    input_schema: z.unknown().optional(),
    output_schema: z.unknown().optional(),
    requires_approval: z.boolean().default(false),
    description: z.string().max(5000).optional(),
  })).min(0).max(100),
})

/**
 * GET /api/workflows/[id]/phases - List phases for a template
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { id } = await params
    const templateId = parseInt(id, 10)
    if (isNaN(templateId)) {
      return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 })
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify template exists and belongs to workspace
    const template = db
      .prepare('SELECT id FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(templateId, workspaceId)
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const phases = db
      .prepare('SELECT * FROM workflow_phases WHERE template_id = ? ORDER BY phase_order ASC')
      .all(templateId) as WorkflowPhaseRow[]

    return NextResponse.json({ phases: phases.map(formatPhase) })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workflows/[id]/phases error')
    return NextResponse.json({ error: 'Failed to fetch phases' }, { status: 500 })
  }
}

/**
 * POST /api/workflows/[id]/phases - Add a phase to a template
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
    const templateId = parseInt(id, 10)
    if (isNaN(templateId)) {
      return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 })
    }

    const result = await validateBody(request, addPhaseSchema)
    if ('error' in result) return result.error
    const data = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify template exists and belongs to workspace
    const template = db
      .prepare('SELECT id FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(templateId, workspaceId)
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const insertResult = db.prepare(`
      INSERT INTO workflow_phases (template_id, name, phase_order, agent_role, input_schema, output_schema, requires_approval, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      templateId,
      data.name,
      data.phase_order,
      data.agent_role || null,
      data.input_schema ? JSON.stringify(data.input_schema) : null,
      data.output_schema ? JSON.stringify(data.output_schema) : null,
      data.requires_approval ? 1 : 0,
      data.description || null
    )

    const phase = db
      .prepare('SELECT * FROM workflow_phases WHERE id = ?')
      .get(insertResult.lastInsertRowid) as WorkflowPhaseRow

    return NextResponse.json({ phase: formatPhase(phase) }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/workflows/[id]/phases error')
    return NextResponse.json({ error: 'Failed to add phase' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows/[id]/phases - Reorder/update all phases (delete + re-insert)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { id } = await params
    const templateId = parseInt(id, 10)
    if (isNaN(templateId)) {
      return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 })
    }

    const result = await validateBody(request, updatePhasesSchema)
    if ('error' in result) return result.error
    const { phases } = result.data

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    // Verify template exists and belongs to workspace
    const template = db
      .prepare('SELECT id FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(templateId, workspaceId)
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    writeTransaction(db, (txDb) => {
      // Delete existing phases
      txDb.prepare('DELETE FROM workflow_phases WHERE template_id = ?').run(templateId)

      // Re-insert with new order
      if (phases.length > 0) {
        const insertPhase = txDb.prepare(`
          INSERT INTO workflow_phases (template_id, name, phase_order, agent_role, input_schema, output_schema, requires_approval, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const p of phases) {
          insertPhase.run(
            templateId,
            p.name,
            p.phase_order,
            p.agent_role || null,
            p.input_schema ? JSON.stringify(p.input_schema) : null,
            p.output_schema ? JSON.stringify(p.output_schema) : null,
            p.requires_approval ? 1 : 0,
            p.description || null
          )
        }
      }

      // Update template updated_at
      txDb.prepare('UPDATE workflow_templates SET updated_at = ? WHERE id = ?')
        .run(Math.floor(Date.now() / 1000), templateId)
    })

    const updatedPhases = db
      .prepare('SELECT * FROM workflow_phases WHERE template_id = ? ORDER BY phase_order ASC')
      .all(templateId) as WorkflowPhaseRow[]

    return NextResponse.json({ phases: updatedPhases.map(formatPhase) })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workflows/[id]/phases error')
    return NextResponse.json({ error: 'Failed to update phases' }, { status: 500 })
  }
}
