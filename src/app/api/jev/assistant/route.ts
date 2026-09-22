import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { JevAssistantProviderError } from '@/lib/jev-assistant-provider'
import { jevAssistantErrorMessage } from '@/lib/jev-assistant-error'
import { validateJevAssistantRequest } from '@/lib/jev-assistant-request'
import { createJevAssistantDraft } from '@/lib/jev-assistant-service'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { assertJevProject } from '@/lib/jev-repository'
import { canManageJevSession } from '@/lib/jev-session-access'
import { jevAssistantLimiter } from '@/lib/jev-assistant-rate-limit'
import {
  appendJevSetupExchange,
  getJevSetupSession,
} from '@/lib/jev-setup-session-repository'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = jevAssistantLimiter(`${auth.user.tenant_id}:${auth.user.workspace_id}:${auth.user.id}`)
  if (limited) return limited
  const validated = await validateJevAssistantRequest(request)
  if ('error' in validated) return validated.error

  try {
    for (const projectId of validated.data.projectIds) {
      assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId)
    }
    const session = validated.data.sessionId
      ? getJevSetupSession(
        validated.data.sessionId,
        auth.user.workspace_id,
        auth.user.tenant_id,
      )
      : null
    if (session && !canManageJevSession(auth.user, session)) {
      return NextResponse.json({ error: 'Session owner or administrator required' }, { status: 403 })
    }
    if (session?.status === 'archived') {
      return NextResponse.json({ error: 'Archived sessions cannot accept messages' }, { status: 409 })
    }
    if (session && !validated.data.projectIds.includes(session.project_id)) {
      return NextResponse.json({ error: 'Session project must be included in projectIds' }, { status: 409 })
    }
    const result = await createJevAssistantDraft(validated.data, request.signal)
    const revision = session ? appendJevSetupExchange(session, {
      user: {
        action: validated.data.action,
        goal: validated.data.goal,
        answers: validated.data.answers,
        projectIds: validated.data.projectIds,
        revision: validated.data.revision,
      },
      assistant: { draft: result.draft, warnings: result.warnings },
      draft: result.draft,
      configuration: result.configuration,
      provider: result.provider.kind,
      model: result.provider.model,
    }) : null
    logAuditEvent({
      action: `jev_assistant_${validated.data.action}`, actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_policy_draft',
      detail: {
        project_count: validated.data.projectIds.length,
        question_count: Object.keys(result.draft.questions).length,
        injection_warning: result.warnings.length > 0,
        session_id: session?.id,
        revision_no: revision?.revision_no,
      },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({
      ...result,
      session: session && revision
        ? { id: session.id, revisionNo: revision.revision_no }
        : null,
    })
  } catch (error) {
    if (error instanceof JevAssistantProviderError) {
      return NextResponse.json({ error: jevAssistantErrorMessage(error.code), code: error.code }, { status: error.status })
    }
    return jevErrorResponse(error, 'draft policy with assistant')
  }
}
