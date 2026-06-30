/**
 * GET /api/epl/maintenance
 *
 * Hugo Phase 3 home — Kanban + property heat map.
 *
 * REAL DATA: reads /atlas-data/mc_maintenance.json if an exporter writes it.
 * There is NO live maintenance feed yet (Hugo is not deployed), so when the
 * file is absent this returns an EMPTY board + a pending flag rather than
 * fabricated tickets. The panel shows "no live feed" honestly.
 *
 * Assignee allowlist: never show U07FQ300EVB (Hanna) or U09MSN2EFK6 (Abuzar dup).
 * Severity colours: P0 red · P1 orange · P2 amber · P3 grey.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { getMaintenanceSummary, hugoStatsUrl } from '@/lib/maintenance-summary'

interface Ticket {
  id: string
  property: string
  summary: string
  category?: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  status: string
  assignee: string
  age_hours: number
  ts: string
  blocked_reason?: string | null
}

const REAL_PATH = process.env.MC_MAINTENANCE_JSON || '/atlas-data/mc_maintenance.json'

/** Hugo's live ticket list endpoint, derived from the stats URL. */
function hugoTicketsUrl(): string {
  return process.env.HUGO_TICKETS_URL || hugoStatsUrl().replace('/api/stats', '/api/tickets')
}

function mapHugo(t: Record<string, unknown>): Ticket {
  const sev = (['P0', 'P1', 'P2', 'P3'].includes(String(t.severity)) ? t.severity : 'P3') as Ticket['severity']
  return {
    id: String(t.id ?? ''),
    property: String(t.property_id ?? '—'),
    summary: String(t.title ?? ''),
    category: t.category ? String(t.category) : undefined,
    severity: sev,
    status: String(t.status ?? 'new'),
    assignee: '',
    age_hours: typeof t.age_days === 'number' ? t.age_days * 24 : 0,
    ts: String(t.created_at ?? ''),
    blocked_reason: (t.blocked_reason as string) ?? null,
  }
}

/** Live tickets from Hugo /api/tickets; falls back to the JSON exporter, then empty. */
async function loadTickets(): Promise<{ tickets: Ticket[]; real: boolean; source: string; generatedAt?: string }> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(hugoTicketsUrl(), { cache: 'no-store', signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.tickets)) {
        return { tickets: data.tickets.map(mapHugo), real: true, source: 'hugo-live' }
      }
    }
  } catch {
    // Hugo unreachable → try the exporter file, else honest empty board
  }
  try {
    const raw = JSON.parse(readFileSync(REAL_PATH, 'utf8'))
    if (Array.isArray(raw.tickets)) {
      return { tickets: raw.tickets as Ticket[], real: true, source: 'json-export', generatedAt: raw.generatedAt }
    }
  } catch {
    /* no feed */
  }
  return { tickets: [], real: false, source: 'unavailable' }
}

function statusBucket(s: string) {
  if (s === 'new' || s === 'open' || s === 'triaged') return 'inbox'
  if (s === 'in_progress' || s === 'assigned' || s === 'acknowledged' || s === 'dispatched') return 'in_progress'
  if (s === 'awaiting_parts' || s === 'blocked') return 'awaiting_parts'
  if (s === 'resolved' || s === 'verified' || s === 'closed') return 'resolved_this_week'
  if (s === 'cancelled') return 'cancelled'
  return 'inbox'
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const part = url.searchParams.get('part')

  if (part === 'summary') {
    const summary = await getMaintenanceSummary()
    return NextResponse.json(summary)
  }

  const { tickets, real, source, generatedAt } = await loadTickets()

  if (part === 'kanban') {
    const cols: Record<string, Ticket[]> = {
      inbox: [], in_progress: [], awaiting_parts: [], resolved_this_week: [], cancelled: [],
    }
    tickets.forEach(t => cols[statusBucket(t.status)].push(t))
    return NextResponse.json({ columns: cols, real, source })
  }

  if (part === 'by-property') {
    const active = tickets.filter(t => !['resolved', 'verified', 'closed', 'cancelled'].includes(t.status))
    const groups: Record<string, { tickets: Ticket[]; p0: number; p1: number; open: number; oldest_hours: number }> = {}
    active.forEach(t => {
      const k = t.property || '—'
      if (!groups[k]) groups[k] = { tickets: [], p0: 0, p1: 0, open: 0, oldest_hours: 0 }
      groups[k].tickets.push(t)
      groups[k].open += 1
      if (t.severity === 'P0') groups[k].p0 += 1
      if (t.severity === 'P1') groups[k].p1 += 1
      if (t.age_hours > groups[k].oldest_hours) groups[k].oldest_hours = t.age_hours
    })
    // most urgent properties first (P0s, then P1s, then volume)
    const ordered = Object.entries(groups)
      .sort((a, b) => b[1].p0 - a[1].p0 || b[1].p1 - a[1].p1 || b[1].open - a[1].open)
      .map(([property, g]) => ({ property, ...g }))
    return NextResponse.json({ properties: ordered, real, source, count: active.length })
  }

  if (part === 'heat') {
    const byProperty: Record<string, { open: number; p0: number; p1: number; oldest_hours: number }> = {}
    tickets.forEach(t => {
      if (['resolved', 'verified', 'closed', 'cancelled'].includes(t.status)) return
      const k = t.property
      if (!byProperty[k]) byProperty[k] = { open: 0, p0: 0, p1: 0, oldest_hours: 0 }
      byProperty[k].open += 1
      if (t.severity === 'P0') byProperty[k].p0 += 1
      if (t.severity === 'P1') byProperty[k].p1 += 1
      if (t.age_hours > byProperty[k].oldest_hours) byProperty[k].oldest_hours = t.age_hours
    })
    return NextResponse.json({ properties: byProperty, real })
  }

  return NextResponse.json({
    generatedAt: generatedAt || new Date().toISOString(),
    real,
    source,
    tickets,
    note: real ? undefined : 'Hugo maintenance feed unreachable — no live tickets.',
  })
}
