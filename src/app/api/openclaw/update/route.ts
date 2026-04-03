import { getErrorMessage, toError } from '@/lib/types/sql'
import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runOpenClaw } from '@/lib/command'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { heavyLimiter } from '@/lib/rate-limit'

export async function POST(request: Request) {
  // update runs for up to 5min — cap at 3 invocations per minute per IP
  const limited = heavyLimiter(request)
  if (limited) return limited

  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

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
    const result = await runOpenClaw(['update', '--channel', 'stable'], {
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
      const db = getDatabase()
      db.prepare(
        'INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)'
      ).run(
        'openclaw.update',
        auth.user.username,
        JSON.stringify({ previousVersion: installedBefore, newVersion: installedAfter })
      )
    } catch { /* non-critical */ }

    return NextResponse.json({
      success: true,
      previousVersion: installedBefore,
      newVersion: installedAfter,
      output: result.stdout,
    })
  } catch (err: unknown) {
    const detail =
      (toError(err) as any).stderr?.toString?.()?.trim() ||
      (toError(err) as any).stdout?.toString?.()?.trim() ||
      getErrorMessage(err) ||
      'Unknown error during OpenClaw update'

    logger.error({ err }, 'OpenClaw update failed')

    return NextResponse.json(
      { error: 'OpenClaw update failed', detail },
      { status: 500 }
    )
  }
}
