import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { requireRole } from '@/lib/auth'

export interface PipelineStep {
  template_id: number
  template_name?: string
  on_failure: 'stop' | 'continue'
}

export interface Pipeline {
  id: number
  name: string
  description: string | null
  steps: string // JSON array of PipelineStep
  created_by: string
  created_at: number
  updated_at: number
  use_count: number
  last_used_at: number | null
}

/**
 * GET /api/pipelines - List all pipelines with enriched step data
 */
export async function GET() {
  try {
    const db = getDatabase()
    const pipelines = db.prepare(
      'SELECT * FROM workflow_pipelines ORDER BY use_count DESC, updated_at DESC'
    ).all() as Pipeline[]

    // Enrich steps with template names
    const templates = db.prepare('SELECT id, name FROM workflow_templates').all() as Array<{ id: number; name: string }>
    const nameMap = new Map(templates.map(t => [t.id, t.name]))

    // Get run counts per pipeline
    const runCounts = db.prepare(`
      SELECT pipeline_id, COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running
      FROM pipeline_runs GROUP BY pipeline_id
    `).all() as Array<{ pipeline_id: number; total: number; completed: number; failed: number; running: number }>
    const runMap = new Map(runCounts.map(r => [r.pipeline_id, r]))

    const parsed = pipelines.map(p => {
      const steps: PipelineStep[] = JSON.parse(p.steps || '[]')
      return {
        ...p,
        steps: steps.map(s => ({ ...s, template_name: nameMap.get(s.template_id) || 'Unknown' })),
        runs: runMap.get(p.id) || { total: 0, completed: 0, failed: 0, running: 0 },
      }
    })

    return NextResponse.json({ pipelines: parsed })
  } catch (error) {
    console.error('GET /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to fetch pipelines' }, { status: 500 })
  }
}

/**
 * POST /api/pipelines - Create a pipeline
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const { name, description, steps = [] } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!Array.isArray(steps) || steps.length < 2) {
      return NextResponse.json({ error: 'Pipeline needs at least 2 steps' }, { status: 400 })
    }

    // Validate template IDs exist
    const templateIds = steps.map((s: PipelineStep) => s.template_id)
    const existing = db.prepare(
      `SELECT id FROM workflow_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`
    ).all(...templateIds) as Array<{ id: number }>
    if (existing.length !== new Set(templateIds).size) {
      return NextResponse.json({ error: 'One or more template IDs not found' }, { status: 400 })
    }

    const cleanSteps = steps.map((s: PipelineStep) => ({
      template_id: s.template_id,
      on_failure: s.on_failure || 'stop',
    }))

    const result = db.prepare(`
      INSERT INTO workflow_pipelines (name, description, steps, created_by)
      VALUES (?, ?, ?, ?)
    `).run(name, description || null, JSON.stringify(cleanSteps), auth.user?.username || 'system')

    db_helpers.logActivity('pipeline_created', 'pipeline', Number(result.lastInsertRowid), auth.user?.username || 'system', `Created pipeline: ${name}`)

    const pipeline = db.prepare('SELECT * FROM workflow_pipelines WHERE id = ?').get(result.lastInsertRowid) as Pipeline
    return NextResponse.json({ pipeline: { ...pipeline, steps: JSON.parse(pipeline.steps) } }, { status: 201 })
  } catch (error) {
    console.error('POST /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to create pipeline' }, { status: 500 })
  }
}

/**
 * PUT /api/pipelines - Update a pipeline
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 })

    const existing = db.prepare('SELECT * FROM workflow_pipelines WHERE id = ?').get(id) as Pipeline
    if (!existing) return NextResponse.json({ error: 'Pipeline not found' }, { status: 404 })

    const fields: string[] = []
    const params: any[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description) }
    if (updates.steps !== undefined) {
      fields.push('steps = ?')
      params.push(JSON.stringify(updates.steps))
    }

    if (fields.length === 0) {
      // Usage tracking
      fields.push('use_count = use_count + 1', 'last_used_at = ?')
      params.push(Math.floor(Date.now() / 1000))
    }

    fields.push('updated_at = ?')
    params.push(Math.floor(Date.now() / 1000))
    params.push(id)

    db.prepare(`UPDATE workflow_pipelines SET ${fields.join(', ')} WHERE id = ?`).run(...params)

    const updated = db.prepare('SELECT * FROM workflow_pipelines WHERE id = ?').get(id) as Pipeline
    return NextResponse.json({ pipeline: { ...updated, steps: JSON.parse(updated.steps) } })
  } catch (error) {
    console.error('PUT /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to update pipeline' }, { status: 500 })
  }
}

/**
 * DELETE /api/pipelines - Delete a pipeline
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 })

    db.prepare('DELETE FROM workflow_pipelines WHERE id = ?').run(parseInt(id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/pipelines error:', error)
    return NextResponse.json({ error: 'Failed to delete pipeline' }, { status: 500 })
  }
}
