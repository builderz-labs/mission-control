import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'

const gatewayInternalUrl = `http://${config.gatewayHost}:${config.gatewayPort}`

function gatewayHeaders(): Record<string, string> {
  const token = getDetectedGatewayToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

type GatewayData = unknown

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

interface ChannelStatus {
  configured: boolean
  linked?: boolean
  running: boolean
  connected?: boolean
  lastConnectedAt?: number | null
  lastMessageAt?: number | null
  lastStartAt?: number | null
  lastError?: string | null
  authAgeMs?: number | null
  mode?: string | null
  baseUrl?: string | null
  publicKey?: string | null
  probe?: GatewayData
  profile?: GatewayData
}

interface ChannelAccount {
  accountId: string
  name?: string | null
  configured?: boolean | null
  linked?: boolean | null
  running?: boolean | null
  connected?: boolean | null
  lastConnectedAt?: number | null
  lastInboundAt?: number | null
  lastOutboundAt?: number | null
  lastError?: string | null
  lastStartAt?: number | null
  mode?: string | null
  probe?: GatewayData
  publicKey?: string | null
  profile?: GatewayData
}

interface ChannelsSnapshot {
  channels: Record<string, ChannelStatus>
  channelAccounts: Record<string, ChannelAccount[]>
  channelOrder: string[]
  channelLabels: Record<string, string>
  connected: boolean
  updatedAt?: number
}

function transformGatewayChannels(data: GatewayData): ChannelsSnapshot {
  const parsed = asRecord(data)
  const rawChannels = asRecord(parsed?.channels) ?? {}
  const rawAccounts = asRecord(parsed?.channelAccounts) ?? {}
  const channelLabels = asRecord(parsed?.channelLabels)
  const order = Array.isArray(parsed?.channelOrder)
    ? parsed.channelOrder.filter((value): value is string => typeof value === 'string')
    : Object.keys(rawChannels)

  const channels: Record<string, ChannelStatus> = {}
  const channelAccounts: Record<string, ChannelAccount[]> = {}
  const labels: Record<string, string> = Object.fromEntries(
    Object.entries(channelLabels ?? {}).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : [])
  )

  for (const key of order) {
    const ch = asRecord(rawChannels[key])
    if (!ch) continue

    channels[key] = {
      configured: !!readBoolean(ch.configured),
      linked: readBoolean(ch.linked),
      running: !!readBoolean(ch.running),
      connected: readBoolean(ch.connected),
      lastConnectedAt: readNumber(ch.lastConnectedAt) ?? null,
      lastMessageAt: readNumber(ch.lastMessageAt) ?? null,
      lastStartAt: readNumber(ch.lastStartAt) ?? null,
      lastError: readString(ch.lastError) ?? null,
      authAgeMs: readNumber(ch.authAgeMs) ?? null,
      mode: readString(ch.mode) ?? null,
      baseUrl: readString(ch.baseUrl) ?? null,
      publicKey: readString(ch.publicKey) ?? null,
      probe: ch.probe ?? null,
      profile: ch.profile ?? null,
    }

    const accounts = rawAccounts[key] || []
    const accountEntries = (Array.isArray(accounts) ? accounts : Object.values(accounts)) as GatewayData[]
    channelAccounts[key] = accountEntries.map((acct) => {
      const parsedAccount = asRecord(acct) ?? {}
      return {
        accountId: readString(parsedAccount.accountId) ?? 'default',
        name: readString(parsedAccount.name) ?? null,
        configured: readBoolean(parsedAccount.configured) ?? null,
        linked: readBoolean(parsedAccount.linked) ?? null,
        running: readBoolean(parsedAccount.running) ?? null,
        connected: readBoolean(parsedAccount.connected) ?? null,
        lastConnectedAt: readNumber(parsedAccount.lastConnectedAt) ?? null,
        lastInboundAt: readNumber(parsedAccount.lastInboundAt) ?? null,
        lastOutboundAt: readNumber(parsedAccount.lastOutboundAt) ?? null,
        lastError: readString(parsedAccount.lastError) ?? null,
        lastStartAt: readNumber(parsedAccount.lastStartAt) ?? null,
        mode: readString(parsedAccount.mode) ?? null,
        probe: parsedAccount.probe ?? null,
        publicKey: readString(parsedAccount.publicKey) ?? null,
        profile: parsedAccount.profile ?? null,
      }
    })
  }

  return {
    channels,
    channelAccounts,
    channelOrder: order,
    channelLabels: labels,
    connected: true,
    updatedAt: readNumber(parsed?.ts),
  }
}

async function loadChannelsViaRpc(probe = false): Promise<ChannelsSnapshot> {
  const payload = await callOpenClawGateway<GatewayData>(
    'channels.status',
    { probe, timeoutMs: 8000 },
    probe ? 20000 : 15000,
  )
  return {
    ...transformGatewayChannels(payload),
    connected: true,
  }
}

async function loadChannelsViaCli(probe = false): Promise<ChannelsSnapshot> {
  const payload = await callOpenClawGateway<GatewayData>(
    'channels.status',
    { probe, timeoutMs: 8000 },
    probe ? 20000 : 15000,
  ).catch(() => null)

  if (payload) {
    return {
      ...transformGatewayChannels(payload),
      connected: true,
    }
  }

  const { runOpenClaw } = await import('@/lib/command')
  const args = ['channels', 'status', '--json', '--timeout', '5000']
  if (probe) args.push('--probe')
  const { stdout } = await runOpenClaw(args, { timeoutMs: probe ? 20000 : 15000 })
  return {
    ...transformGatewayChannels(JSON.parse(stdout)),
    connected: true,
  }
}

async function isGatewayReachable(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`${gatewayInternalUrl}/api/health`, {
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
        if (res.status === 404) {
          return NextResponse.json(await loadChannelsViaRpc(true).catch(() => loadChannelsViaCli(true)))
        }
        throw new Error(`Gateway channel probe failed with status ${res.status}`)
      }

      const data = await res.json()
      return NextResponse.json(data)
    } catch (err) {
      try {
        return NextResponse.json(await loadChannelsViaRpc(true).catch(() => loadChannelsViaCli(true)))
      } catch (cliErr) {
        logger.warn({ err, cliErr, channel }, 'Channel probe failed')
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
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(`${gatewayInternalUrl}/api/channels/status`, {
      headers: gatewayHeaders(),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      if (res.status === 404) {
        return NextResponse.json(await loadChannelsViaRpc(false).catch(() => loadChannelsViaCli(false)))
      }
      throw new Error(`Gateway channel status failed with status ${res.status}`)
    }

    const data = await res.json()
    return NextResponse.json(transformGatewayChannels(data))
  } catch (err) {
    try {
      return NextResponse.json(await loadChannelsViaRpc(false).catch(() => loadChannelsViaCli(false)))
    } catch (cliErr) {
      logger.warn({ err, cliErr }, 'Gateway unreachable for channel status')
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
    logger.warn({ err, action }, 'Channel action failed')
    return NextResponse.json(
      { ok: false, error: 'Gateway unreachable' },
      { status: 502 },
    )
  }
}
