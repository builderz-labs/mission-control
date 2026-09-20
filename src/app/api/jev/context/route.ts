import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logAuditEvent } from '@/lib/db'
import { buildJevRepositoryContext } from '@/lib/jev-context'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { readLimiter } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = readLimiter(request)
  if (limited) return limited
  const projectId = Number(new URL(request.url).searchParams.get('projectId'))
  if (!Number.isInteger(projectId) || projectId < 1) {
    return NextResponse.json({ error: 'Valid projectId is required' }, { status: 400 })
  }

  try {
    const context = buildJevRepositoryContext(
      auth.user.workspace_id, auth.user.tenant_id, projectId,
    )
    logAuditEvent({
      action: 'jev_context_loaded', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'project', target_id: projectId,
      detail: { source: context.source, included_files: context.includedFiles.length },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ context })
  } catch (error) {
    return jevErrorResponse(error, 'load repository context')
  }
}
