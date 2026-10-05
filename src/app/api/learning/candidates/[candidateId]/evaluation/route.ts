import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import { mutationLimiter } from '@/lib/rate-limit'
import { improvementCandidateEvaluationSchema } from '@/lib/factories/learning-schemas'
import { recordImprovementEvaluation } from '@/lib/factories/learning-store'

export async function POST(request: NextRequest, { params }: { params: Promise<{ candidateId: string }> }) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const rate = mutationLimiter(request)
  if (rate) return rate
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response
  const parsed = improvementCandidateEvaluationSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid evaluation result' }, { status: 400 })
  const { candidateId } = await params
  try {
    const evaluation = recordImprovementEvaluation({
      workspaceId: ws.workspaceId,
      candidateId,
      after: parsed.data.after,
      sourceRef: parsed.data.source_ref,
      actor: auth.user.username,
    })
    return NextResponse.json({ evaluation }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Evaluation failed' }, { status: 409 })
  }
}
