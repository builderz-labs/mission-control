import { NextRequest, NextResponse } from 'next/server'
import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'child_process'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { hostPackageInstallLimiter } from '@/lib/rate-limit'
import { isTmuxAvailable } from '@/lib/pty-manager'
import { logger } from '@/lib/logger'
import { installTmuxSchema, validateBody } from '@/lib/validation'

const log = logger.child({ module: 'pty-setup' })
const EXEC_OPTIONS: ExecFileSyncOptionsWithStringEncoding = {
  encoding: 'utf-8' as const,
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 120_000,
  maxBuffer: 1024 * 1024,
}

/**
 * GET /api/pty/setup — Check terminal prerequisites
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const tmuxInstalled = isTmuxAvailable()
  let tmuxVersion: string | null = null

  if (tmuxInstalled) {
    try {
      tmuxVersion = execFileSync('tmux', ['-V'], { encoding: 'utf-8', stdio: 'pipe' }).trim()
    } catch {
      // ignore
    }
  }

  // Detect platform for install instructions
  const platform = process.platform
  const installCommand = platform === 'darwin'
    ? 'brew install tmux'
    : platform === 'linux'
      ? 'apt install -y tmux || yum install -y tmux'
      : null

  return NextResponse.json({
    tmux: {
      installed: tmuxInstalled,
      version: tmuxVersion,
      installCommand,
      required: true,
      description: 'tmux is required for terminal emulation of agent sessions',
    },
    platform,
    ready: tmuxInstalled,
  })
}

/**
 * POST /api/pty/setup — Install tmux (opt-in)
 *
 * Attempts to install tmux using the platform package manager.
 * Requires admin role. This is a privileged operation.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limitKey = `${auth.user.tenant_id ?? 1}:${auth.user.workspace_id ?? 1}:${auth.user.id}`
  const limited = hostPackageInstallLimiter(limitKey)
  if (limited) return limited

  const validated = await validateBody(request, installTmuxSchema)
  if ('error' in validated) return validated.error

  if (isTmuxAvailable()) {
    return NextResponse.json({ success: true, message: 'tmux is already installed' })
  }

  const platform = process.platform
  let installCmd: string[]

  if (platform === 'darwin') {
    // Check if brew is available
    try {
      execFileSync('brew', ['--version'], EXEC_OPTIONS)
    } catch {
      return NextResponse.json({
        success: false,
        error: 'Homebrew is not installed. Install tmux manually: brew install tmux',
      }, { status: 400 })
    }
    installCmd = ['brew', 'install', 'tmux']
  } else if (platform === 'linux') {
    // Try apt first, then yum
    try {
      execFileSync('apt-get', ['--version'], EXEC_OPTIONS)
      installCmd = ['sudo', 'apt-get', 'install', '-y', 'tmux']
    } catch {
      try {
        execFileSync('yum', ['--version'], EXEC_OPTIONS)
        installCmd = ['sudo', 'yum', 'install', '-y', 'tmux']
      } catch {
        return NextResponse.json({
          success: false,
          error: 'No supported package manager found. Install tmux manually.',
        }, { status: 400 })
      }
    }
  } else {
    return NextResponse.json({
      success: false,
      error: `tmux auto-install is not supported on ${platform}. Install manually.`,
    }, { status: 400 })
  }

  try {
    log.info({ packageManager: installCmd[0], actor: auth.user.username }, 'Installing tmux')
    execFileSync(installCmd[0], installCmd.slice(1), EXEC_OPTIONS)

    // Verify installation
    if (!isTmuxAvailable()) {
      return NextResponse.json({
        success: false,
        error: 'Installation completed but tmux is still not available. Check your PATH.',
      }, { status: 500 })
    }

    let version: string | null = null
    try {
      version = execFileSync('tmux', ['-V'], EXEC_OPTIONS).trim()
    } catch {
      // ignore
    }

    try {
      logAuditEvent({
        action: 'system.package_install',
        actor: auth.user.username,
        actor_id: auth.user.id,
        target_type: 'host_package',
        detail: { package: 'tmux', package_manager: installCmd[0], platform },
      })
    } catch {
      // Installation succeeded; audit persistence must not corrupt the response.
    }

    return NextResponse.json({
      success: true,
      message: `tmux installed successfully${version ? ` (${version})` : ''}`,
      version,
    })
  } catch {
    log.error({ actor: auth.user.username }, 'Failed to install tmux')
    return NextResponse.json({
      success: false,
      error: 'Failed to install tmux. Check the server logs and package manager state.',
    }, { status: 500 })
  }
}
