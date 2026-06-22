/**
 * GET /api/epl/agents
 *
 * Agent fleet tracker — Gerda's earlier ask: "tracker for agents since none existed".
 * Returns all 15 agents with status, role, phase, ROADMAP staleness, KPI count, last action.
 *
 * Per-agent detail at /api/epl/agents/[name]/route.ts.
 *
 * Wire when each agent's /api/stats lands:
 *   - hugo  → already wired via fetchAgentStats() (see ./agents/hugo logic in fetcher)
 *   - atlas → atlas.db readers (TODO)
 *   - sofia → /opt/sofia/api/stats (TODO)
 *   - others → mock until each agent ships /api/stats
 *
 * Source of truth for the roster: ~/.claude/CLAUDE.md "Project directories" table
 * + ~/.claude/projects/-Users-gerdamicke/memory/reference_team_roster.md.
 */

import { NextRequest, NextResponse } from 'next/server'
import { tryFetchAgentStats, ROADMAP_AGES } from './_helpers'
import { readHeartbeat, heartbeatAgentMap } from '@/lib/atlas-heartbeat'
import { readAgentStates, formatAge } from '@/lib/atlas-state'

interface AgentRow {
  name: string
  role: string
  category: 'PA' | 'Finance' | 'Marketing' | 'Revenue' | 'Pricing' | 'Compliance' | 'CoS' | 'Meta' | 'Cash' | 'QA' | 'Landlord' | 'Onboarding' | 'Acquisition' | 'Maintenance' | 'Research' | 'Health'
  phase: string
  status: 'ok' | 'review' | 'offline' | 'blocked'
  last_action: string  // ISO or relative
  roadmap_age_days: number
  kpi_count: number
  headline: string
  stats_url?: string  // URL of /api/stats if live
  stats_source: 'live' | 'mock'
}

const FALLBACK: AgentRow[] = [
  { name: 'sofia',     role: 'Email PA',                category: 'PA',           phase: 'v3 live',       status: 'ok',      last_action: '2026-05-26T16:00:00Z', roadmap_age_days: ROADMAP_AGES.sofia,    kpi_count: 4, headline: '8 drafts queued · 0 sent', stats_source: 'mock' },
  { name: 'james',     role: 'Finance / P&L',           category: 'Finance',      phase: 'v2 live',       status: 'ok',      last_action: '2026-05-26T14:30:00Z', roadmap_age_days: ROADMAP_AGES.james,    kpi_count: 6, headline: 'Q1 P&L refresh complete · 1 anomaly flagged', stats_source: 'mock' },
  { name: 'leo',       role: 'Marketing / GEO',         category: 'Marketing',    phase: 'v1 live',       status: 'review',  last_action: '2026-05-24T10:00:00Z', roadmap_age_days: ROADMAP_AGES.leo,      kpi_count: 3, headline: '2 SEO posts pending Gerda review', stats_source: 'mock' },
  { name: 'victoria',  role: 'Revenue / direct',        category: 'Revenue',      phase: 'v1 live',       status: 'review',  last_action: '2026-05-25T09:00:00Z', roadmap_age_days: ROADMAP_AGES.victoria, kpi_count: 4, headline: 'ROADMAP stale (8d)', stats_source: 'mock' },
  { name: 'aria',      role: 'Pricing / PriceLabs',     category: 'Pricing',      phase: 'v2 live',       status: 'review',  last_action: '2026-05-26T11:00:00Z', roadmap_age_days: ROADMAP_AGES.aria,     kpi_count: 5, headline: 'Waiting on Hanna replacement to approve syncs', stats_source: 'mock' },
  { name: 'marcus',    role: 'Compliance / legal',      category: 'Compliance',   phase: 'v1 live',       status: 'ok',      last_action: '2026-05-25T16:00:00Z', roadmap_age_days: ROADMAP_AGES.marcus,   kpi_count: 3, headline: '13 May TBD compensation still in force', stats_source: 'mock' },
  { name: 'atlas',     role: 'Chief of Staff',          category: 'CoS',          phase: 'v2 live',       status: 'ok',      last_action: '2026-05-26T16:30:00Z', roadmap_age_days: ROADMAP_AGES.atlas,    kpi_count: 8, headline: '3 standups + 2 Slack relays + 1 Larry scan', stats_source: 'mock' },
  { name: 'edward',    role: 'Meta systems architect',  category: 'Meta',         phase: 'v1 live',       status: 'review',  last_action: '2026-05-27T00:15:00Z', roadmap_age_days: ROADMAP_AGES.edward,   kpi_count: 2, headline: 'Registry-gap detector shipped · 5 proposals awaiting Gerda', stats_source: 'mock' },
  { name: 'cleo',      role: 'Cash Flow Guardian',      category: 'Cash',         phase: 'v1 live',       status: 'ok',      last_action: '2026-05-26T08:00:00Z', roadmap_age_days: ROADMAP_AGES.cleo,     kpi_count: 4, headline: '14-day forecast +£3.2k vs plan', stats_source: 'mock' },
  { name: 'iris',      role: 'Property QA / Guest',     category: 'QA',           phase: 'v2 live',       status: 'review',  last_action: '2026-05-25T19:00:00Z', roadmap_age_days: ROADMAP_AGES.iris,     kpi_count: 5, headline: 'Phase 2a paused — Zain Euston 1 sample pending', stats_source: 'mock' },
  { name: 'larry',     role: 'Landlord Relations',      category: 'Landlord',     phase: 'v2b done',      status: 'ok',      last_action: '2026-05-26T13:00:00Z', roadmap_age_days: ROADMAP_AGES.larry,    kpi_count: 6, headline: '5 sibling accessors complete · scan-triggers live', stats_source: 'mock' },
  { name: 'nina',      role: 'Onboarding (50-task)',    category: 'Onboarding',   phase: 'v1 live',       status: 'review',  last_action: '2026-05-24T15:00:00Z', roadmap_age_days: ROADMAP_AGES.nina,     kpi_count: 3, headline: '2 new flats in pipeline (Shoreditch + Balfour)', stats_source: 'mock' },
  { name: 'nathan',    role: 'Deal analysis (RFP)',     category: 'Acquisition',  phase: 'v1 live',       status: 'review',  last_action: '2026-05-26T12:00:00Z', roadmap_age_days: ROADMAP_AGES.nathan,   kpi_count: 4, headline: 'Hill House counter-offer drafted · ROADMAP misnamed', stats_source: 'mock' },
  { name: 'hugo',      role: 'Maintenance dispatch',    category: 'Maintenance',  phase: '1 live (VPS)',   status: 'ok',      last_action: '2026-06-08T20:50:00Z', roadmap_age_days: ROADMAP_AGES.hugo,     kpi_count: 5, headline: 'LIVE on VPS — feed pollers → WhatsApp; sentiment/SLA held (seed; /api/stats svc not up)', stats_url: process.env.HUGO_STATS_URL || 'http://localhost:8000/api/stats', stats_source: 'mock' },
  { name: 'owen',      role: 'Guest-area research',     category: 'Research',     phase: '2a shipped',    status: 'ok',      last_action: '2026-05-26T17:00:00Z', roadmap_age_days: ROADMAP_AGES.owen,     kpi_count: 3, headline: '67 tests · 91% coverage · awaiting venv install', stats_source: 'mock' },
]

function ageHoursFromActionTs(ts: string | null): number | null {
  if (!ts) return null
  // Atlas writes "YYYY-MM-DD HH:MM:SS" (UTC, no Z). Treat as UTC.
  const iso = ts.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return Math.max(0, (Date.now() - d.getTime()) / 3_600_000)
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const part = url.searchParams.get('part')

  // 1. Read Atlas heartbeat (cheap fs read, null if mount missing).
  const hb = await readHeartbeat()
  const hbMap = heartbeatAgentMap(hb)

  // 1b. Read real agent_state from atlas.db (git drift / commits-ahead / deploy).
  //     This is the reliable, daily-refreshed source — the heartbeat JSON is
  //     often absent/zeroed, which is what left the FALLBACK headlines stale.
  const stateRes = readAgentStates()
  const stateMap = new Map(stateRes.rows.map(r => [r.agent, r]))

  // 2. Build per-agent rows: start from FALLBACK snapshot, overlay heartbeat
  //    fields where present, then try the agent's own /api/stats URL.
  const agents: AgentRow[] = await Promise.all(FALLBACK.map(async (a) => {
    const hbA = hbMap.get(a.name)
    let row: AgentRow = { ...a }
    if (hbA) {
      const lastAgeH = ageHoursFromActionTs(hbA.last_action_at)
      row = {
        ...row,
        status: (hbA.status === 'live' ? (hbA.tasks_today > 5 ? 'review' : 'ok') : (hbA.status as AgentRow['status'])),
        last_action: hbA.last_action_at ?? row.last_action,
        headline: hbA.last_action
          ? `${hbA.tasks_today} tasks today · $${hbA.cost_today_usd.toFixed(2)} · last: ${hbA.last_action}${lastAgeH != null ? ` (${Math.round(lastAgeH)}h ago)` : ''}`
          : hbA.tasks_today > 0
            ? `${hbA.tasks_today} tasks today · $${hbA.cost_today_usd.toFixed(2)}`
            : row.headline,
        stats_source: 'live' as const,
      }
    }
    // Overlay real agent_state (git/deploy sync) — wins over the dead heartbeat
    // so headlines reflect reality, not the stale May FALLBACK text.
    const st = stateMap.get(a.name)
    if (st) {
      const checked = formatAge(st.last_checked_at)
      row = {
        ...row,
        status: (st.drift || st.commits_ahead > 0 ? 'review' : 'ok') as AgentRow['status'],
        last_action: st.last_checked_at ?? row.last_action,
        headline: st.commits_ahead > 0
          ? `${st.commits_ahead} commit${st.commits_ahead === 1 ? '' : 's'} ahead of VPS${st.drift ? ' · drift' : ''} · checked ${checked}`
          : st.drift
            ? `drift vs VPS · checked ${checked}`
            : st.has_vps
              ? `in sync · checked ${checked}`
              : `local-only · checked ${checked}`,
        stats_source: 'live' as const,
      }
    }

    // Per-agent /api/stats overlay (Hugo has this, others mock) — most specific, wins.
    if (a.stats_url) {
      const live = await tryFetchAgentStats(a.stats_url)
      if (live) {
        const p0 = live.open_p0 ?? 0
        row = {
          ...row,
          status: (p0 > 0 ? 'review' : 'ok') as AgentRow['status'],
          headline: `${live.open ?? 0} open · ${p0} P0 · ${live.resolved_this_week ?? 0} resolved this week`,
          stats_source: 'live' as const,
        }
      }
    }
    return row
  }))

  if (part === 'summary') {
    return NextResponse.json({
      ok: true,
      total: agents.length,
      ok_count: agents.filter(a => a.status === 'ok').length,
      review: agents.filter(a => a.status === 'review').length,
      offline: agents.filter(a => a.status === 'offline').length,
      stale_roadmaps: agents.filter(a => a.roadmap_age_days > 7).length,
      agents_state_source: stateRes.source,
      agents_state_checked: stateRes.lastChecked,
      need_deploy: agents.filter(a => stateMap.get(a.name) && (stateMap.get(a.name)!.drift || stateMap.get(a.name)!.commits_ahead > 0)).length,
      heartbeat_source: hb ? 'atlas-live' : 'mock',
      heartbeat_ts: hb?.timestamp ?? null,
      spend_today_usd: hb?.spend_today_usd ?? null,
      pending_approvals: hb?.pending_approvals ?? null,
    })
  }

  if (part === 'stale-roadmaps') {
    return NextResponse.json({
      items: agents
        .filter(a => a.roadmap_age_days > 7)
        .sort((x, y) => y.roadmap_age_days - x.roadmap_age_days)
        .map(a => ({ name: a.name, role: a.role, roadmap_age_days: a.roadmap_age_days })),
    })
  }

  if (part === 'by-category') {
    const groups: Record<string, AgentRow[]> = {}
    agents.forEach(a => {
      if (!groups[a.category]) groups[a.category] = []
      groups[a.category].push(a)
    })
    return NextResponse.json({ groups })
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    agents_state_source: stateRes.source,
    agents_state_checked: stateRes.lastChecked,
    heartbeat_source: hb ? 'atlas-live' : 'mock',
    heartbeat_ts: hb?.timestamp ?? null,
    spend_today_usd: hb?.spend_today_usd ?? null,
    pending_approvals: hb?.pending_approvals ?? null,
    agents,
  })
}
