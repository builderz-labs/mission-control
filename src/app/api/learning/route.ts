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
  const candidates = listImprovementCandidates(ws.workspaceId, limit).map((candidate) => {
    let evidenceCount = 0
    try {
      const refs = JSON.parse(candidate.evidence_refs)
      evidenceCount = Array.isArray(refs) ? refs.length : 0
    } catch { /* Historical malformed candidate data remains visible. */ }
    return {
      ...candidate,
      evidence_count: evidenceCount,
      eval_ready: candidate.status !== 'PROPOSED' && candidate.status !== 'HELD',
      has_rollback_target: Boolean(candidate.rollback_target),
      review_required: candidate.review_policy === 'independent_and_human' || candidate.status === 'REVIEW_REQUIRED',
      approval_required: candidate.status === 'APPROVAL_REQUIRED',
      under_observation: candidate.status === 'OBSERVING',
    }
  })
  return NextResponse.json({
    summary: learningSummary(ws.workspaceId),
    analysis: deterministicLearningAggregates(ws.workspaceId),
    candidate_signals: deterministicCandidateSignals(ws.workspaceId),
    evidence: listLearningEvidence(ws.workspaceId, limit),
    experiences: listExperienceEvents(ws.workspaceId, limit),
    candidates,
  })
}
