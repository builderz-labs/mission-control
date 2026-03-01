import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { config, ensureDirExists } from '@/lib/config'
import { join, dirname } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { heavyLimiter } from '@/lib/rate-limit'

const BACKUP_DIR = join(dirname(config.dbPath), 'backups')
const MAX_BACKUPS = 10

/**
 * GET /api/backup - List existing backups (admin only)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  ensureDirExists(BACKUP_DIR)

  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const stat = statSync(join(BACKUP_DIR, f))
        return {
          name: f,
          size: stat.size,
          created_at: Math.floor(stat.mtimeMs / 1000),
        }
      })
      .sort((a, b) => b.created_at - a.created_at)

    return NextResponse.json({ backups: files, dir: BACKUP_DIR })
  } catch {
    return NextResponse.json({ backups: [], dir: BACKUP_DIR })
  }
}

/**
 * POST /api/backup - Create a new backup (admin only)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = heavyLimiter(request)
  if (rateCheck) return rateCheck

  ensureDirExists(BACKUP_DIR)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const backupPath = join(BACKUP_DIR, `mc-backup-${timestamp}.db`)

  try {
    const db = getDatabase()
    await db.backup(backupPath)

    const stat = statSync(backupPath)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'backup_create',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { path: backupPath, size: stat.size },
      ip_address: ipAddress,
    })

    // Prune old backups beyond MAX_BACKUPS
    pruneOldBackups()

    return NextResponse.json({
      success: true,
      backup: {
        name: `mc-backup-${timestamp}.db`,
        size: stat.size,
        created_at: Math.floor(stat.mtimeMs / 1000),
      },
    })
  } catch (error: any) {
    console.error('Backup failed:', error)
    return NextResponse.json({ error: `Backup failed: ${error.message}` }, { status: 500 })
  }
}

/**
 * DELETE /api/backup?name=<filename> - Delete a specific backup (admin only)
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Request body required' }, { status: 400 }) }
  const name = body.name

  if (!name || !name.endsWith('.db') || name.includes('/') || name.includes('..')) {
    return NextResponse.json({ error: 'Invalid backup name' }, { status: 400 })
  }

  try {
    const fullPath = join(BACKUP_DIR, name)
    unlinkSync(fullPath)

    const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    logAuditEvent({
      action: 'backup_delete',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { name },
      ip_address: ipAddress,
    })

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Backup not found' }, { status: 404 })
  }
}

function pruneOldBackups() {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('mc-backup-') && f.endsWith('.db'))
      .map(f => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    for (const file of files.slice(MAX_BACKUPS)) {
      unlinkSync(join(BACKUP_DIR, file.name))
    }
  } catch {
    // Best-effort pruning
  }
}
