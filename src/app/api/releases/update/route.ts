import { getErrorMessage, toError } from '@/lib/types/sql'
import { NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { requireRole } from '@/lib/auth'
import { heavyLimiter } from '@/lib/rate-limit'
import { getDatabase } from '@/lib/db'
import { APP_VERSION } from '@/lib/version'

const UPDATE_TIMEOUT = 5 * 60 * 1000 // 5 minutes
const MAX_BUFFER = 10 * 1024 * 1024 // 10 MB

const EXEC_OPTS = {
  timeout: UPDATE_TIMEOUT,
  maxBuffer: MAX_BUFFER,
  encoding: 'utf-8' as const,
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { ...EXEC_OPTS, cwd }).trim()
}

function pnpm(args: string[], cwd: string): string {
  return execFileSync('pnpm', args, { ...EXEC_OPTS, cwd }).trim()
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = requireRole(request, 'admin')
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Rate-limit update operations — they spawn git/pnpm subprocesses (expensive)
  const limited = heavyLimiter(request)
  if (limited) return limited

  const user = auth.user!
  const cwd = process.cwd()
  const steps: { step: string; output: string }[] = []

  try {
    // Parse target version from request body
    const body = await request.json().catch(() => ({}))
    const targetVersion: string | undefined = body.targetVersion
    if (!targetVersion) {
      return NextResponse.json(
        { error: 'Missing targetVersion in request body' },
        { status: 400 }
      )
    }

    // Normalize to tag format (e.g. "1.2.0" -> "v1.2.0")
    const tag = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`

    // 1. Check for uncommitted changes
    const status = git(['status', '--porcelain'], cwd)
    if (status) {
      return NextResponse.json(
        {
          error: 'Working tree has uncommitted changes. Please commit or stash them before updating.',
          dirty: true,
          files: status.split('\n').slice(0, 20),
        },
        { status: 409 }
      )
    }

    // 2. Fetch tags and release code from origin
    const fetchOut = git(['fetch', 'origin', '--tags', '--force'], cwd)
    steps.push({ step: 'git fetch', output: fetchOut || 'OK' })

    // 3. Verify the tag exists
    try {
      git(['rev-parse', '--verify', `refs/tags/${tag}`], cwd)
    } catch {
      return NextResponse.json(
        { error: `Release tag ${tag} not found in remote` },
        { status: 404 }
      )
    }

    // 4. Checkout the release tag
    const checkoutOut = git(['checkout', tag], cwd)
    steps.push({ step: `git checkout ${tag}`, output: checkoutOut })

    // 5. Install dependencies
    const installOut = pnpm(['install', '--frozen-lockfile'], cwd)
    steps.push({ step: 'pnpm install', output: installOut })

    // 6. Build
    const buildOut = pnpm(['build'], cwd)
    steps.push({ step: 'pnpm build', output: buildOut })

    // 7. Read new version from package.json
    const newPkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
    const newVersion: string = newPkg.version ?? targetVersion

    // 8. Log to audit_log
    try {
      const db = getDatabase()
      db.prepare(
        'INSERT INTO audit_log (action, actor, detail) VALUES (?, ?, ?)'
      ).run(
        'system.update',
        user.username,
        JSON.stringify({
          previousVersion: APP_VERSION,
          newVersion,
          tag,
        })
      )
    } catch {
      // Non-critical -- don't fail the update if audit logging fails
    }

    return NextResponse.json({
      success: true,
      previousVersion: APP_VERSION,
      newVersion,
      tag,
      steps,
      restartRequired: true,
    })
  } catch (err: unknown) {
    const message =
      (toError(err) as any).stderr?.toString?.()?.trim() ||
      (toError(err) as any).stdout?.toString?.()?.trim() ||
      getErrorMessage(err) ||
      'Unknown error during update'

    return NextResponse.json(
      {
        error: 'Update failed',
        detail: message,
        steps,
      },
      { status: 500 }
    )
  }
}
