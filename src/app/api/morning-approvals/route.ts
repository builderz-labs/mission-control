import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import {
  generateMorningApprovalBrief,
  getLatestMorningApprovalBrief,
  respondToMorningApprovalItem,
  type MorningApprovalDecision,
} from '@/lib/morning-approvals'
import { logger } from '@/lib/logger'

const DECISIONS = new Set<MorningApprovalDecision>(['approve', 'needs_changes', 'defer'])

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const forceGenerate = request.nextUrl.searchParams.get('generate') === 'true'
    const publish = request.nextUrl.searchParams.get('publish') === 'true'

    const brief = forceGenerate
      ? await generateMorningApprovalBrief({
          workspaceId,
          actor: auth.user.username || 'operator',
          publish,
        })
      : getLatestMorningApprovalBrief(workspaceId)

    return NextResponse.json({ brief })
  } catch (err) {
    logger.error({ err }, 'GET /api/morning-approvals error')
    return NextResponse.json({ error: 'Failed to fetch morning approvals' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json().catch(() => ({}))
    const action = typeof body?.action === 'string' ? body.action : 'generate'

    if (action === 'generate') {
      const brief = await generateMorningApprovalBrief({
        workspaceId,
        actor: auth.user.username || 'operator',
        date: typeof body?.date === 'string' ? body.date : undefined,
        publish: body?.publish !== false,
      })
      return NextResponse.json({ brief })
    }

    if (action === 'respond') {
      const briefId = Number(body?.briefId)
      const itemId = typeof body?.itemId === 'string' ? body.itemId : ''
      const decision = body?.decision as MorningApprovalDecision
      const feedback = typeof body?.feedback === 'string' ? body.feedback : undefined

      if (!Number.isFinite(briefId) || briefId <= 0) {
        return NextResponse.json({ error: 'briefId is required' }, { status: 400 })
      }
      if (!itemId) {
        return NextResponse.json({ error: 'itemId is required' }, { status: 400 })
      }
      if (!DECISIONS.has(decision)) {
        return NextResponse.json({ error: 'decision must be approve, needs_changes, or defer' }, { status: 400 })
      }

      const brief = respondToMorningApprovalItem({
        workspaceId,
        actor: auth.user.username || 'operator',
        briefId,
        itemId,
        decision,
        feedback,
      })
      return NextResponse.json({ brief })
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  } catch (err: any) {
    logger.error({ err }, 'POST /api/morning-approvals error')
    const message = err?.message || 'Failed to update morning approvals'
    const status = message.includes('not found') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
