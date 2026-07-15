import { NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { APP_VERSION } from '@/lib/version'
import { normalizeReleaseTag } from '@/lib/release-update-security'

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

export async function POST(request: Request) {
  const auth = requireRole(request, 'admin')
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const user = auth.user!
  const cwd = process.cwd()
  const steps: { step: string; output: string }[] = []
  let originalRef: string | null = null
  let checkoutPerformed = false

  try {
    // Parse target version from request body
    const body = await request.json().catch(() => ({}))
    const tag = normalizeReleaseTag(body.targetVersion)
    if (!tag) {
      return NextResponse.json(
        { error: 'targetVersion must be an exact semantic version such as 2.1.0 or v2.1.0' },
        { status: 400 }
      )
    }

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
    try {
      originalRef = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd)
    } catch {
      originalRef = git(['rev-parse', '--verify', 'HEAD'], cwd)
    }

    // 2. Fetch the trusted main history and the exact release tag. Fetching an
    // exact ref prevents a stale or unrelated local tag from being accepted.
    const fetchMainOut = git(['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main'], cwd)
    steps.push({ step: 'git fetch origin main', output: fetchMainOut || 'OK' })

    // 3. Verify the tag exists
    try {
      git(['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], cwd)
      git(['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`, '--force'], cwd)
      git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], cwd)
    } catch {
      return NextResponse.json(
        { error: `Release tag ${tag} not found in remote` },
        { status: 404 }
      )
    }

    // A tag fetched from origin is still not a trusted release if it points to
    // unrelated history. Only release commits reachable from origin/main may
    // execute dependency lifecycle scripts or the build.
    try {
      git(['merge-base', '--is-ancestor', `refs/tags/${tag}^{commit}`, 'origin/main'], cwd)
    } catch {
      return NextResponse.json(
        { error: `Release tag ${tag} is not part of the trusted origin/main history` },
        { status: 409 }
      )
    }

    // 4. Checkout the release tag
    const checkoutOut = git(['checkout', tag], cwd)
    checkoutPerformed = true
    steps.push({ step: `git checkout ${tag}`, output: checkoutOut })

    // 5. Install dependencies
    const installOut = pnpm(['install', '--frozen-lockfile'], cwd)
    steps.push({ step: 'pnpm install', output: installOut })

    // 6. Build
    const buildOut = pnpm(['build'], cwd)
    steps.push({ step: 'pnpm build', output: buildOut })

    // 7. Read new version from package.json
    const newPkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
    const newVersion: string = newPkg.version ?? tag.slice(1)

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
  } catch (err: any) {
    const message =
      err?.stderr?.toString?.()?.trim() ||
      err?.stdout?.toString?.()?.trim() ||
      err?.message ||
      'Unknown error during update'

    let rollback: { attempted: boolean; restored: boolean; detail?: string } = {
      attempted: false,
      restored: false,
    }
    if (checkoutPerformed && originalRef) {
      rollback = { attempted: true, restored: false }
      try {
        git(['checkout', originalRef], cwd)
        rollback.restored = true
      } catch (rollbackErr: any) {
        rollback.detail = rollbackErr?.stderr?.toString?.()?.trim() || rollbackErr?.message || 'Rollback failed'
      }
    }

    return NextResponse.json(
      {
        error: 'Update failed',
        detail: message,
        steps,
        rollback,
      },
      { status: 500 }
    )
  }
}
