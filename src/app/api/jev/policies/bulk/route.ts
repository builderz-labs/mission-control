import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { validateBoundedBody } from '@/lib/bounded-validation'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { jevErrorResponse } from '@/lib/jev-route-error'
import { assertJevProject, createJevPolicy, JevRecordError } from '@/lib/jev-repository'
import { canManageJevSession } from '@/lib/jev-session-access'
import { getJevSetupSession } from '@/lib/jev-setup-session-repository'
import { createJevPoliciesSchema } from '@/lib/jev-validation'
import { mutationLimiter } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const limited = mutationLimiter(request)
  if (limited) return limited
  const validated = await validateBoundedBody(request, createJevPoliciesSchema, {
    maxBytes: 80_000, maxDepth: 24, label: 'Policy request',
  })
  if ('error' in validated) return validated.error

  try {
    const body = validated.data
    const db = getDatabase()
    if (body.configuration?.scope === 'all') {
      const allProjectIds = (db.prepare(`
        SELECT p.id FROM projects p JOIN workspaces w ON w.id=p.workspace_id
        WHERE p.workspace_id=? AND w.tenant_id=? AND p.status='active' ORDER BY p.id
      `).all(auth.user.workspace_id, auth.user.tenant_id) as Array<{ id: number }>).map((row) => row.id)
      const requested = new Set(body.projectIds)
      if (allProjectIds.length !== requested.size || !allProjectIds.every((id) => requested.has(id))) {
        return NextResponse.json({ error: 'All-repository scope must include every active repository' }, { status: 400 })
      }
    }
    for (const projectId of body.projectIds) {
      assertJevProject(auth.user.workspace_id, auth.user.tenant_id, projectId, db)
    }
    const session = body.approval
      ? getJevSetupSession(body.approval.sessionId, auth.user.workspace_id, auth.user.tenant_id, db)
      : null
    if (session && !canManageJevSession(auth.user, session)) {
      return NextResponse.json({ error: 'Session owner or administrator required' }, { status: 403 })
    }
    if (session && !body.projectIds.includes(session.project_id)) {
      return NextResponse.json({ error: 'Approval must include the setup session repository' }, { status: 409 })
    }
    const createAll = db.transaction(() => {
      if (session && body.approval) {
        const latest = db.prepare(`SELECT revision_no FROM jev_setup_revisions
          WHERE workspace_id=? AND session_id=? ORDER BY revision_no DESC LIMIT 1`)
          .get(session.workspace_id, session.id) as { revision_no: number } | undefined
        if (!latest || latest.revision_no !== body.approval.expectedRevisionNo || session.status === 'archived') {
          throw new JevRecordError('The setup changed before approval; review the latest revision', 409)
        }
      }
      const policies = body.projectIds.map((projectId) => createJevPolicy({
        project_id: projectId, name: body.name, description: body.description || null,
        model: body.model, mode: body.mode, questions: body.questions,
        configuration: body.configuration ? { ...body.configuration, projectIds: [projectId] } : null,
        enabled: body.enabled, created_by: auth.user.username,
      }, auth.user.workspace_id, db))
      if (session && body.approval) {
        const draft = {
          summary: body.description || body.name, name: body.name, description: body.description || body.name,
          questions: body.questions, tests: body.configuration?.tests ?? [], risks: body.configuration?.risks ?? [],
          observability: body.configuration?.observability ?? [], warnings: [], clarifications: [],
        }
        const revision = db.prepare(`INSERT INTO jev_setup_revisions
          (workspace_id,session_id,revision_no,draft,configuration,provider,model,status)
          VALUES (?,?,?, ?,?,?,?,'applied')`).run(
          session.workspace_id, session.id, body.approval.expectedRevisionNo + 1,
          JSON.stringify(draft), JSON.stringify(body.configuration ?? {}), 'human-approved', body.model,
        )
        const revisionId = Number(revision.lastInsertRowid)
        const link = db.prepare(`INSERT INTO jev_setup_revision_policies
          (workspace_id,session_id,revision_id,policy_id,project_id,policy_name) VALUES (?,?,?,?,?,?)`)
        for (const policy of policies) {
          link.run(session.workspace_id, session.id, revisionId, policy.id, policy.project_id, policy.name)
        }
        db.prepare(`UPDATE jev_setup_sessions SET status='ready',primary_policy_id=?,updated_at=unixepoch()
          WHERE id=? AND workspace_id=?`).run(policies[0].id, session.id, session.workspace_id)
      }
      return policies
    })
    const policies = createAll()
    logAuditEvent({
      action: 'jev_policy_bulk_created', actor: auth.user.username, actor_id: auth.user.id,
      target_type: 'jev_policy_set',
      detail: { project_count: policies.length, question_count: Object.keys(body.questions).length,
        session_id: session?.id ?? null },
      workspace_id: auth.user.workspace_id,
    })
    return NextResponse.json({ policies, approval: body.approval ? {
      sessionId: body.approval.sessionId, revisionNo: body.approval.expectedRevisionNo + 1,
    } : null }, { status: 201 })
  } catch (error) {
    return jevErrorResponse(error, 'create policies')
  }
}
