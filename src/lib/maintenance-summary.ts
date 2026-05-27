/**
 * Maintenance summary helper.
 *
 * Single source of truth for the "open tickets" snapshot consumed by both
 * /api/epl/maintenance?part=summary and the Today panel's KPI strip. Wraps
 * the Hugo /api/stats proxy (HUGO_STATS_URL) with a graceful mock fallback
 * so callers never have to branch on Hugo's deploy state.
 *
 * Both consumers want the same numbers — keeping the logic in one place
 * prevents the brief from contradicting itself (the bug that prompted this
 * helper: Today KPI said "Hugo offline" while the maintenance panel
 * already proxied live counts).
 *
 * Sub-ms when Hugo is offline (no network), <1.5s when live (timeout in
 * tryFetchAgentStats). Never throws.
 */

import { tryFetchAgentStats } from '@/app/api/epl/agents/_helpers'

export interface MaintenanceSummary {
  ok: true
  open_total: number
  open_p0: number
  open_p1: number
  awaiting_parts_aged_gt7d: number
  resolved_this_week: number
  hugo_status: 'live' | 'offline'
  hugo_stats_url: string
}

/**
 * Snapshot consistent with /api/epl/agents/hugo/stats self-stub and the
 * TICKETS mock in /api/epl/maintenance. Real Hugo replaces all of this
 * once HUGO_STATS_URL points at the real service.
 */
const MOCK_SUMMARY: Omit<MaintenanceSummary, 'hugo_stats_url'> = {
  ok: true,
  open_total: 11,
  open_p0: 1,
  open_p1: 3,
  awaiting_parts_aged_gt7d: 1,
  resolved_this_week: 1,
  hugo_status: 'offline',
}

export function hugoStatsUrl(): string {
  return process.env.HUGO_STATS_URL || 'http://localhost:8000/api/stats'
}

export async function getMaintenanceSummary(): Promise<MaintenanceSummary> {
  const url = hugoStatsUrl()
  const live = await tryFetchAgentStats(url)
  if (live && live.agent === 'hugo') {
    return {
      ok: true,
      open_total: typeof live.open === 'number' ? live.open : 0,
      open_p0: typeof live.open_p0 === 'number' ? live.open_p0 : 0,
      open_p1: typeof live.open_p1 === 'number' ? live.open_p1 : 0,
      awaiting_parts_aged_gt7d:
        typeof live.awaiting_parts_aged_gt7d === 'number' ? live.awaiting_parts_aged_gt7d : 0,
      resolved_this_week:
        typeof live.resolved_this_week === 'number' ? live.resolved_this_week : 0,
      hugo_status: 'live',
      hugo_stats_url: url,
    }
  }
  return { ...MOCK_SUMMARY, hugo_stats_url: url }
}

/**
 * KPI formatter for the Today panel's "Open maintenance tickets" card.
 * Compact enough for the 4-card strip; `delta` carries severity breakdown.
 */
export function maintenanceKpi(summary: MaintenanceSummary): {
  label: 'Open maintenance tickets'
  value: string
  delta: string
} {
  if (summary.hugo_status === 'offline') {
    return {
      label: 'Open maintenance tickets',
      value: 'unavailable',
      delta: 'Hugo offline',
    }
  }
  const parts: string[] = []
  if (summary.open_p0 > 0) parts.push(`${summary.open_p0} P0`)
  if (summary.open_p1 > 0) parts.push(`${summary.open_p1} P1`)
  const delta = parts.length > 0
    ? parts.join(' · ')
    : summary.awaiting_parts_aged_gt7d > 0
      ? `${summary.awaiting_parts_aged_gt7d} awaiting parts >7d`
      : `${summary.resolved_this_week} resolved this wk`
  return {
    label: 'Open maintenance tickets',
    value: String(summary.open_total),
    delta,
  }
}
