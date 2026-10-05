import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { improvementCandidateProposalSchema } from '@/lib/factories/learning-schemas'
import { proposeReadyImprovementCandidate } from '@/lib/factories/learning-store'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = improvementCandidateProposalSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid candidate proposal' }, { status: 400 })
  try {
    const candidate = proposeReadyImprovementCandidate({
      workspaceId: ws.workspaceId,
      scope: parsed.data.scope,
      target: parsed.data.target,
      hypothesis: parsed.data.hypothesis,
      evalPlan: parsed.data.eval_plan,
      rollbackTarget: parsed.data.rollback_target,
    })
    return NextResponse.json({ candidate }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Candidate proposal failed' }, { status: 409 })
  }
}
