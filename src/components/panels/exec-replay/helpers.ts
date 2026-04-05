// ─── Utility helpers ──────────────────────────────────────────────────────────

/** Returns a human-readable "time ago" string from a Unix timestamp (seconds). */
export function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts * 1000) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** Attempts JSON.parse; falls back to the raw string on failure. */
export function tryParseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return raw }
}
