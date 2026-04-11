import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import { isHermesGatewayRunning } from '@/lib/hermes-sessions'
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

/** True when MC is running inside a Docker container without systemd. */
function isDockerEnvironment(): boolean {
  return existsSync('/.dockerenv')
}

/**
 * Start hermes gateway as a detached background process.
 *
 * Used in Docker (and any systemd-less environment) where `hermes gateway start`
 * fails because it tries to install as a systemd service. We use `gateway run`
 * (foreground mode) but detach and track the PID ourselves.
 *
 * Writes the child PID to `~/.hermes/gateway.pid` so the existing status
 * detection (`isHermesGatewayRunning()`) picks it up.
 */
function startHermesGatewayDetached(hermesBin: string, homeDir: string): { pid: number | null; error?: string } {
  const hermesDir = join(homeDir, '.hermes')
  try { mkdirSync(hermesDir, { recursive: true }) } catch { /* ignore */ }

  const logPath = join(hermesDir, 'gateway.log')
  const pidPath = join(hermesDir, 'gateway.pid')

  try {
    // Open log file for append; route stdout and stderr into it
    const logFd = openSync(logPath, 'a')
    const child = spawn(hermesBin, ['gateway', 'run'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, HERMES_NONINTERACTIVE: '1', CI: '1' },
    })

    if (!child.pid) {
      return { pid: null, error: 'spawn returned no PID' }
    }

    // Write PID file so the rest of MC can detect the process
    writeFileSync(pidPath, String(child.pid), 'utf8')

    // Detach so MC exiting doesn't kill the gateway
    child.unref()

    return { pid: child.pid }
  } catch (err: any) {
    return { pid: null, error: err?.message || 'Failed to spawn hermes gateway' }
  }
}

/**
 * Stop a hermes gateway process started via startHermesGatewayDetached.
 * Reads the PID file, sends SIGTERM, then waits briefly for exit.
 */
function stopHermesGatewayDetached(homeDir: string): { stopped: boolean; error?: string } {
  const pidPath = join(homeDir, '.hermes', 'gateway.pid')
  if (!existsSync(pidPath)) {
    return { stopped: false, error: 'No gateway.pid file — gateway not running?' }
  }

  try {
    const raw = readFileSync(pidPath, 'utf8').trim()
    const pid = raw.startsWith('{') ? JSON.parse(raw).pid : parseInt(raw, 10)
    if (!pid) return { stopped: false, error: 'Could not parse PID file' }

    try {
      process.kill(pid, 'SIGTERM')
    } catch (err: any) {
      if (err?.code === 'ESRCH') {
        // Process already dead — clean up stale PID file
        try { require('node:fs').unlinkSync(pidPath) } catch { /* ignore */ }
        return { stopped: true }
      }
      return { stopped: false, error: err?.message }
    }

    // Clean up PID file
    try { require('node:fs').unlinkSync(pidPath) } catch { /* ignore */ }
    return { stopped: true }
  } catch (err: any) {
    return { stopped: false, error: err?.message || 'Failed to stop gateway' }
  }
}

type GatewayType = 'hermes' | 'openclaw'
type GatewayAction = 'status' | 'start' | 'stop' | 'restart' | 'diagnose'

interface GatewayStatus {
  type: GatewayType
  name: string
  installed: boolean
  running: boolean
  port?: number
  pid?: number | null
  version?: string | null
  error?: string
}

function getHermesGatewayStatus(): GatewayStatus {
  const homeDir = config.homeDir
  const installed = existsSync(join(homeDir, '.hermes'))
  const running = installed && isHermesGatewayRunning()

  let pid: number | null = null
  if (running) {
    try {
      const pidStr = require('node:fs').readFileSync(join(homeDir, '.hermes', 'gateway.pid'), 'utf8')
      const parsed = pidStr.trim()
      // gateway.pid can be plain number or JSON with pid field
      if (parsed.startsWith('{')) {
        const json = JSON.parse(parsed)
        pid = json.pid || null
      } else {
        pid = parseInt(parsed, 10) || null
      }
    } catch { /* ignore */ }
  }

  return { type: 'hermes', name: 'Hermes Gateway', installed, running, pid }
}

function getOpenClawGatewayStatus(): GatewayStatus {
  const installed = !!(config.openclawConfigPath && existsSync(config.openclawConfigPath))
  let running = false
  let port: number | undefined

  if (installed) {
    port = config.gatewayPort || 18789
    // Check if gateway port is responding
    try {
      const { spawnSync } = require('node:child_process')
      const result = spawnSync('curl', ['-sf', '--max-time', '2', `http://${config.gatewayHost || '127.0.0.1'}:${port}/health`], { stdio: 'pipe', timeout: 5000 })
      running = result.status === 0
    } catch { /* ignore */ }
  }

  return { type: 'openclaw', name: 'OpenClaw Gateway', installed, running, port }
}

/**
 * GET /api/gateways/control — Get status of all gateways
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const gateways: GatewayStatus[] = []
  gateways.push(getHermesGatewayStatus())
  gateways.push(getOpenClawGatewayStatus())

  return NextResponse.json({ gateways })
}

/**
 * POST /api/gateways/control — Start, stop, restart, or diagnose a gateway
 * Body: { gateway: 'hermes' | 'openclaw', action: 'start' | 'stop' | 'restart' | 'diagnose' }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { gateway, action } = body as { gateway: GatewayType; action: GatewayAction }

    if (!gateway || !action) {
      return NextResponse.json({ error: 'gateway and action are required' }, { status: 400 })
    }

    if (!['hermes', 'openclaw'].includes(gateway)) {
      return NextResponse.json({ error: 'Invalid gateway type' }, { status: 400 })
    }

    if (!['start', 'stop', 'restart', 'diagnose'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const { runCommand } = require('@/lib/command')

    if (gateway === 'hermes') {
      const bin = join(config.homeDir, '.local', 'bin', 'hermes')
      const hermesBin = existsSync(bin) ? bin : 'hermes'
      const inDocker = isDockerEnvironment()

      if (action === 'diagnose') {
        const result = await runCommand(hermesBin, ['doctor'], { timeoutMs: 30_000 })
        return NextResponse.json({
          success: result.code === 0,
          output: ((result.stdout || '') + '\n' + (result.stderr || '')).trim(),
        })
      }

      // In Docker, `hermes gateway start` fails because it tries to install as
      // a systemd service. Use detached `hermes gateway run` instead and manage
      // the PID ourselves. On bare metal, defer to the CLI's native subcommands.
      if (inDocker) {
        if (action === 'start') {
          // If already running, short-circuit
          if (isHermesGatewayRunning()) {
            return NextResponse.json({
              success: true,
              output: 'Hermes gateway already running',
              status: getHermesGatewayStatus(),
            })
          }
          const result = startHermesGatewayDetached(hermesBin, config.homeDir)
          if (!result.pid) {
            return NextResponse.json({
              success: false,
              output: `Failed to start: ${result.error || 'unknown error'}`,
              status: getHermesGatewayStatus(),
            })
          }
          logger.info({ pid: result.pid }, 'Hermes gateway started (detached) in Docker')
          return NextResponse.json({
            success: true,
            output: `Hermes gateway started in foreground mode (PID ${result.pid}). Logs: ~/.hermes/gateway.log`,
            status: getHermesGatewayStatus(),
          })
        }

        if (action === 'stop') {
          const result = stopHermesGatewayDetached(config.homeDir)
          return NextResponse.json({
            success: result.stopped,
            output: result.stopped ? 'Hermes gateway stopped' : (result.error || 'Failed to stop'),
            status: getHermesGatewayStatus(),
          })
        }

        if (action === 'restart') {
          stopHermesGatewayDetached(config.homeDir)
          // Brief pause to let the process exit
          await new Promise(r => setTimeout(r, 500))
          const result = startHermesGatewayDetached(hermesBin, config.homeDir)
          return NextResponse.json({
            success: !!result.pid,
            output: result.pid
              ? `Hermes gateway restarted (PID ${result.pid})`
              : `Failed to restart: ${result.error || 'unknown error'}`,
            status: getHermesGatewayStatus(),
          })
        }
      }

      // Bare metal: use the hermes CLI directly (systemd-managed service)
      const result = await runCommand(hermesBin, ['gateway', action], {
        timeoutMs: 15_000,
        env: { ...process.env, HERMES_NONINTERACTIVE: '1', CI: '1' },
      })

      logger.info({ gateway, action, code: result.code }, 'Gateway control action executed')

      return NextResponse.json({
        success: result.code === 0,
        output: ((result.stdout || '') + '\n' + (result.stderr || '')).trim(),
        status: getHermesGatewayStatus(),
      })
    }

    if (gateway === 'openclaw') {
      const openclawBin = config.openclawBin || 'openclaw'

      if (action === 'diagnose') {
        const result = await runCommand(openclawBin, ['doctor'], { timeoutMs: 30_000 })
        return NextResponse.json({
          success: result.code === 0,
          output: ((result.stdout || '') + '\n' + (result.stderr || '')).trim(),
        })
      }

      // OpenClaw gateway uses `openclaw gateway start/stop/restart`
      const result = await runCommand(openclawBin, ['gateway', action], {
        timeoutMs: 15_000,
      })

      logger.info({ gateway, action, code: result.code }, 'Gateway control action executed')

      return NextResponse.json({
        success: result.code === 0,
        output: ((result.stdout || '') + '\n' + (result.stderr || '')).trim(),
        status: getOpenClawGatewayStatus(),
      })
    }

    return NextResponse.json({ error: 'Unknown gateway' }, { status: 400 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/gateways/control error')
    return NextResponse.json({ error: 'Gateway control failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
