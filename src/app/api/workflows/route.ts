import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, writeTransaction, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { validateBody, createWorkflowSchema } from '@/lib/validation'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { scanForInjection } from '@/lib/injection-guard'
import { eventBus } from '@/lib/event-bus'

export interface WorkflowTemplate {
  id: number
  name: string
  description: string | null
  model: string
  task_prompt: string
  timeout_seconds: number
  agent_role: string | null
  tags: string | null
  created_by: string
  created_at: number
  updated_at: number
  last_used_at: number | null
  use_count: number
}

export interface WorkflowPhaseRow {
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

interface PhaseInput {
  name: string
  phase_order: number
  agent_role?: string | null
  input_schema?: string | null
  output_schema?: string | null
  requires_approval?: boolean
  description?: string | null
}

function parseTemplate(t: WorkflowTemplate) {
  return {
    ...t,
    tags: t.tags ? JSON.parse(t.tags) : [],
  }
}

/**
 * GET /api/workflows - List all workflow templates with their phases
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const templates = db
      .prepare('SELECT * FROM workflow_templates WHERE workspace_id = ? ORDER BY use_count DESC, updated_at DESC')
      .all(workspaceId) as WorkflowTemplate[]

    const allPhases = db
      .prepare(`
        SELECT wp.* FROM workflow_phases wp
        INNER JOIN workflow_templates wt ON wt.id = wp.template_id
        WHERE wt.workspace_id = ?
        ORDER BY wp.template_id, wp.phase_order ASC
      `)
      .all(workspaceId) as WorkflowPhaseRow[]

    // Group phases by template_id
    const phasesByTemplate = new Map<number, WorkflowPhaseRow[]>()
    for (const phase of allPhases) {
      const existing = phasesByTemplate.get(phase.template_id)
      if (existing) {
        existing.push(phase)
      } else {
        phasesByTemplate.set(phase.template_id, [phase])
      }
    }

    const parsed = templates.map(t => ({
      ...parseTemplate(t),
      phases: (phasesByTemplate.get(t.id) || []).map(p => ({
        ...p,
        requires_approval: p.requires_approval === 1,
        input_schema: p.input_schema ? JSON.parse(p.input_schema) : null,
        output_schema: p.output_schema ? JSON.parse(p.output_schema) : null,
      })),
    }))

    return NextResponse.json({ templates: parsed })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/workflows error')
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

/**
 * POST /api/workflows - Create a new workflow template with optional phases
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const result = await validateBody(request, createWorkflowSchema)
    if ('error' in result) return result.error
    const { name, description, model, task_prompt, timeout_seconds, agent_role, tags } = result.data
    // Extract phases from body (optional, not in zod schema to keep backward compat)
    const phases: PhaseInput[] | undefined = (result.data as Record<string, unknown>).phases as PhaseInput[] | undefined

    // Scan task_prompt for injection — this gets sent directly to AI agents
    const injectionReport = scanForInjection(task_prompt, { context: 'prompt' })
    if (!injectionReport.safe) {
      const criticals = injectionReport.matches.filter(m => m.severity === 'critical')
      if (criticals.length > 0) {
        logger.warn({ name, rules: criticals.map(m => m.rule) }, 'Blocked workflow: injection detected in task_prompt')
        return NextResponse.json(
          { error: 'Task prompt blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) },
          { status: 422 }
        )
      }
    }

    // Validate phases if provided
    if (phases !== undefined) {
      if (!Array.isArray(phases)) {
        return NextResponse.json({ error: 'phases must be an array' }, { status: 400 })
      }
      for (const p of phases) {
        if (!p.name || typeof p.name !== 'string') {
          return NextResponse.json({ error: 'Each phase requires a name' }, { status: 400 })
        }
        if (typeof p.phase_order !== 'number' || p.phase_order < 0) {
          return NextResponse.json({ error: 'Each phase requires a valid phase_order' }, { status: 400 })
        }
      }
    }

    const db = getDatabase()
    const user = auth.user
    const workspaceId = auth.user.workspace_id ?? 1

    const templateResult = writeTransaction(db, (txDb) => {
      const insertResult = txDb.prepare(`
        INSERT INTO workflow_templates (name, description, model, task_prompt, timeout_seconds, agent_role, tags, created_by, workspace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        description || null,
        model,
        task_prompt,
        timeout_seconds,
        agent_role || null,
        JSON.stringify(tags),
        user?.username || 'system',
        workspaceId
      )

      const templateId = Number(insertResult.lastInsertRowid)

      // Insert phases if provided
      if (phases && phases.length > 0) {
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
            p.input_schema ? (typeof p.input_schema === 'string' ? p.input_schema : JSON.stringify(p.input_schema)) : null,
            p.output_schema ? (typeof p.output_schema === 'string' ? p.output_schema : JSON.stringify(p.output_schema)) : null,
            p.requires_approval ? 1 : 0,
            p.description || null
          )
        }
      }

      return templateId
    })

    const template = db
      .prepare('SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(templateResult, workspaceId) as WorkflowTemplate

    const templatePhases = db
      .prepare('SELECT * FROM workflow_phases WHERE template_id = ? ORDER BY phase_order ASC')
      .all(templateResult) as WorkflowPhaseRow[]

    db_helpers.logActivity(
      'workflow_created',
      'workflow',
      templateResult,
      user?.username || 'system',
      `Created workflow template: ${name}`,
      undefined,
      workspaceId
    )

    eventBus.broadcast('workflow.created', { workflowId: templateResult, name })

    return NextResponse.json({
      template: {
        ...parseTemplate(template),
        phases: templatePhases.map(p => ({
          ...p,
          requires_approval: p.requires_approval === 1,
          input_schema: p.input_schema ? JSON.parse(p.input_schema) : null,
          output_schema: p.output_schema ? JSON.parse(p.output_schema) : null,
        })),
      }
    }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/workflows error')
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows - Update a workflow template (with optional phases replacement)
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const { id, phases, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Template ID is required' }, { status: 400 })
    }

    const existing = db
      .prepare('SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as WorkflowTemplate
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    writeTransaction(db, (txDb) => {
      const fields: string[] = []
      const params: unknown[] = []

      if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name) }
      if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description) }
      if (updates.model !== undefined) { fields.push('model = ?'); params.push(updates.model) }
      if (updates.task_prompt !== undefined) { fields.push('task_prompt = ?'); params.push(updates.task_prompt) }
      if (updates.timeout_seconds !== undefined) { fields.push('timeout_seconds = ?'); params.push(updates.timeout_seconds) }
      if (updates.agent_role !== undefined) { fields.push('agent_role = ?'); params.push(updates.agent_role) }
      if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)) }

      // No explicit field updates and no phases = usage tracking call (from orchestration bar)
      if (fields.length === 0 && !phases) {
        fields.push('use_count = use_count + 1')
        fields.push('last_used_at = ?')
        params.push(Math.floor(Date.now() / 1000))
      }

      fields.push('updated_at = ?')
      params.push(Math.floor(Date.now() / 1000))
      params.push(id, workspaceId)

      txDb.prepare(`UPDATE workflow_templates SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...params)

      // Replace phases if provided (delete + re-insert)
      if (Array.isArray(phases)) {
        txDb.prepare('DELETE FROM workflow_phases WHERE template_id = ?').run(id)

        if (phases.length > 0) {
          const insertPhase = txDb.prepare(`
            INSERT INTO workflow_phases (template_id, name, phase_order, agent_role, input_schema, output_schema, requires_approval, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const p of phases) {
            insertPhase.run(
              id,
              p.name,
              p.phase_order,
              p.agent_role || null,
              p.input_schema ? (typeof p.input_schema === 'string' ? p.input_schema : JSON.stringify(p.input_schema)) : null,
              p.output_schema ? (typeof p.output_schema === 'string' ? p.output_schema : JSON.stringify(p.output_schema)) : null,
              p.requires_approval ? 1 : 0,
              p.description || null
            )
          }
        }
      }
    })

    const updated = db
      .prepare('SELECT * FROM workflow_templates WHERE id = ? AND workspace_id = ?')
      .get(id, workspaceId) as WorkflowTemplate

    const updatedPhases = db
      .prepare('SELECT * FROM workflow_phases WHERE template_id = ? ORDER BY phase_order ASC')
      .all(id) as WorkflowPhaseRow[]

    return NextResponse.json({
      template: {
        ...parseTemplate(updated),
        phases: updatedPhases.map(p => ({
          ...p,
          requires_approval: p.requires_approval === 1,
          input_schema: p.input_schema ? JSON.parse(p.input_schema) : null,
          output_schema: p.output_schema ? JSON.parse(p.output_schema) : null,
        })),
      }
    })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/workflows error')
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows - Delete a workflow template
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id

    if (!id) {
      return NextResponse.json({ error: 'Template ID is required' }, { status: 400 })
    }

    const result = db.prepare('DELETE FROM workflow_templates WHERE id = ? AND workspace_id = ?').run(parseInt(String(id)), workspaceId)
    if (result.changes === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/workflows error')
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
