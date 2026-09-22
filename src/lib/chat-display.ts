export function firstName(displayName: string | null | undefined, fallback = 'there'): string {
  const trimmed = (displayName || '').trim()
  if (!trimmed) return fallback
  const token = trimmed.split(/\s+/)[0]
  return token || fallback
}

export function workingDirLeaf(path: string | null | undefined): string {
  if (!path) return ''
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export function toActivityMs(value: number | undefined | null): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 0
  return value > 1_000_000_000_000 ? value : value * 1000
}

export function relativeTime(fromSeconds: number, nowMs = Date.now()): string {
  if (!fromSeconds) return ''
  const thenMs = toActivityMs(fromSeconds)
  const diff = Math.max(0, nowMs - thenMs)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 28) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

export type SessionStatusPill = 'ready_for_review' | 'needs_input' | 'idle' | 'active'

export function sessionStatusPill(input: {
  active?: boolean
  hasPr?: boolean
  prState?: string | null
}): SessionStatusPill {
  const pr = (input.prState || '').toLowerCase()
  if (pr === 'open' || input.hasPr) return 'ready_for_review'
  if (input.active) return 'active'
  return 'idle'
}

export type PullStatus = 'open' | 'closed' | 'merged'

export function pullStatusLabel(state: PullStatus): string {
  if (state === 'merged') return 'Merged'
  if (state === 'closed') return 'Closed'
  return 'Ready for review'
}

export function modelPickerLabel(alias: string, name: string): string {
  const id = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name
  const claude = id.match(/^claude-(haiku|sonnet|opus)-(.+)$/i)
  if (claude) {
    const family = claude[1][0].toUpperCase() + claude[1].slice(1)
    return `${family} ${claude[2].replace(/-/g, '.')}`
  }
  return alias
}

export function parsePins(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

export function togglePin(pins: string[], slug: string): string[] {
  if (pins.includes(slug)) return pins.filter((item) => item !== slug)
  return [...pins, slug]
}
