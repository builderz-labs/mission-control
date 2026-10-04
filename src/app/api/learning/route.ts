import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { requireWorkspaceId } from '@/lib/enforcement/workspace-scope'
import {
  deterministicCandidateSignals,
  deterministicLearningAggregates,
  learningSummary,
  listExperienceEvents,
  listImprovementCandidates,
  listLearningEvidence,
} from '@/lib/factories/learning-store'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const ws = requireWorkspaceId(auth.user)
  if (!('workspaceId' in ws)) return ws.response

  const url = new URL(request.url)
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') || 30)))
  return NextResponse.json({
    summary: learningSummary(ws.workspaceId),
    analysis: deterministicLearningAggregates(ws.workspaceId),
    candidate_signals: deterministicCandidateSignals(ws.workspaceId),
    evidence: listLearningEvidence(ws.workspaceId, limit),
    experiences: listExperienceEvents(ws.workspaceId, limit),
    candidates: listImprovementCandidates(ws.workspaceId, limit),
  })
}
