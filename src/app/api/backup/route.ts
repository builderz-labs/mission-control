import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { config, ensureDirExists } from '@/lib/config'
import { join, dirname } from 'path'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { backupMutationLimiter, extractClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { runOpenClaw } from '@/lib/command'
import { denyUnscopedResourceForStrictWorkspace } from '@/lib/workspace-isolation'
import { backupDeleteSchema, validateBody } from '@/lib/validation'

const BACKUP_DIR = join(dirname(config.dbPath), 'backups')
const MAX_BACKUPS = 10

/**
 * GET /api/backup - List existing backups (admin only)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'host_administration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

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

    return NextResponse.json({ backups: files })
  } catch {
    return NextResponse.json({ backups: [] })
  }
}

/**
 * POST /api/backup - Create a new backup (admin only)
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'host_administration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}:backup`
  const rateCheck = backupMutationLimiter(limitKey)
  if (rateCheck) return rateCheck

  const target = request.nextUrl.searchParams.get('target')
  if (target !== null && target !== 'gateway') {
    return NextResponse.json({ error: 'Invalid backup target' }, { status: 400 })
  }

  // Gateway state backup via `openclaw backup create`
  if (target === 'gateway') {
    ensureDirExists(BACKUP_DIR)
    const ipAddress = extractClientIp(request)
    try {
      let stdout: string
      let stderr: string
      try {
        const result = await runOpenClaw(['backup', 'create', '--output', BACKUP_DIR], { timeoutMs: 60000 })
        stdout = result.stdout
        stderr = result.stderr
      } catch (error: any) {
        // openclaw backup may exit non-zero despite success — check output
        stdout = error.stdout || ''
        stderr = error.stderr || ''
        const combined = `${stdout}\n${stderr}`
        if (!combined.includes('Created')) {
          logger.error({ err: error }, 'Gateway backup failed')
          return NextResponse.json({ error: 'Gateway backup failed' }, { status: 500 })
        }
      }

      logAuditEvent({
        action: 'openclaw.backup',
        actor: auth.user.username,
        actor_id: auth.user.id,
        detail: { target: 'gateway' },
        ip_address: ipAddress,
      })

      return NextResponse.json({ success: true, output: 'Gateway backup created' })
    } catch (error: any) {
      logger.error({ err: error }, 'Gateway backup failed')
      return NextResponse.json({ error: 'Gateway backup failed' }, { status: 500 })
    }
  }

  // Default: MC SQLite backup
  ensureDirExists(BACKUP_DIR)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const backupPath = join(BACKUP_DIR, `mc-backup-${timestamp}.db`)

  try {
    const db = getDatabase()
    await db.backup(backupPath)

    const stat = statSync(backupPath)

    const ipAddress = extractClientIp(request)
    logAuditEvent({
      action: 'backup_create',
      actor: auth.user.username,
      actor_id: auth.user.id,
      detail: { name: `mc-backup-${timestamp}.db`, size: stat.size },
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
    logger.error({ err: error }, 'Backup failed')
    return NextResponse.json({ error: 'Backup failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/backup?name=<filename> - Delete a specific backup (admin only)
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const isolationDeny = denyUnscopedResourceForStrictWorkspace(auth.user, 'host_administration', new URL(request.url).pathname)
  if (isolationDeny) return isolationDeny

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}:backup`
  const rateCheck = backupMutationLimiter(limitKey)
  if (rateCheck) return rateCheck

  try {
    await request.clone().json()
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  const result = await validateBody(request, backupDeleteSchema)
  if ('error' in result) return result.error
  const { name } = result.data

  try {
    const fullPath = join(BACKUP_DIR, name)
    unlinkSync(fullPath)

    const ipAddress = extractClientIp(request)
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
