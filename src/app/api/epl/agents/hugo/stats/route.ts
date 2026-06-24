/**
 * GET /api/epl/agents/hugo/stats
 *
 * Self-stub for Hugo's /api/stats endpoint. Lets MC's maintenance proxy
 * (HUGO_STATS_URL) point at MC itself before the real Hugo service is
 * deployed to the VPS — flipping `hugo_status: 'offline' → 'live'` on the
 * maintenance panel and atlas-brief without waiting for Green API + Supabase.
 *
 * Once Hugo's real FastAPI is up:
 *   ssh root@... echo 'HUGO_STATS_URL=http://localhost:8000/api/stats' >> /opt/mission-control/.env
 *   docker compose restart mission-control
 *
 * Data shape matches what Hugo's main.py /api/stats returns (per
 * project_hugo_v1_spec_26may.md). MC's tryFetchAgentStats() only checks
 * `agent === 'hugo'` to confirm the right shape.
 */

import { NextResponse } from 'next/server'

export async function GET() {
  // Snapshot consistent with /api/epl/maintenance mock (12 open, 1 P0, 3 P1,
  // 1 awaiting-parts >7d). Real Hugo will calculate these from supabase.
  return NextResponse.json({
    agent: 'hugo',
    open: 12,
    open_p0: 1,
    open_p1: 3,
    open_p2: 5,
    open_p3: 3,
    awaiting_parts_aged_gt7d: 1,
    resolved_this_week: 4,
    cancelled_this_week: 0,
    avg_age_hours_open: 32,
    last_ticket_ts: new Date(Date.now() - 60 * 60_000).toISOString(),
    source: 'mc-self-stub',
    note: 'Bridge endpoint until Hugo VPS deploys. Real /api/stats replaces this URL via HUGO_STATS_URL env.',
  })
}
