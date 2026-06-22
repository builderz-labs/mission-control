/**
 * GET /api/epl/today
 *
 * Aggregator endpoint for the Today panel. Returns Top 3 Actions, Agents
 * Overnight, KPIs, and Waiting-on-you in a single payload (or one part if
 * ?part= is provided).
 *
 * Rewired 22 Jun 2026 to read the tables Atlas's daily cron actually writes
 * (see src/lib/atlas-state.ts) instead of a heartbeat JSON file that was never
 * produced. There is NO silent mock fallback any more — when a source is empty
 * or offline, the payload says so via *_source flags and the panel renders an
 * honest empty/stale state.
 *
 * Wired sources:
 *   - actions / waiting → approvals table (status='pending') via atlas-approvals
 *   - agents            → agent_state table (git drift / commits-ahead / deploy)
 *   - kpis              → live Hugo /api/stats + kpi_snapshots (cash etc.)
 *                         + fleet sync derived from agent_state
 */

import { NextRequest, NextResponse } from 'next/server'
import { readPendingApprovals } from '@/lib/atlas-approvals'
import { getMaintenanceSummary, maintenanceKpi } from '@/lib/maintenance-summary'
import {
  readAgentStates,
  readLatestKpis,
  readFleetFreshness,
  formatAge,
  type AgentStateRow,
} from '@/lib/atlas-state'

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

interface AgentRow {
  name: string
  role: string
  actions: number
  status: 'ok' | 'review' | 'offline'
  headline: string
}

function agentRowFromState(s: AgentStateRow): AgentRow {
  const status: AgentRow['status'] = s.drift || s.commits_ahead > 0 ? 'review' : 'ok'
  const checked = formatAge(s.last_checked_at)
  let headline: string
  if (s.commits_ahead > 0) {
    headline = `${s.commits_ahead} commit${s.commits_ahead === 1 ? '' : 's'} ahead of VPS${s.drift ? ' · drift' : ''} · checked ${checked}`
  } else if (s.drift) {
    headline = `drift vs VPS · checked ${checked}`
  } else if (!s.has_vps) {
    headline = `local-only · checked ${checked}`
  } else {
    headline = `in sync · checked ${checked}`
  }
  if (s.open_items.length > 0) headline += ` · ${s.open_items.length} open`
  return { name: s.agent, role: agentRoleLabel(s.agent), actions: s.commits_ahead, status, headline }
}

interface Kpi {
  label: string
  value: string
  delta: string
  stale?: boolean
  source?: string
}

function gbp(n: number): string {
  return '£' + Math.round(n).toLocaleString('en-GB')
}

export async function GET(req: NextRequest) {
  const part = new URL(req.url).searchParams.get('part')

  const [maintenance] = await Promise.all([getMaintenanceSummary()])
  const agentState = readAgentStates()
  const kpiSnap = readLatestKpis()
  const approvals = readPendingApprovals(3)
  const freshness = readFleetFreshness()

  // ── Actions (Top 3) ← pending approvals; honest empty state otherwise ──
  const actions = approvals.cards.map((c) => ({
    id: c.id,
    title: c.title,
    why: c.why,
    cta: c.cta,
    deeplink: c.deeplink,
  }))
  const actions_source = approvals.source

  // ── Agents overnight ← agent_state (fleet git/deploy sync) ──
  const agentsOvernight: AgentRow[] = [...agentState.rows]
    .map(agentRowFromState)
    .sort((a, b) => {
      // review (needs deploy) first, then by commits ahead desc, then name
      if (a.status !== b.status) return a.status === 'review' ? -1 : 1
      if (b.actions !== a.actions) return b.actions - a.actions
      return a.name.localeCompare(b.name)
    })
  const agents_source = agentState.source

  // ── KPIs ──────────────────────────────────────────────────────────────
  // [0] maintenance (live Hugo, real)
  const maintenanceCard = maintenanceKpi(maintenance)

  // [1] cash runway / position from kpi_snapshots (flag staleness honestly)
  const cash = kpiSnap.byKey['cash_position_gbp'] ?? kpiSnap.byKey['cash_runway_days']
  let cashCard: Kpi
  if (cash && cash.value_num != null) {
    const stale = (cash.age_days ?? 0) > 3
    cashCard = {
      label: 'Cash position',
      value: gbp(cash.value_num),
      delta: stale
        ? `STALE · snapshot ${cash.age_days}d old (${cash.snapshot_date})`
        : `snapshot ${cash.snapshot_date}`,
      stale,
      source: 'kpi_snapshots',
    }
  } else {
    cashCard = { label: 'Cash position', value: '—', delta: 'no snapshot (Cleo not wired)', stale: true, source: 'unavailable' }
  }

  // [2] star rating — no live source yet (Iris unwired). Honest placeholder.
  const star = kpiSnap.byKey['avg_star_rating_30d']
  const starCard: Kpi = star && star.value_num != null
    ? { label: 'Avg star rating (30d)', value: star.value_num.toFixed(2), delta: `snapshot ${star.snapshot_date}`, source: 'kpi_snapshots' }
    : { label: 'Avg star rating (30d)', value: '—', delta: 'not wired (Iris)', stale: true, source: 'unavailable' }

  // [3] fleet sync — derived from agent_state (real)
  const driftCount = agentState.rows.filter((r) => r.drift || r.commits_ahead > 0).length
  const fleetCard: Kpi = agentState.source === 'atlas-db'
    ? {
        label: 'Fleet sync',
        value: driftCount === 0 ? 'all in sync' : `${driftCount} need deploy`,
        delta: `${approvals.pending_count} pending approval${approvals.pending_count === 1 ? '' : 's'}`,
        source: 'agent_state',
      }
    : { label: 'Fleet sync', value: '—', delta: 'atlas.db offline', stale: true, source: 'unavailable' }

  const kpis: Kpi[] = [maintenanceCard, cashCard, starCard, fleetCard]

  // ── Waiting on you ← pending approvals (same source as actions) ──
  const waitingOnYou = approvals.cards.map((c) => ({
    id: c.id,
    title: c.title,
    age: c.created_at ? formatAge(c.created_at) : '—',
    category: agentRoleLabel(c.agent),
    owner: c.agent.charAt(0).toUpperCase() + c.agent.slice(1),
  }))
  const waiting_source = approvals.source

  const enriched = {
    generatedAt: new Date().toISOString(),
    fleet: {
      dbConnected: freshness.dbConnected,
      dbPath: freshness.dbPath,
      lastBriefAt: freshness.lastBriefAt,
      lastBriefAge: freshness.lastBriefAt ? formatAge(freshness.lastBriefAt) : null,
      briefStale: (freshness.lastBriefAgeHours ?? 0) > 30,
    },
    actions,
    actions_source,
    agentsOvernight,
    agents_source,
    agents_last_checked: agentState.lastChecked,
    kpis,
    waitingOnYou,
    waiting_source,
  }

  if (part === 'actions') return NextResponse.json({ generatedAt: enriched.generatedAt, actions, actions_source })
  if (part === 'agents') return NextResponse.json({ generatedAt: enriched.generatedAt, agentsOvernight, agents_source, agents_last_checked: enriched.agents_last_checked })
  if (part === 'kpis') return NextResponse.json({ generatedAt: enriched.generatedAt, kpis })
  if (part === 'waiting') return NextResponse.json({ generatedAt: enriched.generatedAt, waitingOnYou, waiting_source })
  if (part === 'summary') return NextResponse.json({ generatedAt: enriched.generatedAt, ok: true, fleet: enriched.fleet, actions_source, agents_source, waiting_source })
  return NextResponse.json(enriched)
}
