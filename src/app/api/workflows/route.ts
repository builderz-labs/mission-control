import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'

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

/**
 * GET /api/workflows - List all workflow templates
 */
export async function GET() {
  try {
    const db = getDatabase()
    const templates = db.prepare('SELECT * FROM workflow_templates ORDER BY use_count DESC, updated_at DESC').all() as WorkflowTemplate[]

    const parsed = templates.map(t => ({
      ...t,
      tags: t.tags ? JSON.parse(t.tags) : [],
    }))

    return NextResponse.json({ templates: parsed })
  } catch (error) {
    console.error('GET /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

/**
 * POST /api/workflows - Create a new workflow template
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const user = auth.user
    const body = await request.json()

    const { name, description, model = 'sonnet', task_prompt, timeout_seconds = 300, agent_role, tags = [] } = body

    if (!name || !task_prompt) {
      return NextResponse.json({ error: 'Name and task_prompt are required' }, { status: 400 })
    }

    const result = db.prepare(`
      INSERT INTO workflow_templates (name, description, model, task_prompt, timeout_seconds, agent_role, tags, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || null, model, task_prompt, timeout_seconds, agent_role || null, JSON.stringify(tags), user?.username || 'system')

    const template = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(result.lastInsertRowid) as WorkflowTemplate

    db_helpers.logActivity('workflow_created', 'workflow', Number(result.lastInsertRowid), user?.username || 'system', `Created workflow template: ${name}`)

    return NextResponse.json({
      template: { ...template, tags: template.tags ? JSON.parse(template.tags) : [] }
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}

/**
 * PUT /api/workflows - Update a workflow template
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json({ error: 'Template ID is required' }, { status: 400 })
    }

    const existing = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as WorkflowTemplate
    if (!existing) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const fields: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description) }
    if (updates.model !== undefined) { fields.push('model = ?'); params.push(updates.model) }
    if (updates.task_prompt !== undefined) { fields.push('task_prompt = ?'); params.push(updates.task_prompt) }
    if (updates.timeout_seconds !== undefined) { fields.push('timeout_seconds = ?'); params.push(updates.timeout_seconds) }
    if (updates.agent_role !== undefined) { fields.push('agent_role = ?'); params.push(updates.agent_role) }
    if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(JSON.stringify(updates.tags)) }

    // No explicit field updates = usage tracking call (from orchestration bar)
    if (fields.length === 0) {
      fields.push('use_count = use_count + 1')
      fields.push('last_used_at = ?')
      params.push(Math.floor(Date.now() / 1000))
    }

    fields.push('updated_at = ?')
    params.push(Math.floor(Date.now() / 1000))
    params.push(id)

    db.prepare(`UPDATE workflow_templates SET ${fields.join(', ')} WHERE id = ?`).run(...params)

    const updated = db.prepare('SELECT * FROM workflow_templates WHERE id = ?').get(id) as WorkflowTemplate
    return NextResponse.json({ template: { ...updated, tags: updated.tags ? JSON.parse(updated.tags) : [] } })
  } catch (error) {
    console.error('PUT /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

/**
 * DELETE /api/workflows - Delete a workflow template
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    let body: any
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
    const id = body.id

    if (!id) {
      return NextResponse.json({ error: 'Template ID is required' }, { status: 400 })
    }

    db.prepare('DELETE FROM workflow_templates WHERE id = ?').run(parseInt(id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/workflows error:', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
