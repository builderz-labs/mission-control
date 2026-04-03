// Pure helper functions for the Channels panel
import type { ChannelStatus, ChannelAccount, ActionResult, NostrProfile } from './types'

export function relativeTime(ts: number | null | undefined): string {
  if (ts == null) return 'n/a'
  const now = Date.now()
  const diff = Math.max(0, now - ts)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return 'n/a'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export function truncatePubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return 'n/a'
  if (pubkey.length <= 20) return pubkey
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
}

export function yesNo(val: boolean | null | undefined): string {
  if (val == null) return 'n/a'
  return val ? 'Yes' : 'No'
}

export function channelIsActive(
  status: ChannelStatus | undefined,
  accounts: ChannelAccount[],
): boolean {
  if (!status) return false
  if (status.configured || status.running || status.connected) return true
  return accounts.some(a => a.configured || a.running || a.connected)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

export function readActionResult(value: unknown): ActionResult | null {
  const record = asRecord(value)
  if (!record) return null

  const readProfile = (candidate: unknown): NostrProfile | undefined => {
    const profile = asRecord(candidate)
    if (!profile) return undefined
    return {
      name: typeof profile.name === 'string' ? profile.name : null,
      displayName: typeof profile.displayName === 'string' ? profile.displayName : null,
      about: typeof profile.about === 'string' ? profile.about : null,
      picture: typeof profile.picture === 'string' ? profile.picture : null,
      banner: typeof profile.banner === 'string' ? profile.banner : null,
      website: typeof profile.website === 'string' ? profile.website : null,
      nip05: typeof profile.nip05 === 'string' ? profile.nip05 : null,
      lud16: typeof profile.lud16 === 'string' ? profile.lud16 : null,
    }
  }

  return {
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    error: typeof record.error === 'string' ? record.error : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
    qrDataUrl: typeof record.qrDataUrl === 'string' ? record.qrDataUrl : undefined,
    connected: typeof record.connected === 'boolean' ? record.connected : undefined,
    persisted: typeof record.persisted === 'boolean' ? record.persisted : undefined,
    merged: readProfile(record.merged),
    imported: readProfile(record.imported),
  }
}
