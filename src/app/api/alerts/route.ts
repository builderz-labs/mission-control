import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { createAlertSchema } from '@/lib/validation'
import { evaluateAllRules } from '@/lib/alert-evaluate'

interface AlertRule {
  id: number
  name: string
  description: string | null
  enabled: number
  entity_type: string
  condition_field: string
  condition_operator: string
  condition_value: string
  action_type: string
  action_config: string
  cooldown_minutes: number
  last_triggered_at: number | null
  trigger_count: number
  created_by: string
  created_at: number
  updated_at: number
  workspace_id: number
}

/**
 * GET /api/alerts - List all alert rules
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  try {
    const rules = db
      .prepare('SELECT * FROM alert_rules WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(workspaceId) as AlertRule[]
    return NextResponse.json({ rules })
  } catch {
    return NextResponse.json({ rules: [] })
  }
}

/**
 * POST /api/alerts - Create a new alert rule or evaluate rules
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  // Check for evaluate action first (peek at body without consuming)
  let rawBody: any
  try { rawBody = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (rawBody.action === 'evaluate') {
    return NextResponse.json(evaluateAllRules(db, workspaceId))
  }

  // Validate for create using schema
  const parseResult = createAlertSchema.safeParse(rawBody)
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: 'Validation failed', details: messages }, { status: 400 })
  }

  // Create new rule
  const { name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes } = parseResult.data

  try {
    const result = db.prepare(`
      INSERT INTO alert_rules (name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes, created_by, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      description || null,
      entity_type,
      condition_field,
      condition_operator,
      condition_value,
      action_type || 'notification',
      JSON.stringify(action_config || {}),
      cooldown_minutes || 60,
      auth.user?.username || 'system',
      workspaceId
    )

    // Audit log
    try {
      db.prepare('INSERT INTO audit_log (action, actor, detail, workspace_id) VALUES (?, ?, ?, ?)').run(
        'alert_rule_created',
        auth.user?.username || 'system',
        `Created alert rule: ${name}`,
        workspaceId
      )
    } catch { /* audit table might not exist */ }

    const rule = db
      .prepare('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?')
      .get(result.lastInsertRowid, workspaceId) as AlertRule
    return NextResponse.json({ rule }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create rule' }, { status: 500 })
  }
}

/**
 * PUT /api/alerts - Update an alert rule
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existing = db
    .prepare('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId) as AlertRule | undefined
  if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  const allowed = ['name', 'description', 'enabled', 'entity_type', 'condition_field', 'condition_operator', 'condition_value', 'action_type', 'action_config', 'cooldown_minutes']
  const sets: string[] = []
  const values: any[] = []

  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = ?`)
      values.push(key === 'action_config' ? JSON.stringify(updates[key]) : updates[key])
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })

  sets.push('updated_at = (unixepoch())')
  values.push(id, workspaceId)

  db.prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`).run(...values)

  const updated = db
    .prepare('SELECT * FROM alert_rules WHERE id = ? AND workspace_id = ?')
    .get(id, workspaceId) as AlertRule
  return NextResponse.json({ rule: updated })
}

/**
 * DELETE /api/alerts - Delete an alert rule
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const result = db.prepare('DELETE FROM alert_rules WHERE id = ? AND workspace_id = ?').run(id, workspaceId)

  try {
    db.prepare('INSERT INTO audit_log (action, actor, detail, workspace_id) VALUES (?, ?, ?, ?)').run(
      'alert_rule_deleted',
      auth.user?.username || 'system',
      `Deleted alert rule #${id}`,
      workspaceId
    )
  } catch { /* audit table might not exist */ }

  return NextResponse.json({ deleted: result.changes > 0 })
}

