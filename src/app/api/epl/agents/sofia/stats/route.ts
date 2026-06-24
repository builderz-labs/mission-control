/**
 * GET /api/epl/agents/sofia/stats
 *
 * Proxies Sofia's VPS /api/stats endpoint when reachable. Falls back to mock
 * so the agent tracker always renders a row. Proves the agent-stats pattern
 * works for any agent (not just Hugo) — same shape as
 * /api/epl/agents/[name] but Sofia-specific.
 *
 * When Sofia adds /api/stats on her PM2 process, set SOFIA_STATS_URL env on
 * the MC VPS docker-compose and this endpoint flips from mock to live.
 *
 * Mock shape mirrors what Sofia would expose:
 *   { agent: 'sofia', drafts_queued, drafts_sent_today, threads_classified, ... }
 */

import { NextRequest, NextResponse } from 'next/server'
import { tryFetchAgentStats } from '../../_helpers'

const SOFIA_STATS_URL = process.env.SOFIA_STATS_URL || 'http://localhost:9100/api/stats'

const MOCK = {
  agent: 'sofia',
  drafts_queued: 8,
  drafts_sent_today: 0,
  threads_classified_24h: 47,
  threads_skipped_24h: 12,
  last_classification: new Date(Date.now() - 14 * 60_000).toISOString(),
  pm2_status: 'online (mock)',
  open_blockers: 0,
}

export async function GET(req: NextRequest) {
  const live = await tryFetchAgentStats(SOFIA_STATS_URL)
  if (live && live.agent === 'sofia') {
    return NextResponse.json({ stats_source: 'live', stats_url: SOFIA_STATS_URL, ...live })
  }
  return NextResponse.json({
    stats_source: 'mock',
    stats_url: SOFIA_STATS_URL,
    note: 'Sofia /api/stats endpoint not yet exposed on PM2. Mock data shown.',
    ...MOCK,
  })
}
