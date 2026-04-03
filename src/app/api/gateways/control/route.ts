import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import { isHermesGatewayRunning } from '@/lib/hermes-sessions'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

      if (action === 'diagnose') {
        const result = await runCommand(hermesBin, ['doctor'], { timeoutMs: 30_000 })
        return NextResponse.json({
          success: result.code === 0,
          output: ((result.stdout || '') + '\n' + (result.stderr || '')).trim(),
        })
      }

      // gateway start/stop/restart/status
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
