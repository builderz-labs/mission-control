import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBoundedBody } from '@/lib/bounded-validation'
import { logAuditEvent } from '@/lib/db'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { assertJevProject, createJevPolicy, listJevPolicies } from '@/lib/jev-repository'
import { createJevPolicySchema } from '@/lib/jev-validation'
import { mutationLimiter, readLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited

  const projectId = Number(new URL(request.url).searchParams.get('projectId'))
  if (!Number.isInteger(projectId) || projectId < 1) {
    return NextResponse.json({ error: 'Valid projectId is required' }, { status: 400 })
  }
  try {
    assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId)
    return NextResponse.json({ policies: listJevPolicies(auth.user.workspace_id, projectId) })
  } catch (error) {
    return jevErrorResponse(error, 'list policies')
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const validated = await validateBoundedBody(request, createJevPolicySchema, {
    maxBytes: 80_000, maxDepth: 24, label: 'Policy request',
  })
  if ('error' in validated) return validated.error

  try {
    const body = validated.data
    assertJevProject(auth.user.workspace_id, auth.user.tenant_id, body.projectId)
    const policy = createJevPolicy({
      project_id: body.projectId,
      name: body.name,
      description: body.description || null,
      model: body.model,
      mode: body.mode,
      questions: body.questions,
      configuration: body.configuration ?? null,
      enabled: body.enabled,
      created_by: auth.user.username,
    }, auth.user.workspace_id)
    logAuditEvent({
      action: 'jev_policy_created', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_policy', target_id: policy.id,
      detail: { project_id: policy.project_id, mode: policy.mode, question_count: Object.keys(policy.questions).length },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ policy }, { status: 201 })
  } catch (error) {
    return jevErrorResponse(error, 'create policy')
  }
}
