/**
 * Shared helpers for /api/epl/agents.
 *
 * tryFetchAgentStats(url) — fetch an agent's /api/stats with timeout + graceful
 * degrade. Returns null on any failure (network, timeout, non-2xx, JSON parse).
 *
 * ROADMAP_AGES — staleness map per agent. Edward's Friday scan keeps this
 * honest; until that's wired, manual snapshot of last-edit age.
 */

export interface AgentStats {
  agent: string
  open?: number
  open_p0?: number
  open_p1?: number
  awaiting_parts_aged_gt7d?: number
  resolved_this_week?: number
  [k: string]: unknown
}

const STATS_TIMEOUT_MS = 1500

/**
 * Internal MC self-calls (e.g. when HUGO_STATS_URL points at MC itself as a
 * bridge stub) need to carry MC's API key so the auth middleware lets the
 * server-side fetch through. External agents (real Hugo on localhost:8000)
 * shouldn't need it, but injecting an extra header is harmless if they
 * don't enforce it.
 */
function isMcSelfUrl(url: string): boolean {
  const internal = (process.env.MC_INTERNAL_URL ?? '').replace(/\/$/, '')
  if (internal && url.startsWith(internal)) return true
  // Heuristic: anything pointing at our own port = self.
  const port = process.env.PORT || '3000'
  return url.includes(`://127.0.0.1:${port}`) || url.includes(`://localhost:${port}`)
}

export async function tryFetchAgentStats(url: string): Promise<AgentStats | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), STATS_TIMEOUT_MS)
    const headers: Record<string, string> = {}
    if (isMcSelfUrl(url) && process.env.API_KEY) {
      headers['x-api-key'] = process.env.API_KEY
    }
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store', headers })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    return data as AgentStats
  } catch {
    return null
  }
}

/**
 * Days since each agent's ROADMAP.md was last edited.
 *
 * Snapshot maintained by the session that refreshes any agent's ROADMAP.
 * Bump that agent's entry to 0 in the same commit that touches the ROADMAP.
 *
 * TODO (drift class): replace this map with a live source.
 *   Option A — each agent's /api/stats returns roadmap_age_days (cleanest,
 *     scales with the per-agent stats proxy pattern already in place).
 *   Option B — Atlas hourly cron writes roadmap_ages.json to /opt/atlas/data
 *     (volume-mounted into MC docker), helper reads it.
 *   Option C — volume-mount each agent's ~/<name>/ROADMAP.md into MC docker
 *     and stat() it here. Most direct but couples MC to agent filesystems.
 */
export const ROADMAP_AGES: Record<string, number> = {
  sofia:    0,    // refreshed 27 May (drafter legal-status guard + agent/ archive)
  james:    1,
  leo:      9,    // stale
  victoria: 8,    // stale
  aria:     1,
  marcus:   2,
  atlas:    0,    // exemplary
  edward:   0,    // refreshed 27 May (registry-gap detector shipped 27d99e0)
  cleo:     3,
  iris:     0,    // refreshed 27 May (Guest Experience Loop v2 architecture)
  larry:    0,    // exemplary
  nina:     8,    // stale
  nathan:   8,    // misnamed (~/iris/rfp_response/NATHAN_ROADMAP.md)
  hugo:     0,    // created this session
  owen:     0,    // created this session
}
