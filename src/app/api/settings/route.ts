import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'

interface SettingRow {
  key: string
  value: string
  description: string | null
  category: string
  updated_by: string | null
  updated_at: number
}

// Default settings definitions (category, description, default value)
const settingDefinitions: Record<string, { category: string; description: string; default: string }> = {
  // Retention
  'retention.activities_days': { category: 'retention', description: 'Days to keep activity records', default: String(config.retention.activities) },
  'retention.audit_log_days': { category: 'retention', description: 'Days to keep audit log entries', default: String(config.retention.auditLog) },
  'retention.logs_days': { category: 'retention', description: 'Days to keep log files', default: String(config.retention.logs) },
  'retention.notifications_days': { category: 'retention', description: 'Days to keep notifications', default: String(config.retention.notifications) },
  'retention.pipeline_runs_days': { category: 'retention', description: 'Days to keep pipeline run history', default: String(config.retention.pipelineRuns) },
  'retention.token_usage_days': { category: 'retention', description: 'Days to keep token usage data', default: String(config.retention.tokenUsage) },

  // Gateway
  'gateway.host': { category: 'gateway', description: 'Gateway hostname', default: config.gatewayHost },
  'gateway.port': { category: 'gateway', description: 'Gateway port number', default: String(config.gatewayPort) },

  // General
  'general.site_name': { category: 'general', description: 'Mission Control display name', default: 'Mission Control' },
  'general.auto_cleanup': { category: 'general', description: 'Enable automatic data cleanup', default: 'false' },
  'general.auto_backup': { category: 'general', description: 'Enable automatic daily backups', default: 'false' },
  'general.backup_retention_count': { category: 'general', description: 'Number of backup files to keep', default: '10' },
}

/**
 * GET /api/settings - List all settings (grouped by category)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM settings ORDER BY category, key').all() as SettingRow[]
  const stored = new Map(rows.map(r => [r.key, r]))

  // Merge defaults with stored values
  const settings: Array<{
    key: string
    value: string
    description: string
    category: string
    updated_by: string | null
    updated_at: number | null
    is_default: boolean
  }> = []

  for (const [key, def] of Object.entries(settingDefinitions)) {
    const row = stored.get(key)
    settings.push({
      key,
      value: row?.value ?? def.default,
      description: row?.description ?? def.description,
      category: row?.category ?? def.category,
      updated_by: row?.updated_by ?? null,
      updated_at: row?.updated_at ?? null,
      is_default: !row,
    })
  }

  // Also include any custom settings not in definitions
  for (const row of rows) {
    if (!settingDefinitions[row.key]) {
      settings.push({
        key: row.key,
        value: row.value,
        description: row.description ?? '',
        category: row.category,
        updated_by: row.updated_by,
        updated_at: row.updated_at,
        is_default: false,
      })
    }
  }

  // Group by category
  const grouped: Record<string, typeof settings> = {}
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = []
    grouped[s.category].push(s)
  }

  return NextResponse.json({ settings, grouped })
}

/**
 * PUT /api/settings - Update one or more settings
 * Body: { settings: { key: value, ... } }
 */
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body?.settings || typeof body.settings !== 'object') {
    return NextResponse.json({ error: 'settings object required' }, { status: 400 })
  }

  const db = getDatabase()
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `)

  const updated: string[] = []
  const changes: Record<string, { old: string | null; new: string }> = {}

  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(body.settings)) {
      const strValue = String(value)
      const def = settingDefinitions[key]
      const category = def?.category ?? 'custom'
      const description = def?.description ?? null

      // Get old value for audit
      const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
      changes[key] = { old: existing?.value ?? null, new: strValue }

      upsert.run(key, strValue, description, category, auth.user.username)
      updated.push(key)
    }
  })

  txn()

  // Audit log
  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'settings_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_keys: updated, changes },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated, count: updated.length })
}

/**
 * DELETE /api/settings?key=... - Reset a setting to default
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
  const key = body.key

  if (!key) {
    return NextResponse.json({ error: 'key parameter required' }, { status: 400 })
  }

  const db = getDatabase()
  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined

  if (!existing) {
    return NextResponse.json({ error: 'Setting not found or already at default' }, { status: 404 })
  }

  db.prepare('DELETE FROM settings WHERE key = ?').run(key)

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'settings_reset',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { key, old_value: existing.value },
    ip_address: ipAddress,
  })

  return NextResponse.json({ reset: key, default_value: settingDefinitions[key]?.default ?? null })
}
