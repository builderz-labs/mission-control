import type Database from 'better-sqlite3'
import { FLEET_AGENT_NAMES } from '@/lib/fleet-agents'

export interface AlertRule {
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
  workspace_id: number
}

const SAFE_COLUMNS: Record<string, Set<string>> = {
  agents: new Set(['status', 'role', 'name', 'last_seen', 'last_activity']),
  tasks: new Set(['status', 'priority', 'assigned_to', 'title']),
  activities: new Set(['type', 'actor', 'entity_type']),
}

function safeColumn(table: string, column: string): string {
  if (SAFE_COLUMNS[table]?.has(column)) return column
  return 'id'
}

function countThreshold(value: string): { match: string | null; threshold: number } {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return { match: null, threshold: numeric }
  return { match: value, threshold: 0 }
}

export function seedFleetOfflineAlerts(db: Database.Database, workspaceId: number): number {
  const existing = db.prepare('SELECT name FROM alert_rules WHERE workspace_id = ?').all(workspaceId) as Array<{ name: string }>
  const names = new Set(existing.map((row) => row.name))
  let created = 0
  const insert = db.prepare(`
    INSERT INTO alert_rules (name, description, entity_type, condition_field, condition_operator, condition_value, action_type, action_config, cooldown_minutes, created_by, workspace_id)
    VALUES (?, ?, 'agent', 'name', 'agent_offline', ?, 'notification', ?, 60, 'system', ?)
  `)
  for (const agent of FLEET_AGENT_NAMES) {
    const ruleName = `${agent}-offline`
    if (names.has(ruleName)) continue
    insert.run(
      ruleName,
      `Notify when ${agent} is offline or last_seen is older than 30 minutes`,
      agent,
      JSON.stringify({ recipient: 'system' }),
      workspaceId,
    )
    created++
  }
  return created
}

export function evaluateAllRules(db: Database.Database, workspaceId: number): {
  evaluated: number
  triggered: number
  seeded: number
  results: Array<{ rule_id: number; rule_name: string; triggered: boolean; reason?: string }>
} {
  const seeded = seedFleetOfflineAlerts(db, workspaceId)
  let rules: AlertRule[]
  try {
    rules = db.prepare('SELECT * FROM alert_rules WHERE enabled = 1 AND workspace_id = ?').all(workspaceId) as AlertRule[]
  } catch {
    return { evaluated: 0, triggered: 0, seeded, results: [] }
  }

  const now = Math.floor(Date.now() / 1000)
  const results: Array<{ rule_id: number; rule_name: string; triggered: boolean; reason?: string }> = []

  for (const rule of rules) {
    if (rule.last_triggered_at && (now - rule.last_triggered_at) < rule.cooldown_minutes * 60) {
      results.push({ rule_id: rule.id, rule_name: rule.name, triggered: false, reason: 'In cooldown' })
      continue
    }
    const triggered = evaluateRule(db, rule, now, workspaceId)
    results.push({
      rule_id: rule.id,
      rule_name: rule.name,
      triggered,
      reason: triggered ? 'Condition met' : 'Condition not met',
    })
    if (!triggered) continue
    db.prepare('UPDATE alert_rules SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ? AND workspace_id = ?')
      .run(now, rule.id, workspaceId)
    try {
      const config = JSON.parse(rule.action_config || '{}') as { recipient?: string }
      db.prepare(`
        INSERT INTO notifications (recipient, type, title, message, source_type, source_id, workspace_id)
        VALUES (?, 'alert', ?, ?, 'alert_rule', ?, ?)
      `).run(config.recipient || 'system', `Alert: ${rule.name}`, rule.description || `Rule "${rule.name}" triggered`, rule.id, workspaceId)
    } catch { /* notification insert is best-effort */ }
  }

  return { evaluated: rules.length, triggered: results.filter((row) => row.triggered).length, seeded, results }
}

function evaluateRule(db: Database.Database, rule: AlertRule, now: number, workspaceId: number): boolean {
  try {
    if (rule.entity_type === 'agent') return evaluateAgentRule(db, rule, now, workspaceId)
    if (rule.entity_type === 'task') return evaluateCountRule(db, 'tasks', rule, workspaceId)
    if (rule.entity_type === 'activity') return evaluateCountRule(db, 'activities', rule, workspaceId, now)
    if (rule.entity_type === 'session') {
      const count = (db.prepare("SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND status = 'busy'").get(workspaceId) as { c: number })?.c || 0
      const { threshold } = countThreshold(rule.condition_value)
      return rule.condition_operator === 'count_above' ? count > threshold : false
    }
    return false
  } catch {
    return false
  }
}

function evaluateAgentRule(db: Database.Database, rule: AlertRule, now: number, workspaceId: number): boolean {
  const { condition_field, condition_operator, condition_value } = rule
  if (condition_operator === 'agent_offline') {
    const row = db.prepare('SELECT status, last_seen FROM agents WHERE workspace_id = ? AND name = ?')
      .get(workspaceId, condition_value) as { status?: string; last_seen?: number } | undefined
    if (!row) return false
    if (row.status === 'offline') return true
    return !row.last_seen || row.last_seen < now - 30 * 60
  }
  if (condition_operator === 'count_above' || condition_operator === 'count_below') {
    const { match, threshold } = countThreshold(condition_value)
    const count = match
      ? (db.prepare(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND ${safeColumn('agents', condition_field)} = ?`).get(workspaceId, match) as { c: number })?.c || 0
      : (db.prepare('SELECT COUNT(*) as c FROM agents WHERE workspace_id = ?').get(workspaceId) as { c: number })?.c || 0
    return condition_operator === 'count_above' ? count > threshold : count < threshold
  }
  if (condition_operator === 'age_minutes_above') {
    const minutes = parseInt(condition_value, 10)
    if (!Number.isFinite(minutes)) return false
    const threshold = now - minutes * 60
    const count = (db.prepare(`SELECT COUNT(*) as c FROM agents WHERE workspace_id = ? AND ${safeColumn('agents', condition_field)} < ?`).get(workspaceId, threshold) as { c: number })?.c || 0
    return count > 0
  }
  const agents = db.prepare(`SELECT ${safeColumn('agents', condition_field)} as val FROM agents WHERE workspace_id = ?`).all(workspaceId) as Array<{ val: unknown }>
  return agents.some((row) => compareValue(row.val, condition_operator, condition_value))
}

function evaluateCountRule(
  db: Database.Database,
  table: 'tasks' | 'activities',
  rule: AlertRule,
  workspaceId: number,
  now?: number,
): boolean {
  const { match, threshold } = countThreshold(rule.condition_value)
  if (rule.condition_operator !== 'count_above' && rule.condition_operator !== 'count_below') {
    const rows = db.prepare(`SELECT ${safeColumn(table, rule.condition_field)} as val FROM ${table} WHERE workspace_id = ?`).all(workspaceId) as Array<{ val: unknown }>
    return rows.some((row) => compareValue(row.val, rule.condition_operator, rule.condition_value))
  }
  let sql = `SELECT COUNT(*) as c FROM ${table} WHERE workspace_id = ?`
  const params: Array<string | number> = [workspaceId]
  if (table === 'activities' && now) {
    sql += ' AND created_at > ?'
    params.push(now - 3600)
  }
  if (match) {
    sql += ` AND ${safeColumn(table, rule.condition_field)} = ?`
    params.push(match)
  }
  const count = (db.prepare(sql).get(...params) as { c: number })?.c || 0
  return rule.condition_operator === 'count_above' ? count > threshold : count < threshold
}

function compareValue(actual: unknown, operator: string, expected: string): boolean {
  if (actual == null) return false
  const strActual = String(actual)
  if (operator === 'equals') return strActual === expected
  if (operator === 'not_equals') return strActual !== expected
  if (operator === 'greater_than') return Number(actual) > Number(expected)
  if (operator === 'less_than') return Number(actual) < Number(expected)
  if (operator === 'contains') return strActual.toLowerCase().includes(expected.toLowerCase())
  return false
}
