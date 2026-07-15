import { NextResponse } from 'next/server'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { releaseUpdateLimiter } from '@/lib/rate-limit'
import { APP_VERSION } from '@/lib/version'
import { normalizeReleaseTag } from '@/lib/release-update-security'
import { releaseUpdateSchema, validateBody } from '@/lib/validation'
import { logger } from '@/lib/logger'

const UPDATE_TIMEOUT = 5 * 60 * 1000 // 5 minutes
const MAX_BUFFER = 10 * 1024 * 1024 // 10 MB
const log = logger.child({ module: 'release-update' })

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
  const limitKey = `${user.tenant_id ?? 1}:${user.workspace_id ?? 1}:${user.id}`
  const limited = releaseUpdateLimiter(limitKey)
  if (limited) return limited

  const validated = await validateBody(request, releaseUpdateSchema)
  if ('error' in validated) return validated.error

  const cwd = process.cwd()
  const steps: string[] = []
  let originalRef: string | null = null
  let checkoutPerformed = false

  try {
    const tag = normalizeReleaseTag(validated.data.targetVersion)
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
    git(['fetch', 'origin', 'refs/heads/main:refs/remotes/origin/main'], cwd)
    steps.push('git fetch origin main')

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
    git(['checkout', tag], cwd)
    checkoutPerformed = true
    steps.push(`git checkout ${tag}`)

    // 5. Install dependencies
    pnpm(['install', '--frozen-lockfile'], cwd)
    steps.push('pnpm install')

    // 6. Build
    pnpm(['build'], cwd)
    steps.push('pnpm build')

    // 7. Read new version from package.json
    const newPkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'))
    const newVersion: string = newPkg.version ?? tag.slice(1)

    // 8. Log to audit_log
    try {
      logAuditEvent({
        action: 'system.update',
        actor: user.username,
        actor_id: user.id,
        target_type: 'release',
        detail: {
          previousVersion: APP_VERSION,
          newVersion,
          tag,
        },
      })
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
  } catch {
    let rollback: { attempted: boolean; restored: boolean } = {
      attempted: false,
      restored: false,
    }
    if (checkoutPerformed && originalRef) {
      rollback = { attempted: true, restored: false }
      try {
        git(['checkout', originalRef], cwd)
        rollback.restored = true
      } catch { /* response reports restoration state without exposing command output */ }
    }

    log.error({ actor: user.username, rollback }, 'Release update failed')

    return NextResponse.json(
      {
        error: 'Update failed',
        steps,
        rollback,
      },
      { status: 500 }
    )
  }
}
