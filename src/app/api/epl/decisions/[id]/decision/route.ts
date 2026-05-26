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
import { logAuditEvent, getDatabase } from '@/lib/db'

type Action = 'approve' | 'reject' | 'discuss'

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

  // Persist to MC audit_log table — survives container restarts and shows
  // up in MC's existing Audit Trail panel.
  let persisted: 'audit_log' | 'in-memory-fallback' = 'audit_log'
  try {
    logAuditEvent({
      action: `epl.decision.${action}`,
      actor: req.headers.get('x-actor') ?? 'gerda',
      target_type: 'epl_decision',
      detail: { id, action, note, audit_id },
      ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
    })
  } catch (e) {
    // SQLite may be locked or in standalone-without-DB mode — log + continue.
    console.warn(`[epl/decision] audit_log write failed: ${e instanceof Error ? e.message : 'unknown'}`)
    persisted = 'in-memory-fallback'
  }
  console.log(`[epl/decision] id=${id} action=${action} audit=${audit_id} persisted=${persisted}`)
  return NextResponse.json({ ok: true, id, action, ts, audit_id, note, note_persisted: persisted })
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  try {
    const db = getDatabase()
    const rows = db.prepare(`
      SELECT action, actor, detail, ip_address, created_at
      FROM audit_log
      WHERE target_type = 'epl_decision'
        AND json_extract(detail, '$.id') = ?
      ORDER BY id DESC
      LIMIT 50
    `).all(id) as any[]
    return NextResponse.json({
      id,
      count: rows.length,
      items: rows.map(r => ({
        action: String(r.action ?? '').replace('epl.decision.', ''),
        actor: r.actor,
        detail: r.detail ? JSON.parse(r.detail) : null,
        ip_address: r.ip_address,
        ts: r.created_at,
      })),
    })
  } catch (e) {
    return NextResponse.json({ id, count: 0, items: [], error: e instanceof Error ? e.message : 'query failed' })
  }
}
