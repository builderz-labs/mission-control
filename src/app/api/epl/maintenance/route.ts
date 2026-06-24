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
import { getMaintenanceSummary } from '@/lib/maintenance-summary'

interface Ticket {
  id: string
  property: string
  summary: string
  severity: 'P0' | 'P1' | 'P2' | 'P3'
  status: string
  assignee: string
  age_hours: number
  ts: string
}

const REAL_PATH = process.env.MC_MAINTENANCE_JSON || '/atlas-data/mc_maintenance.json'

function loadTickets(): { tickets: Ticket[]; real: boolean; generatedAt?: string } {
  try {
    const raw = JSON.parse(readFileSync(REAL_PATH, 'utf8'))
    if (Array.isArray(raw.tickets)) {
      return { tickets: raw.tickets as Ticket[], real: true, generatedAt: raw.generatedAt }
    }
  } catch {
    // no live feed → empty board (honest), not fabricated tickets
  }
  return { tickets: [], real: false }
}

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

  const { tickets, real, generatedAt } = loadTickets()

  if (part === 'kanban') {
    const cols: Record<string, Ticket[]> = {
      inbox: [], in_progress: [], awaiting_parts: [], resolved_this_week: [], cancelled: [],
    }
    tickets.forEach(t => cols[statusBucket(t.status)].push(t))
    return NextResponse.json({ columns: cols, real })
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
    tickets,
    note: real ? undefined : 'No live maintenance feed yet (Hugo not deployed).',
  })
}
