import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { improvementCandidateTransitionSchema } from '@/lib/factories/learning-schemas'
import { transitionImprovementCandidate } from '@/lib/factories/learning-store'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ candidateId: string }> },
) {
  const operatorAuth = requireRole(request, 'operator')
  if ('error' in operatorAuth) {
    return NextResponse.json({ error: operatorAuth.error }, { status: operatorAuth.status })
  }

  const rate = mutationLimiter(request)
  if (rate) return rate

  const ws = requireWorkspaceId(operatorAuth.user)
  if (!('workspaceId' in ws)) return ws.response

  const parsed = improvementCandidateTransitionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid improvement candidate transition', detail: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const highRiskTransition = parsed.data.to_status === 'PROMOTED' || parsed.data.to_status === 'ROLLED_BACK'
  let actor = operatorAuth.user.username
  if (highRiskTransition) {
    const adminAuth = requireRole(request, 'admin')
    if ('error' in adminAuth) {
      return NextResponse.json({ error: adminAuth.error }, { status: adminAuth.status })
    }
    actor = adminAuth.user.username
  }

  const { candidateId } = await params
  try {
    const candidate = transitionImprovementCandidate({
      workspaceId: ws.workspaceId,
      candidateId: decodeURIComponent(candidateId),
      expectedStatus: parsed.data.expected_status,
      toStatus: parsed.data.to_status,
      actor,
      reason: parsed.data.reason,
      evidenceRefs: parsed.data.evidence_refs,
      changeRef: parsed.data.change_ref,
      rollbackTarget: parsed.data.rollback_target,
    })
    return NextResponse.json({ candidate })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to transition improvement candidate'
    const status = message.includes('not found')
      ? 404
      : message.includes('changed before transition')
        || message.includes('Invalid improvement candidate transition')
        || message.includes('requires')
        || message.includes('already assigned')
        ? 409
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
