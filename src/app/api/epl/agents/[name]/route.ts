/**
 * GET /api/epl/agents/[name]
 *
 * Per-agent detail. Tries the agent's live /api/stats first (with timeout),
 * falls back to fleet snapshot if offline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { tryFetchAgentStats, ROADMAP_AGES } from '../_helpers'

const KNOWN_STATS_URLS: Record<string, string> = {
  hugo: process.env.HUGO_STATS_URL || 'http://localhost:8000/api/stats',
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  const url = KNOWN_STATS_URLS[name]
  const live = url ? await tryFetchAgentStats(url) : null

  return NextResponse.json({
    name,
    roadmap_age_days: ROADMAP_AGES[name] ?? null,
    stats_source: live ? 'live' : 'mock',
    stats_url: url ?? null,
    stats: live ?? {
      agent: name,
      note: 'Agent /api/stats not wired or offline. Returning placeholder.',
    },
  })
}
