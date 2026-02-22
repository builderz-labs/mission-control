import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { config } from '@/lib/config'

interface CleanupResult {
  table: string
  deleted: number
  cutoff_date: string
  retention_days: number
}

/**
 * GET /api/cleanup - Show retention policy and what would be cleaned
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const ret = config.retention

  const preview = []

  for (const { table, column, days, label } of getRetentionTargets()) {
    if (days <= 0) {
      preview.push({ table: label, retention_days: 0, stale_count: 0, note: 'Retention disabled (keep forever)' })
      continue
    }
    const cutoff = now - days * 86400
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} < ?`).get(cutoff) as any
      preview.push({
        table: label,
        retention_days: days,
        cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
        stale_count: row.c,
      })
    } catch {
      preview.push({ table: label, retention_days: days, stale_count: 0, note: 'Table not found' })
    }
  }

  // Token usage file stats
  try {
    const { readFile } = require('fs/promises')
    const data = JSON.parse(await readFile(config.tokensPath, 'utf-8'))
    const cutoffMs = Date.now() - ret.tokenUsage * 86400000
    const stale = data.filter((r: any) => r.timestamp < cutoffMs).length
    preview.push({
      table: 'Token Usage (file)',
      retention_days: ret.tokenUsage,
      cutoff_date: new Date(cutoffMs).toISOString().split('T')[0],
      stale_count: stale,
    })
  } catch {
    preview.push({ table: 'Token Usage (file)', retention_days: ret.tokenUsage, stale_count: 0, note: 'No token data file' })
  }

  return NextResponse.json({ retention: config.retention, preview })
}

/**
 * POST /api/cleanup - Run cleanup (admin only)
 * Body: { dry_run?: boolean }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const dryRun = body.dry_run === true

  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const results: CleanupResult[] = []
  let totalDeleted = 0

  for (const { table, column, days, label } of getRetentionTargets()) {
    if (days <= 0) continue
    const cutoff = now - days * 86400

    try {
      if (dryRun) {
        const row = db.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE ${column} < ?`).get(cutoff) as any
        results.push({
          table: label,
          deleted: row.c,
          cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
          retention_days: days,
        })
        totalDeleted += row.c
      } else {
        const res = db.prepare(`DELETE FROM ${table} WHERE ${column} < ?`).run(cutoff)
        results.push({
          table: label,
          deleted: res.changes,
          cutoff_date: new Date(cutoff * 1000).toISOString().split('T')[0],
          retention_days: days,
        })
        totalDeleted += res.changes
      }
    } catch {
      results.push({ table: label, deleted: 0, cutoff_date: '', retention_days: days })
    }
  }

  // Clean token usage file
  const ret = config.retention
  if (ret.tokenUsage > 0) {
    try {
      const { readFile, writeFile } = require('fs/promises')
      const raw = await readFile(config.tokensPath, 'utf-8')
      const data = JSON.parse(raw)
      const cutoffMs = Date.now() - ret.tokenUsage * 86400000
      const kept = data.filter((r: any) => r.timestamp >= cutoffMs)
      const removed = data.length - kept.length

      if (!dryRun && removed > 0) {
        await writeFile(config.tokensPath, JSON.stringify(kept, null, 2))
      }

      results.push({
        table: 'Token Usage (file)',
        deleted: removed,
        cutoff_date: new Date(cutoffMs).toISOString().split('T')[0],
        retention_days: ret.tokenUsage,
      })
      totalDeleted += removed
    } catch {
      // No token file or parse error
    }
  }

  if (!dryRun && totalDeleted > 0) {
    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'data_cleanup',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { total_deleted: totalDeleted, results },
      ip_address: ipAddress,
    })
  }

  return NextResponse.json({
    dry_run: dryRun,
    total_deleted: totalDeleted,
    results,
  })
}

function getRetentionTargets() {
  const ret = config.retention
  return [
    { table: 'activities', column: 'created_at', days: ret.activities, label: 'Activities' },
    { table: 'audit_log', column: 'created_at', days: ret.auditLog, label: 'Audit Log' },
    { table: 'notifications', column: 'created_at', days: ret.notifications, label: 'Notifications' },
    { table: 'pipeline_runs', column: 'created_at', days: ret.pipelineRuns, label: 'Pipeline Runs' },
  ]
}
