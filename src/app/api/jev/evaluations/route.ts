import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBoundedBody } from '@/lib/bounded-validation'
import { JevClientError } from '@/lib/jev-client'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { assertJevProject, listJevEvaluations } from '@/lib/jev-repository'
import { runJevEvaluation } from '@/lib/jev-service'
import { runJevEvaluationSchema } from '@/lib/jev-validation'
import { heavyLimiter, readLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited

  const params = new URL(request.url).searchParams
  const projectId = Number(params.get('projectId'))
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 200)
  if (!Number.isInteger(projectId) || projectId < 1) {
    return NextResponse.json({ error: 'Valid projectId is required' }, { status: 400 })
  }
  try {
    assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId)
    return NextResponse.json({ evaluations: listJevEvaluations(auth.user.workspace_id, projectId, limit) })
  } catch (error) {
    return jevErrorResponse(error, 'list evaluations')
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = heavyLimiter(request)
  if (limited) return limited
  const validated = await validateBoundedBody(request, runJevEvaluationSchema, {
    maxBytes: 220_000, maxDepth: 40, label: 'Evaluation request',
  })
  if ('error' in validated) return validated.error

  try {
    const body = validated.data
    assertJevProject(auth.user.workspace_id, auth.user.tenant_id, body.projectId)
    const result = await runJevEvaluation({
      workspaceId: auth.user.workspace_id,
      projectId: body.projectId,
      idempotencyKey: body.idempotencyKey,
      policyId: body.policyId,
      state: body.state,
      questions: body.questions,
      model: body.model,
      retainStatePreview: body.retainStatePreview,
      signal: request.signal,
      actor: { id: auth.user.id, username: auth.user.username },
    })
    return NextResponse.json({ evaluation: result }, { status: 201 })
  } catch (error) {
    if (error instanceof JevClientError) return jevErrorResponse(error, 'run evaluation')
    return jevErrorResponse(error, 'run evaluation')
  }
}
