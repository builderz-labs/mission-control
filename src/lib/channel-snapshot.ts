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

export interface ChannelsSnapshot {
  channels: Record<string, ChannelStatus>
  channelAccounts: Record<string, ChannelAccount[]>
  channelOrder: string[]
  channelLabels: Record<string, string>
  connected: boolean
  updatedAt?: number
}

export function transformGatewayChannels(data: GatewayData): ChannelsSnapshot {
  const parsed = asRecord(data)
  const rawChannels = asRecord(parsed?.channels) ?? {}
  const rawAccounts = asRecord(parsed?.channelAccounts) ?? {}
  const channelLabels = asRecord(parsed?.channelLabels)
  const order = Array.isArray(parsed?.channelOrder)
    ? parsed.channelOrder.filter((value): value is string => typeof value === 'string')
    : Object.keys(rawChannels)

  const channels: Record<string, ChannelStatus> = Object.create(null)
  const channelAccounts: Record<string, ChannelAccount[]> = Object.create(null)
  const labels: Record<string, string> = Object.fromEntries(
    Object.entries(channelLabels ?? {}).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : [])
  )

  for (const key of order) {
    if (!Object.hasOwn(rawChannels, key)) continue
    const channel = asRecord(rawChannels[key])
    if (!channel) continue

    channels[key] = {
      configured: !!readBoolean(channel.configured),
      linked: readBoolean(channel.linked),
      running: !!readBoolean(channel.running),
      connected: readBoolean(channel.connected),
      lastConnectedAt: readNumber(channel.lastConnectedAt) ?? null,
      lastMessageAt: readNumber(channel.lastMessageAt) ?? null,
      lastStartAt: readNumber(channel.lastStartAt) ?? null,
      lastError: readString(channel.lastError) ?? null,
      authAgeMs: readNumber(channel.authAgeMs) ?? null,
      mode: readString(channel.mode) ?? null,
      baseUrl: readString(channel.baseUrl) ?? null,
      publicKey: readString(channel.publicKey) ?? null,
      probe: channel.probe ?? null,
      profile: channel.profile ?? null,
    }

    const accounts = Object.hasOwn(rawAccounts, key) ? rawAccounts[key] : []
    const accountRecord = asRecord(accounts)
    const accountEntries = Array.isArray(accounts)
      ? accounts
      : accountRecord ? Object.values(accountRecord) : []
    channelAccounts[key] = accountEntries.map((account) => {
      const parsedAccount = asRecord(account) ?? {}
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
