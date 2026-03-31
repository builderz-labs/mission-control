import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { runOpenClaw } from '@/lib/command'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

export async function POST(request: Request) {
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

    if (!installedAfter || installedAfter === installedBefore) {
      return NextResponse.json(
        {
          error: 'OpenClaw update did not change the installed version',
          detail: result.stdout || result.stderr || 'No version change detected after update.',
          previousVersion: installedBefore,
          newVersion: installedAfter,
        },
        { status: 409 }
      )
    }

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
  } catch (err: any) {
    const detail =
      err?.stderr?.toString?.()?.trim() ||
      err?.stdout?.toString?.()?.trim() ||
      err?.message ||
      'Unknown error during OpenClaw update'

    logger.error({ err }, 'OpenClaw update failed')

    return NextResponse.json(
      { error: 'OpenClaw update failed', detail },
      { status: 500 }
    )
  }
}
