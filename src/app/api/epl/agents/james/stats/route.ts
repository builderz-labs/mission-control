/**
 * GET /api/epl/agents/james/stats
 *
 * Proxies James's VPS /api/stats endpoint when reachable. Falls back to mock
 * so the agent tracker always renders a row. Follows the Sofia/Hugo pattern.
 *
 * When James adds /api/stats on the VPS, set JAMES_STATS_URL env on the MC
 * docker-compose and this endpoint flips from mock to live.
 *
 * Mock shape mirrors what James would expose:
 *   { agent: 'james', cash_position_gbp, pending_categorisation_count, ... }
 */

import { NextRequest, NextResponse } from 'next/server'
import { tryFetchAgentStats } from '../../_helpers'

const JAMES_STATS_URL = process.env.JAMES_STATS_URL || 'http://localhost:9101/api/stats'

const MOCK = {
  agent: 'james',
  cash_position_gbp_epl: 5182,
  cash_position_gbp_ur: 0,
  cash_position_gbp_staylio: 0,
  cash_position_gbp_nournest: 0,
  pending_categorisation_count: 0,
  reconciliation_hours_saved_this_week: 0,
  last_reconciliation_ts: new Date(Date.now() - 12 * 60 * 60_000).toISOString(),
  agent_status: 'online (mock)',
  open_blockers: 0,
}

export async function GET(_req: NextRequest) {
  const live = await tryFetchAgentStats(JAMES_STATS_URL)
  if (live && live.agent === 'james') {
    return NextResponse.json({ stats_source: 'live', stats_url: JAMES_STATS_URL, ...live })
  }
  return NextResponse.json({
    stats_source: 'mock',
    stats_url: JAMES_STATS_URL,
    note: 'James /api/stats endpoint not yet exposed on VPS. Mock data shown.',
    ...MOCK,
  })
}
