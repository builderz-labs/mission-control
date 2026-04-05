// Utility functions for nodes-panel components

import type { PresenceEntry } from './nodes-panel-types'

/** Convert a unix timestamp (seconds or ms) to a human-readable relative string */
export function relativeTime(ts: number): string {
  if (!ts) return '--'
  const now = Date.now()
  const diffMs = now - (ts < 1e12 ? ts * 1000 : ts)
  if (diffMs < 0) return 'just now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/** Return Tailwind classes for a presence status badge */
export function statusColor(status: PresenceEntry['status']): string {
  switch (status) {
    case 'online': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'idle':   return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'offline': return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
    default:       return 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
  }
}

/** Fire a POST /api/nodes action and return a typed result */
export async function deviceAction(
  action: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch('/api/nodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params }),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json() as Record<string, unknown>
    if (!res.ok) return { ok: false, error: (data.error as string) || `Request failed (${res.status})` }
    return { ok: true, data }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}
