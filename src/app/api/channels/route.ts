import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { transformGatewayChannels, type ChannelsSnapshot } from '@/lib/channel-snapshot'

const gatewayInternalUrl = `http://${config.gatewayHost}:${config.gatewayPort}`

function gatewayHeaders(): Record<string, string> {
  const token = getDetectedGatewayToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function commandStdout(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('stdout' in error)) return null
  const stdout = (error as { stdout?: unknown }).stdout
  return typeof stdout === 'string' && stdout.trim() ? stdout : null
}

async function loadChannelsViaCli(probe = false): Promise<ChannelsSnapshot> {
  const { runOpenClaw } = await import('@/lib/command')
  const args = ['channels', 'status', '--json', '--timeout', probe ? '5000' : '2000']
  if (probe) args.push('--probe')
  let stdout: string
  try {
    const result = await runOpenClaw(args, { timeoutMs: probe ? 12000 : 3500 })
    stdout = result.stdout
  } catch (error) {
    const partialOutput = commandStdout(error)
    if (!partialOutput) throw error
    stdout = partialOutput
  }
  return {
    ...transformGatewayChannels(JSON.parse(stdout)),
    connected: true,
  }
}

async function isGatewayReachable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)
    const res = await fetch(`${gatewayInternalUrl}/health`, {
      headers: gatewayHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

/**
 * GET /api/channels - Fetch channel status from the gateway
 * Supports ?action=probe&channel=<name> to probe a specific channel
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  // Probe a specific channel
  if (action === 'probe') {
    const channel = searchParams.get('channel')
    if (!channel) {
      return NextResponse.json({ error: 'channel parameter required' }, { status: 400 })
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const res = await fetch(`${gatewayInternalUrl}/api/channels/probe`, {
        method: 'POST',
        headers: gatewayHeaders(),
        body: JSON.stringify({ channel }),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!res.ok) {
        if (res.status === 404 || res.status === 401) {
          return NextResponse.json(await loadChannelsViaCli(true))
        }
        throw new Error(`Gateway channel probe failed with status ${res.status}`)
      }

      const data = await res.json()
      return NextResponse.json(data)
    } catch (err) {
      try {
        return NextResponse.json(await loadChannelsViaCli(true))
      } catch (cliErr) {
        logger.warn({
          channel,
          gatewayError: errorMessage(err),
          cliError: errorMessage(cliErr),
        }, 'Channel probe failed')
        return NextResponse.json(
          { ok: false, error: 'Gateway unreachable' },
          { status: 502 },
        )
      }
    }
  }

  // Default: fetch all channel statuses
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1800)

    const res = await fetch(`${gatewayInternalUrl}/api/channels/status`, {
      headers: gatewayHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      if (res.status === 404 || res.status === 401) {
        return NextResponse.json(await loadChannelsViaCli(false))
      }
      throw new Error(`Gateway channel status failed with status ${res.status}`)
    }

    const data = await res.json()
    return NextResponse.json(transformGatewayChannels(data))
  } catch (err) {
    try {
      return NextResponse.json(await loadChannelsViaCli(false))
    } catch (cliErr) {
      logger.warn({
        gatewayError: errorMessage(err),
        cliError: errorMessage(cliErr),
      }, 'Gateway unreachable for channel status')
      const reachable = await isGatewayReachable()
      return NextResponse.json({
        channels: {},
        channelAccounts: {},
        channelOrder: [],
        channelLabels: {},
        connected: reachable,
      } satisfies ChannelsSnapshot)
    }
  }
}

/**
 * POST /api/channels - Platform-specific actions
 * Body: { action: string, ...params }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body || !body.action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  const { action } = body

  try {
    switch (action) {
      case 'whatsapp-link': {
        const force = body.force === true
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 30000)
          const res = await fetch(`${gatewayInternalUrl}/api/channels/whatsapp/link`, {
            method: 'POST',
            headers: gatewayHeaders(),
            body: JSON.stringify({ force }),
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (res.ok) {
            const data = await res.json()
            return NextResponse.json(data)
          }
          if (res.status !== 404) {
            const data = await res.json().catch(() => ({}))
            return NextResponse.json(data, { status: res.status })
          }
        } catch {
          // Fallback to RPC below.
        }
        return NextResponse.json(
          await callOpenClawGateway('web.login.start', { force, timeoutMs: 30000 }, 32000)
        )
      }

      case 'whatsapp-wait': {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 120000)
          const res = await fetch(`${gatewayInternalUrl}/api/channels/whatsapp/wait`, {
            method: 'POST',
            headers: gatewayHeaders(),
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (res.ok) {
            const data = await res.json()
            return NextResponse.json(data)
          }
          if (res.status !== 404) {
            const data = await res.json().catch(() => ({}))
            return NextResponse.json(data, { status: res.status })
          }
        } catch {
          // Fallback to RPC below.
        }
        return NextResponse.json(
          await callOpenClawGateway('web.login.wait', { timeoutMs: 120000 }, 122000)
        )
      }

      case 'whatsapp-logout': {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 10000)
          const res = await fetch(`${gatewayInternalUrl}/api/channels/whatsapp/logout`, {
            method: 'POST',
            headers: gatewayHeaders(),
            signal: controller.signal,
          })
          clearTimeout(timeout)
          if (res.ok) {
            const data = await res.json()
            return NextResponse.json(data)
          }
          if (res.status !== 404) {
            const data = await res.json().catch(() => ({}))
            return NextResponse.json(data, { status: res.status })
          }
        } catch {
          // Fallback to RPC below.
        }
        return NextResponse.json(
          await callOpenClawGateway('channels.logout', { channel: 'whatsapp' }, 12000)
        )
      }

      case 'nostr-profile-save': {
        const accountId = body.accountId || 'default'
        const profile = body.profile
        if (!profile) {
          return NextResponse.json({ error: 'profile required' }, { status: 400 })
        }
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const res = await fetch(
          `${gatewayInternalUrl}/api/channels/nostr/${encodeURIComponent(accountId)}/profile`,
          {
            method: 'PUT',
            headers: gatewayHeaders(),
            body: JSON.stringify(profile),
            signal: controller.signal,
          },
        )
        clearTimeout(timeout)
        const data = await res.json()
        return NextResponse.json(data, { status: res.ok ? 200 : res.status })
      }

      case 'nostr-profile-import': {
        const accountId = body.accountId || 'default'
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        const res = await fetch(
          `${gatewayInternalUrl}/api/channels/nostr/${encodeURIComponent(accountId)}/profile/import`,
          {
            method: 'POST',
            headers: gatewayHeaders(),
            body: JSON.stringify({ autoMerge: true }),
            signal: controller.signal,
          },
        )
        clearTimeout(timeout)
        const data = await res.json()
        return NextResponse.json(data, { status: res.ok ? 200 : res.status })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (err) {
    logger.warn({ action, error: errorMessage(err) }, 'Channel action failed')
    return NextResponse.json(
      { ok: false, error: 'Gateway unreachable' },
      { status: 502 },
    )
  }
}
