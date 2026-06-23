import { NextRequest, NextResponse } from 'next/server'
import { readCockpit } from '@/lib/atlas-cockpit'
import { cockpitApprovalsEnabled } from '@/lib/cockpit-flags'

/**
 * GET /api/epl/approvals
 *
 * Phase-2 approvals inbox — lists the pending gated-dispatch runs Atlas exported
 * into mc_cockpit.json (`pending_approvals[]`). Read-only; the resolve action is
 * POST /api/epl/approvals/[id].
 *
 * 🔒 GATED: the whole approvals surface is behind COCKPIT_APPROVALS_ENABLED
 * (default OFF). When the flag is off this route returns 404 so the surface is
 * provably inert in prod even if something probes the URL.
 *
 * Source of truth = the Atlas export (same store the Slack gate reads), so the
 * MC inbox and Slack never drift. A missing/invalid export yields an honest
 * empty list (source:'empty'), never fabricated rows.
 */
export async function GET(_req: NextRequest) {
  if (!cockpitApprovalsEnabled()) {
    return NextResponse.json({ error: 'Approvals surface disabled' }, { status: 404 })
  }

  const cockpit = await readCockpit()
  return NextResponse.json({
    source: cockpit.source,
    generated_at: cockpit.generated_at,
    pending: cockpit.pending_approvals,
    pending_count: cockpit.pending_approvals.length,
  })
}
