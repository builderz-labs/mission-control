import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runOpenClaw } from '@/lib/command'
import { logAuditEvent } from '@/lib/db'
import { logger } from '@/lib/logger'
import { openClawMaintenanceLimiter } from '@/lib/rate-limit'
import { openClawUpdateSchema, validateBody } from '@/lib/validation'

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}`
  const limited = openClawMaintenanceLimiter(limitKey)
  if (limited) return limited

  const validated = await validateBody(request, openClawUpdateSchema)
  if ('error' in validated) return validated.error

  let installedBefore: string | null = null

  try {
    const vResult = await runOpenClaw(['--version'], { timeoutMs: 3000 })
    const match = vResult.stdout.match(/(\d+\.\d+\.\d+)/)
    if (match) installedBefore = match[1]
  } catch {
    return NextResponse.json(
      { error: 'OpenClaw is not installed or not reachable' },
      { status: 400 }
    )
  }

  try {
    await runOpenClaw(['update', '--channel', 'stable'], {
      timeoutMs: 5 * 60 * 1000,
    })

    // Read new version after update
    let installedAfter: string | null = null
    try {
      const vResult = await runOpenClaw(['--version'], { timeoutMs: 3000 })
      const match = vResult.stdout.match(/(\d+\.\d+\.\d+)/)
      if (match) installedAfter = match[1]
    } catch { /* keep null */ }

    // Audit log
    try {
      logAuditEvent({
        action: 'openclaw.update',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'runtime',
        detail: { previousVersion: installedBefore, newVersion: installedAfter, channel: 'stable' },
      })
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      previousVersion: installedBefore,
      newVersion: installedAfter,
    })
  } catch {
    logger.error({ actor: auth.user.username }, 'OpenClaw update failed')

    return NextResponse.json(
      { error: 'OpenClaw update failed' },
      { status: 500 }
    )
  }
}
