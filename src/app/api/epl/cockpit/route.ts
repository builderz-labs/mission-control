/**
 * GET /api/epl/cockpit
 *
 * Agent-cockpit read model — Phase 1 (read-only). Returns ONE Atlas export:
 *   - timeline     swimlanes per agent (status across a rolling week window)
 *   - agent_feed   hand-off chips (from → to + summary + cost)
 *   - tools        per-agent connector list
 *   - conversations per-conversation cost / turns
 *
 * Source of truth: Atlas writes /opt/atlas/data/mc_cockpit.json, mounted into
 * the MC container read-only at /atlas-data/mc_cockpit.json (see docker-compose).
 *
 * The Atlas exporter is built in parallel, so the file may not exist yet. This
 * route MUST handle that gracefully: a missing/invalid file yields a graceful
 * EMPTY payload (source:'empty'), never a 500 and never fabricated data — same
 * "no silent mock" discipline as /api/epl/agents.
 *
 * Read-only this phase: no writes, no polling, no always-on process.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readCockpit } from '@/lib/atlas-cockpit'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const part = url.searchParams.get('part')

  const cockpit = await readCockpit()

  if (part === 'summary') {
    const handoffCost = cockpit.agent_feed.reduce((s, e) => s + (e.cost_usd ?? 0), 0)
    const convCost = cockpit.conversations.reduce((s, c) => s + (c.cost_usd ?? 0), 0)
    return NextResponse.json({
      ok: true,
      source: cockpit.source,
      generated_at: cockpit.generated_at,
      week_now: cockpit.week_now,
      lane_count: cockpit.timeline.length,
      item_count: cockpit.timeline.reduce((s, l) => s + l.items.length, 0),
      feed_count: cockpit.agent_feed.length,
      tool_agents: cockpit.tools.length,
      conversation_count: cockpit.conversations.length,
      handoff_cost_usd: Number(handoffCost.toFixed(4)),
      conversation_cost_usd: Number(convCost.toFixed(4)),
    })
  }

  return NextResponse.json(cockpit)
}
