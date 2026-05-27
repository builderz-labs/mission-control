/**
 * GET /api/epl/today
 *
 * Aggregator endpoint for the Today panel. Returns Top 3 Actions, Agents Overnight,
 * KPIs, and Waiting-on-you in a single payload (or one part if ?part= is provided).
 *
 * Wired sources (TODO post-Phase 1):
 *   - actions  → atlas.db + sofia urgency queue
 *   - agents   → mc-cli `agents list --json` (calls registered MCs)
 *   - kpis     → atlas /api/stats + hugo /api/stats + james monthly P&L
 *   - waiting  → decisions.yaml filtered by status=open AND age >0d
 *
 * Currently returns canonical mock data that matches /mockup/today-panel-preview.html
 * exactly. Replace with real fetches as each upstream lands.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readHeartbeat, heartbeatAgentMap, type AtlasHeartbeatAgent } from '@/lib/atlas-heartbeat'
import { readPendingApprovals } from '@/lib/atlas-approvals'
import { getMaintenanceSummary, maintenanceKpi } from '@/lib/maintenance-summary'

function agentRoleLabel(name: string): string {
  const m: Record<string, string> = {
    sofia: 'PA', james: 'Finance', leo: 'Marketing', victoria: 'Revenue',
    aria: 'Pricing', marcus: 'Compliance', atlas: 'CoS', edward: 'Meta',
    cleo: 'Cash', iris: 'QA', larry: 'Landlord', nina: 'Onboarding',
    nathan: 'Acquisition', hugo: 'Maint', owen: 'Research', mila: 'Health',
    'urban-ready': 'Wholesale',
  }
  return m[name] ?? 'Agent'
}

function agentRowFromHb(hb: AtlasHeartbeatAgent) {
  const status = hb.status === 'live' ? 'ok' : hb.status === 'offline' ? 'offline' : 'review'
  return {
    name: hb.name,
    role: agentRoleLabel(hb.name),
    actions: hb.tasks_today,
    status: status as 'ok' | 'review' | 'offline',
    headline: hb.last_action
      ? `${hb.tasks_today} tasks · $${hb.cost_today_usd.toFixed(2)} · last: ${hb.last_action}`
      : `${hb.tasks_today} tasks today · $${hb.cost_today_usd.toFixed(2)}`,
  }
}

const MOCK = {
  generatedAt: new Date().toISOString(),
  actions: [
    { id: 'A1', title: 'Approve Hill House counter-offer wording', why: 'Larry pack ready · landlord call 11:00', cta: 'Open in Decisions', deeplink: '/decisions?id=R3' },
    { id: 'A2', title: 'Confirm 8 RRA receipts to Nathalie', why: 'Friday 10:00 call · 8 receipts queued in Sofia', cta: 'Open Sofia drafts', deeplink: '/chat?agent=sofia' },
    { id: 'A3', title: 'Sign Pacific Estates VAUXHALL draft', why: 'Larry escalation tier · Arianne cc · Atlas waiting', cta: 'Approve in Decisions', deeplink: '/decisions?id=R1' },
  ],
  agentsOvernight: [
    { name: 'Sofia',    role: 'PA',        actions: 14, status: 'ok',     headline: '8 drafts queued for Gerda · 0 sent' },
    { name: 'Atlas',    role: 'CoS',       actions: 11, status: 'ok',     headline: '3 standup posts · 2 Slack relays' },
    { name: 'James',    role: 'Finance',   actions: 6,  status: 'ok',     headline: 'Q1 P&L refresh complete · 1 anomaly flagged' },
    { name: 'Aria',     role: 'Pricing',   actions: 4,  status: 'review', headline: 'PriceLabs sync · waiting on Hanna replacement to approve' },
    { name: 'Larry',    role: 'Landlord',  actions: 3,  status: 'ok',     headline: '6h scan: 1 trigger fired · 2 suppressed' },
    { name: 'Hugo',     role: 'Maint',     actions: 0,  status: 'offline', headline: 'Phase 1 — pending VPS deploy + Green API signup' },
    { name: 'Edward',   role: 'Meta',      actions: 2,  status: 'ok',     headline: 'Friday scan queued · 1 roadmap-stale flag for Sofia' },
  ],
  kpis: [
    { label: 'Open maintenance tickets', value: 'unavailable', delta: 'Hugo offline' },
    { label: 'Cash runway',              value: '14d ok',      delta: '+£3.2k vs forecast' },
    { label: 'Avg star rating (30d)',    value: '4.71',        delta: '−0.04 vs Apr (Iris)' },
    { label: 'Active flats',             value: '50',          delta: '+2 (SHOREDITCH_3, FIVE_BALFOUR_FLAT_2)' },
  ],
  waitingOnYou: [
    { id: 'R1',  title: 'Pacific Estates VAUXHALL draft approval',      age: '2d',  category: 'Landlord',     owner: 'Larry' },
    { id: 'R3',  title: 'Hill House counter-offer wording',              age: '4d',  category: 'Acquisition',  owner: 'Nathan' },
    { id: 'R7',  title: 'Owen agent — approve name + share v2 sheet',    age: '0d',  category: 'Agent build',  owner: 'Owen' },
    { id: 'R11', title: 'Hanna replacement JDs — set salary bands',      age: '0d',  category: 'Hiring',       owner: 'Gerda' },
    { id: 'R14', title: 'AI Policies v1 — approve P01/P07/P12 LIVE',     age: '0d',  category: 'Governance',   owner: 'Atlas' },
  ],
}

export async function GET(req: NextRequest) {
  const part = new URL(req.url).searchParams.get('part')

  // Try real heartbeat — overlay agentsOvernight + 1 KPI if present.
  // Try Hugo maintenance summary — overlay KPI[0] when live.
  // Try real approvals from atlas.db — overlay actions when ≥1 pending.
  const [hb, maintenance] = await Promise.all([readHeartbeat(), getMaintenanceSummary()])
  const hbMap = heartbeatAgentMap(hb)
  const approvals = readPendingApprovals(3)
  const useRealActions = approvals.source === 'atlas-db' && approvals.cards.length > 0
  const actions = useRealActions
    ? approvals.cards.map(c => ({
        id: c.id,
        title: c.title,
        why: c.why,
        cta: c.cta,
        deeplink: c.deeplink,
      }))
    : MOCK.actions

  // Build agentsOvernight: prefer heartbeat rows when available; else mock.
  let agentsOvernight = MOCK.agentsOvernight
  if (hb && hb.agents.length > 0) {
    // Show the 7 most-active agents (or all if fewer), heartbeat-sourced.
    const ranked = [...hb.agents]
      .filter(a => a.name && a.status !== 'offline')
      .sort((a, b) => (b.tasks_today + (b.last_action ? 1 : 0)) - (a.tasks_today + (a.last_action ? 1 : 0)))
      .slice(0, 7)
      .map(agentRowFromHb)
    if (ranked.length > 0) agentsOvernight = ranked
  }

  // KPI strip: replace KPI[0] with live maintenance summary (Hugo proxy).
  // Replace KPI[3] (Active flats) with live spend if heartbeat present.
  const maintenanceCard = maintenanceKpi(maintenance)
  let kpis: typeof MOCK.kpis = [maintenanceCard, ...MOCK.kpis.slice(1)]
  if (hb) {
    kpis = [
      ...kpis.slice(0, 3),
      { label: 'Agent spend today', value: `$${hb.spend_today_usd.toFixed(2)}`, delta: `${hb.pending_approvals} pending approval${hb.pending_approvals === 1 ? '' : 's'}` },
    ]
  }

  const enriched = {
    generatedAt: new Date().toISOString(),
    actions,
    agentsOvernight,
    kpis,
    waitingOnYou: MOCK.waitingOnYou,
    heartbeat_source: hb ? 'atlas-live' : 'mock',
    heartbeat_ts: hb?.timestamp ?? null,
    actions_source: useRealActions ? 'atlas-db' : 'mock',
    actions_db_pending_count: approvals.source === 'atlas-db' ? approvals.pending_count : null,
    maintenance_source: maintenance.hugo_status === 'live' ? 'hugo-live' : 'mock',
  }

  if (part === 'actions')   return NextResponse.json({ generatedAt: enriched.generatedAt, actions: enriched.actions, actions_source: enriched.actions_source, actions_db_pending_count: enriched.actions_db_pending_count })
  if (part === 'agents')    return NextResponse.json({ generatedAt: enriched.generatedAt, agentsOvernight: enriched.agentsOvernight, heartbeat_source: enriched.heartbeat_source })
  if (part === 'kpis')      return NextResponse.json({ generatedAt: enriched.generatedAt, kpis: enriched.kpis })
  if (part === 'waiting')   return NextResponse.json({ generatedAt: enriched.generatedAt, waitingOnYou: enriched.waitingOnYou })
  if (part === 'summary')   return NextResponse.json({ generatedAt: enriched.generatedAt, ok: true, heartbeat_source: enriched.heartbeat_source, actions_source: enriched.actions_source, parts: ['actions', 'agents', 'kpis', 'waiting'] })
  return NextResponse.json(enriched)
}
