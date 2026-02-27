import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'
import { createAlertSchema } from '@/lib/validation'

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
}

/**
 * GET /api/alerts - List all alert rules
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  try {
    const rules = db.prepare('SELECT * FROM alert_rules ORDER BY created_at DESC').all() as AlertRule[]
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
  const body = await request.json()

  // Evaluate all enabled rules
  if (body.action === 'evaluate') {
    return evaluateRules(db)
  }

  // Validate for create
  const parseResult = createAlertSchema.safeParse(body)
  if (!parseResult.success) {
    const messages = parseResult.error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`)
    return NextResponse.json({ error: 'Validation failed', details: messages }, { status: 400 })
  }

  // Create new rule
  const { name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes } = parseResult.data

  try {
    const result = db.prepare(`
      INSERT INTO alert_rules (name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      auth.user?.username || 'system'
    )

    // Audit log
    try {
      db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run(
        'alert_rule_created',
        auth.user?.username || 'system',
        `Created alert rule: ${name}`
      )
    } catch { /* audit table might not exist */ }

    const rule = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(result.lastInsertRowid) as AlertRule
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
  const body = await request.json()
  const { id, ...updates } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const existing = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRule | undefined
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
  values.push(id)

  db.prepare(`UPDATE alert_rules SET ${sets.join(', ')} WHERE id = ?`).run(...values)

  const updated = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(id) as AlertRule
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
  const body = await request.json()
  const { id } = body

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const result = db.prepare('DELETE FROM alert_rules WHERE id = ?').run(id)

  try {
    db.prepare('INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)').run(
      'alert_rule_deleted',
      auth.user?.username || 'system',
      `Deleted alert rule #${id}`
    )
  } catch { /* audit table might not exist */ }

  return NextResponse.json({ deleted: result.changes > 0 })
}

/**
 * Evaluate all enabled alert rules against current data
 */
function evaluateRules(db: ReturnType<typeof getDatabase>) {
  let rules: AlertRule[]
  try {
    rules = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1').all() as AlertRule[]
  } catch {
    return NextResponse.json({ evaluated: 0, triggered: 0, results: [] })
  }

  const now = Math.floor(Date.now() / 1000)
  const results: { rule_id: number; rule_name: string; triggered: boolean; reason?: string }[] = []

  for (const rule of rules) {
    // Check cooldown
    if (rule.last_triggered_at && (now - rule.last_triggered_at) < rule.cooldown_minutes * 60) {
      results.push({ rule_id: rule.id, rule_name: rule.name, triggered: false, reason: 'In cooldown' })
      continue
    }

    const triggered = evaluateRule(db, rule, now)
    results.push({ rule_id: rule.id, rule_name: rule.name, triggered, reason: triggered ? 'Condition met' : 'Condition not met' })

    if (triggered) {
      // Update trigger tracking
      db.prepare('UPDATE alert_rules SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ?').run(now, rule.id)

      // Create notification
      try {
        const config = JSON.parse(rule.action_config || '{}')
        const recipient = config.recipient || 'system'
        db.prepare(`
          INSERT INTO notifications (recipient, type, title, message, source_type, source_id)
          VALUES (?, 'alert', ?, ?, 'alert_rule', ?)
        `).run(recipient, `Alert: ${rule.name}`, rule.description || `Rule "${rule.name}" triggered`, rule.id)
      } catch { /* notification creation failed */ }
    }
  }

  const triggered = results.filter(r => r.triggered).length
  return NextResponse.json({ evaluated: rules.length, triggered, results })
}

function evaluateRule(db: ReturnType<typeof getDatabase>, rule: AlertRule, now: number): boolean {
  try {
    switch (rule.entity_type) {
      case 'agent': return evaluateAgentRule(db, rule, now)
      case 'task': return evaluateTaskRule(db, rule, now)
      case 'session': return evaluateSessionRule(db, rule, now)
      case 'activity': return evaluateActivityRule(db, rule, now)
      default: return false
    }
  } catch {
    return false
  }
}

function evaluateAgentRule(db: ReturnType<typeof getDatabase>, rule: AlertRule, now: number): boolean {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'count_above' || condition_operator === 'count_below') {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM agents WHERE ${safeColumn('agents', condition_field)} = ?`).get(condition_value) as any)?.c || 0
    return condition_operator === 'count_above' ? count > parseInt(condition_value) : count < parseInt(condition_value)
  }

  if (condition_operator === 'age_minutes_above') {
    // Check agents where field value is older than N minutes (e.g., last_seen)
    const threshold = now - parseInt(condition_value) * 60
    const count = (db.prepare(`SELECT COUNT(*) as c FROM agents WHERE status != 'offline' AND ${safeColumn('agents', condition_field)} < ?`).get(threshold) as any)?.c || 0
    return count > 0
  }

  const agents = db.prepare(`SELECT ${safeColumn('agents', condition_field)} as val FROM agents WHERE status != 'offline'`).all() as any[]
  return agents.some(a => compareValue(a.val, condition_operator, condition_value))
}

function evaluateTaskRule(db: ReturnType<typeof getDatabase>, rule: AlertRule, _now: number): boolean {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'count_above') {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE ${safeColumn('tasks', condition_field)} = ?`).get(condition_value) as any)?.c || 0
    return count > parseInt(condition_value)
  }

  if (condition_operator === 'count_below') {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM tasks`).get() as any)?.c || 0
    return count < parseInt(condition_value)
  }

  const tasks = db.prepare(`SELECT ${safeColumn('tasks', condition_field)} as val FROM tasks`).all() as any[]
  return tasks.some(t => compareValue(t.val, condition_operator, condition_value))
}

function evaluateSessionRule(db: ReturnType<typeof getDatabase>, rule: AlertRule, _now: number): boolean {
  // Session data comes from the gateway, not the DB, so we check the agents table for session info
  const { condition_operator, condition_value } = rule

  if (condition_operator === 'count_above') {
    const count = (db.prepare(`SELECT COUNT(*) as c FROM agents WHERE status = 'busy'`).get() as any)?.c || 0
    return count > parseInt(condition_value)
  }

  return false
}

function evaluateActivityRule(db: ReturnType<typeof getDatabase>, rule: AlertRule, now: number): boolean {
  const { condition_field, condition_operator, condition_value } = rule

  if (condition_operator === 'count_above') {
    // Count activities in the last hour
    const hourAgo = now - 3600
    const count = (db.prepare(`SELECT COUNT(*) as c FROM activities WHERE created_at > ? AND ${safeColumn('activities', condition_field)} = ?`).get(hourAgo, condition_value) as any)?.c || 0
    return count > parseInt(condition_value)
  }

  return false
}

function compareValue(actual: any, operator: string, expected: string): boolean {
  if (actual == null) return false
  const strActual = String(actual)
  switch (operator) {
    case 'equals': return strActual === expected
    case 'not_equals': return strActual !== expected
    case 'greater_than': return Number(actual) > Number(expected)
    case 'less_than': return Number(actual) < Number(expected)
    case 'contains': return strActual.toLowerCase().includes(expected.toLowerCase())
    default: return false
  }
}

// Whitelist of columns per table to prevent SQL injection
const SAFE_COLUMNS: Record<string, Set<string>> = {
  agents: new Set(['status', 'role', 'name', 'last_seen', 'last_activity']),
  tasks: new Set(['status', 'priority', 'assigned_to', 'title']),
  activities: new Set(['type', 'actor', 'entity_type']),
}

function safeColumn(table: string, column: string): string {
  if (SAFE_COLUMNS[table]?.has(column)) return column
  return 'id' // fallback to safe column
}
