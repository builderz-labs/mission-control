/**
 * POST /api/epl/decisions/[id]/routed
 *
 * Atlas confirms it has appended an approved item to the target agent's
 * ROADMAP. Flips routing_status 'pending' → 'routed' so the next routing pass
 * is idempotent and won't append the same item twice.
 *
 * Gated by the MC API key. Body: { routed_to: string }  (the ROADMAP path or
 * agent name the item landed in).
 */

import { NextRequest, NextResponse } from 'next/server'
import { markRouted, checkApiKey } from '@/lib/epl-decisions'
import { logAuditEvent } from '@/lib/db'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!checkApiKey(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await ctx.params

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }
  const routedTo = typeof body?.routed_to === 'string' ? body.routed_to.slice(0, 300) : undefined
  if (!routedTo) {
    return NextResponse.json({ error: 'routed_to is required' }, { status: 400 })
  }

  const decision = markRouted(id, routedTo)
  if (!decision) {
    return NextResponse.json({ error: 'decision not found', id }, { status: 404 })
  }

  try {
    logAuditEvent({
      action: 'epl.decision.routed',
      actor: req.headers.get('x-actor') ?? 'atlas',
      target_type: 'epl_decision',
      detail: { id, routed_to: routedTo },
      ip_address: req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
      user_agent: req.headers.get('user-agent') ?? undefined,
    })
  } catch {
    // audit is best-effort
  }

  return NextResponse.json({ ok: true, id, routed_to: routedTo, decision })
}
