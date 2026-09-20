import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBoundedBody } from '@/lib/bounded-validation'
import { logAuditEvent } from '@/lib/db'
import { jevErrorResponse } from '@/lib/jev-route-error'
import {
  assertJevProject,
  deleteJevPolicy,
  getJevPolicy,
  updateJevPolicy,
} from '@/lib/jev-repository'
import { updateJevPolicySchema } from '@/lib/jev-validation'
import { mutationLimiter } from '@/lib/rate-limit'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: Context) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const validated = await validateBoundedBody(request, updateJevPolicySchema, {
    maxBytes: 80_000, maxDepth: 24, label: 'Policy request',
  })
  if ('error' in validated) return validated.error

  try {
    const policyId = Number((await context.params).id)
    const { projectId, ...updates } = validated.data
    if (!Number.isInteger(policyId) || policyId < 1) {
      return NextResponse.json({ error: 'Valid policy identifier is required' }, { status: 400 })
    }
    assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId)
    const current = getJevPolicy(auth.user.workspace_id, projectId, policyId)
    const policy = updateJevPolicy(current, updates)
    logAuditEvent({
      action: 'jev_policy_updated', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_policy', target_id: policy.id,
      detail: { project_id: projectId, fields: Object.keys(updates) }, workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ policy })
  } catch (error) {
    return jevErrorResponse(error, 'update policy')
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited

  try {
    const policyId = Number((await context.params).id)
    const projectId = Number(new URL(request.url).searchParams.get('projectId'))
    if (!Number.isInteger(policyId) || policyId < 1 || !Number.isInteger(projectId) || projectId < 1) {
      return NextResponse.json({ error: 'Valid policy and project identifiers are required' }, { status: 400 })
    }
    assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId)
    const policy = getJevPolicy(auth.user.workspace_id, projectId, policyId)
    deleteJevPolicy(policy)
    logAuditEvent({
      action: 'jev_policy_deleted', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_policy', target_id: policy.id,
      detail: { project_id: projectId }, workspace_id: auth.user.workspace_id,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return jevErrorResponse(error, 'delete policy')
  }
}
