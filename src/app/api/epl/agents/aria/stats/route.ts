/**
 * GET /api/epl/agents/aria/stats
 *
 * Proxies Aria's VPS /api/stats endpoint when reachable. Falls back to mock
 * so the agent tracker always renders a row. Follows the Sofia/Hugo pattern.
 *
 * When Aria adds /api/stats on the VPS, set ARIA_STATS_URL env on the MC
 * docker-compose and this endpoint flips from mock to live.
 *
 * Mock shape mirrors what Aria would expose:
 *   { agent: 'aria', last_refresh_ts, properties_refreshed, portfolio_p50_gbp, ... }
 */

import { NextRequest, NextResponse } from 'next/server'
import { tryFetchAgentStats } from '../../_helpers'

const ARIA_STATS_URL = process.env.ARIA_STATS_URL || 'http://localhost:9102/api/stats'

const MOCK = {
  agent: 'aria',
  last_refresh_ts: new Date(Date.now() - 6 * 60 * 60_000).toISOString(),
  properties_refreshed: 50,
  properties_total: 50,
  portfolio_p50_gbp: 197.8,
  outliers_above_p90_count: 3,
  outliers_below_p25_count: 3,
  cache_md5: 'b5f2cddc864c',
  cache_parity_mac_vps: true,
  agent_status: 'online (mock)',
  open_blockers: 0,
}

export async function GET(_req: NextRequest) {
  const live = await tryFetchAgentStats(ARIA_STATS_URL)
  if (live && live.agent === 'aria') {
    return NextResponse.json({ stats_source: 'live', stats_url: ARIA_STATS_URL, ...live })
  }
  return NextResponse.json({
    stats_source: 'mock',
    stats_url: ARIA_STATS_URL,
    note: 'Aria /api/stats endpoint not yet exposed on VPS. Mock data shown.',
    ...MOCK,
  })
}
