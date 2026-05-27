/**
 * GET /api/epl/maintenance
 *
 * Hugo Phase 3 home — Kanban + property heat map + Vauxhall drawer data.
 * Mock matches /mockup/maintenance-panel-preview.html.
 *
 * Wire when Hugo is live:
 *   - tickets list   → hugo /api/stats + supabase maintenance_tickets
 *   - per-property   → group by canonical_id
 *
 * Assignee allowlist: never show U07FQ300EVB (Hanna) or U09MSN2EFK6 (Abuzar dup).
 * Severity colours: P0 red · P1 orange · P2 amber · P3 grey.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getMaintenanceSummary } from '@/lib/maintenance-summary'

const TICKETS = [
  { id: 'T-001', property: 'VAUXHALL_1', summary: 'Boiler error E04 — no hot water',         severity: 'P1', status: 'in_progress',   assignee: 'Zain', age_hours: 18, ts: '2026-05-26T07:12:00Z' },
  { id: 'T-002', property: 'VAUXHALL_1', summary: 'Front door latch loose',                   severity: 'P2', status: 'open',          assignee: 'Kris', age_hours: 26, ts: '2026-05-25T23:00:00Z' },
  { id: 'T-003', property: 'VAUXHALL_1', summary: 'Bedroom blind broken',                     severity: 'P3', status: 'awaiting_parts',assignee: 'Kris', age_hours: 192, ts: '2026-05-18T13:00:00Z' },
  { id: 'T-004', property: 'RUSSELL_SQ', summary: 'Kitchen tap dripping',                     severity: 'P3', status: 'open',          assignee: 'Kris', age_hours: 8, ts: '2026-05-26T09:00:00Z' },
  { id: 'T-005', property: 'RUSSELL_SQ', summary: 'Living room lamp flickering',              severity: 'P3', status: 'open',          assignee: 'Kris', age_hours: 30, ts: '2026-05-25T11:00:00Z' },
  { id: 'T-006', property: 'RUSSELL_SQ', summary: 'Washing machine error code F02',           severity: 'P1', status: 'open',          assignee: 'Zain', age_hours: 5, ts: '2026-05-26T12:00:00Z' },
  { id: 'T-007', property: 'RUSSELL_SQ', summary: 'Wifi router unresponsive',                 severity: 'P2', status: 'open',          assignee: 'Kris', age_hours: 42, ts: '2026-05-24T23:00:00Z' },
  { id: 'T-008', property: 'KINGS_X_63', summary: 'Heating not warming bedroom',              severity: 'P2', status: 'in_progress',   assignee: 'Zain', age_hours: 11, ts: '2026-05-26T06:00:00Z' },
  { id: 'T-009', property: 'EUSTON_1',   summary: 'Smoke alarm beeping',                       severity: 'P1', status: 'in_progress',   assignee: 'Zain', age_hours: 4, ts: '2026-05-26T13:00:00Z' },
  { id: 'T-010', property: 'EUSTON_1',   summary: 'Keybox jammed — guest cannot collect key', severity: 'P0', status: 'in_progress',   assignee: 'Zain', age_hours: 1, ts: '2026-05-26T16:00:00Z' },
  { id: 'T-011', property: 'TOWER_HILL', summary: 'Shower seal mouldy',                        severity: 'P2', status: 'awaiting_parts',assignee: 'Kris', age_hours: 120, ts: '2026-05-21T13:00:00Z' },
  { id: 'T-012', property: 'TOWER_HILL', summary: 'Lift out of service — building issue',     severity: 'P3', status: 'open',          assignee: 'Kris', age_hours: 18, ts: '2026-05-26T07:00:00Z' },
  { id: 'T-013', property: 'PIMLICO_1',  summary: 'Resolved: dishwasher reseated',             severity: 'P2', status: 'resolved',      assignee: 'Zain', age_hours: 2,  ts: '2026-05-26T15:00:00Z' },
]

function statusBucket(s: string) {
  if (s === 'open') return 'inbox'
  if (s === 'in_progress') return 'in_progress'
  if (s === 'awaiting_parts') return 'awaiting_parts'
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

  if (part === 'kanban') {
    const cols: Record<string, typeof TICKETS> = {
      inbox: [], in_progress: [], awaiting_parts: [], resolved_this_week: [], cancelled: [],
    }
    TICKETS.forEach(t => cols[statusBucket(t.status)].push(t))
    return NextResponse.json({ columns: cols })
  }

  if (part === 'heat') {
    const byProperty: Record<string, { open: number; p0: number; p1: number; oldest_hours: number }> = {}
    TICKETS.forEach(t => {
      if (['resolved', 'verified', 'closed', 'cancelled'].includes(t.status)) return
      const k = t.property
      if (!byProperty[k]) byProperty[k] = { open: 0, p0: 0, p1: 0, oldest_hours: 0 }
      byProperty[k].open += 1
      if (t.severity === 'P0') byProperty[k].p0 += 1
      if (t.severity === 'P1') byProperty[k].p1 += 1
      if (t.age_hours > byProperty[k].oldest_hours) byProperty[k].oldest_hours = t.age_hours
    })
    return NextResponse.json({ properties: byProperty })
  }

  return NextResponse.json({ generatedAt: new Date().toISOString(), tickets: TICKETS })
}
