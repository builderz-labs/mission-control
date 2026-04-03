// Types for the Channels panel

export interface NostrProfile {
  name?: string | null
  displayName?: string | null
  about?: string | null
  picture?: string | null
  banner?: string | null
  website?: string | null
  nip05?: string | null
  lud16?: string | null
}

export interface ChannelStatus {
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
  probe?: {
    ok?: boolean
    status?: number
    error?: string
    elapsedMs?: number
    bot?: { username?: string; id?: string }
    team?: { id?: string; name?: string }
    webhook?: { url?: string }
    version?: string
  }
  profile?: NostrProfile
}

export interface ChannelAccount {
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
  probe?: { ok?: boolean; bot?: { username?: string }; [key: string]: unknown }
  publicKey?: string | null
  profile?: NostrProfile
}

export interface ChannelsSnapshot {
  channels: Record<string, ChannelStatus>
  channelAccounts: Record<string, ChannelAccount[]>
  channelOrder: string[]
  channelLabels: Record<string, string>
  connected: boolean
  updatedAt?: number
}

export type ActionResult = {
  ok?: boolean
  error?: string
  message?: string
  qrDataUrl?: string
  connected?: boolean
  persisted?: boolean
  merged?: NostrProfile
  imported?: NostrProfile
}

export interface PlatformCardProps {
  platform: string
  status?: ChannelStatus
  accounts: ChannelAccount[]
  onProbe: () => void
  probing: boolean
  onAction: (action: string, params: Record<string, unknown>) => Promise<unknown>
  actionBusy: boolean
}
