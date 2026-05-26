/**
 * POST /api/epl/decisions/[id]/decision
 *
 * Records a Gerda decision action: approve / reject / discuss.
 *
 * Body: { action: 'approve' | 'reject' | 'discuss', note?: string }
 *
 * Currently in-memory only (writes to the audit log via console + returns
 * a stub audit_id). When MC's audit_trail table is wired to this endpoint
 * we'll persist properly. For now: powers the Decisions drawer buttons
 * end-to-end so Gerda can see the round-trip.
 *
 * GET on the same path returns the recent action history for the id.
 */

import { NextRequest, NextResponse } from 'next/server'

type Action = 'approve' | 'reject' | 'discuss'

// In-memory action log (resets on container restart — acceptable until we
// wire the MC audit_trail table).
const LOG: { id: string; action: Action; note?: string; ts: string; audit_id: string }[] = []

function makeAuditId() {
  return `epl-dec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }
  const action = body?.action as Action | undefined
  if (!action || !['approve', 'reject', 'discuss'].includes(action)) {
    return NextResponse.json({ error: 'action must be approve|reject|discuss', got: action }, { status: 400 })
  }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 1000) : undefined
  const ts = new Date().toISOString()
  const audit_id = makeAuditId()
  LOG.push({ id, action, note, ts, audit_id })
  // Print to container logs for now — the MC audit_trail integration will
  // replace this with a proper db row.
  console.log(`[epl/decision] id=${id} action=${action} audit=${audit_id} note=${note ?? '-'}`)
  return NextResponse.json({ ok: true, id, action, ts, audit_id, note, note_persisted: 'in-memory' })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const items = LOG.filter(e => e.id === id).slice(-50)
  return NextResponse.json({ id, count: items.length, items })
}
