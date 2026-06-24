import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import { logAuditEvent } from '@/lib/db'
import { cockpitApprovalsEnabled } from '@/lib/cockpit-flags'

/**
 * POST /api/epl/approvals/[id]  { decision: 'approve' | 'reject', actor? }
 *
 * Phase-2 approvals resolve. MC forwards the operator's decision to Atlas's
 * dispatch service (POST {dispatchUrl}/dispatch/approve, shared-key auth), which
 * releases or kills the gated run AND updates the Slack prompt — both UIs call
 * the SAME Atlas resolve function so there is one source of truth (no
 * "approved here but Slack still pending" drift). MC then writes an audit row.
 *
 * 🔒 GATED: COCKPIT_APPROVALS_ENABLED (default OFF) → 404 when off, so this
 * mutation is provably unreachable in prod until the surface is armed.
 * 🔒 AUTH: operator role + the shared dispatch key (never exposed to the client).
 */

const VALID = new Set(['approve', 'reject'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!cockpitApprovalsEnabled()) {
    return NextResponse.json({ error: 'Approvals surface disabled' }, { status: 404 })
  }

  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const limited = mutationLimiter(request)
  if (limited) return limited

  const id = (await params).id
  if (!id || typeof id !== 'string') {
    return NextResponse.json({ error: 'Invalid approval id' }, { status: 400 })
  }

  if (!config.atlas.dispatchUrl || !config.atlas.dispatchKey) {
    return NextResponse.json(
      { error: 'Dispatch not configured — set ATLAS_DISPATCH_URL and ATLAS_DISPATCH_KEY' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => ({} as any))
  const decision = String(body?.decision || '').toLowerCase()
  if (!VALID.has(decision)) {
    return NextResponse.json(
      { error: "decision must be 'approve' or 'reject'" },
      { status: 400 }
    )
  }

  // Trust the authenticated identity for the audit trail; accept a display
  // `actor` override but never let it stand in for who is actually signed in.
  const actor = auth.user.username || auth.user.email || 'mc'
  const displayActor = typeof body?.actor === 'string' && body.actor.trim() ? body.actor.trim() : actor

  let atlasRes: Response
  try {
    atlasRes = await fetch(`${config.atlas.dispatchUrl.replace(/\/$/, '')}/dispatch/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dispatch-Key': config.atlas.dispatchKey },
      body: JSON.stringify({ id, decision, actor: displayActor }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    logger.error({ id, err: String(err) }, 'approvals: Atlas dispatch/approve unreachable')
    return NextResponse.json(
      { error: 'Atlas dispatch service unreachable', detail: String(err) },
      { status: 502 }
    )
  }

  const atlasBody = await atlasRes.json().catch(() => ({}))
  if (!atlasRes.ok) {
    logger.warn({ id, status: atlasRes.status, atlasBody }, 'approvals: Atlas declined resolve')
    return NextResponse.json(
      { ok: false, error: atlasBody.error || 'Atlas declined the approval', atlasStatus: atlasRes.status },
      { status: atlasRes.status }
    )
  }

  try {
    logAuditEvent({
      action: 'cockpit_approval_resolved',
      actor,
      actor_id: auth.user.id,
      target_type: 'atlas_approval',
      detail: { approval_id: id, decision, display_actor: displayActor },
    })
  } catch (err) {
    // Audit failure must not mask the resolved state — log and proceed.
    logger.warn({ id, err: String(err) }, 'approvals: audit write failed')
  }

  logger.info({ id, decision, actor }, 'approvals: resolved via Atlas')
  return NextResponse.json({ ok: true, id, decision, ...atlasBody })
}
