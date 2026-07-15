import type Database from 'better-sqlite3'

// Allowed workspace isolation policies (issue #677 slice 1):
// - 'shared': cross-workspace memory access from agents is allowed (default)
// - 'strict': cross-workspace memory access from agents is not allowed
// SQLite ALTER TABLE cannot add CHECK constraints, so these values are the
// single source of truth for the validation layer.
export const WORKSPACE_ISOLATION_VALUES = ['shared', 'strict'] as const
export type WorkspaceIsolation = (typeof WORKSPACE_ISOLATION_VALUES)[number]

export interface WorkspaceRecord {
  id: number
  slug: string
  name: string
  tenant_id: number
  brand: string | null
  isolation: WorkspaceIsolation
  created_at: number
  updated_at: number
}

export interface ProjectTenantRecord {
  id: number
  workspace_id: number
  tenant_id: number
}

export class ForbiddenError extends Error {
  readonly status = 403 as const
  constructor(message: string) {
    super(message)
    this.name = 'ForbiddenError'
  }
}

interface AccessAuditContext {
  actor?: string
  actorId?: number
  route?: string
  ipAddress?: string | null
  userAgent?: string | null
}

function logTenantAccessDenied(
  db: Database.Database,
  targetType: 'workspace' | 'project',
  targetId: number,
  tenantId: number,
  context: AccessAuditContext
) {
  const actorWorkspace = context.actorId
    ? db.prepare('SELECT workspace_id FROM users WHERE id = ?').get(context.actorId) as { workspace_id?: number } | undefined
    : undefined
  const workspaceId = actorWorkspace?.workspace_id ?? 1
  db.prepare(`
    INSERT INTO audit_log (action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'tenant_access_denied',
    context.actor || 'unknown',
    context.actorId ?? null,
    targetType,
    targetId,
    JSON.stringify({
      tenant_id: tenantId,
      route: context.route || null,
    }),
    context.ipAddress ?? null,
    context.userAgent ?? null,
    workspaceId
  )
}

export function getWorkspaceForTenant(
  db: Database.Database,
  workspaceId: number,
  tenantId: number
): WorkspaceRecord | null {
  const row = db.prepare(`
    SELECT id, slug, name, tenant_id, brand, isolation, created_at, updated_at
    FROM workspaces
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).get(workspaceId, tenantId) as WorkspaceRecord | undefined
  return row || null
}

export function listWorkspacesForTenant(
  db: Database.Database,
  tenantId: number
): WorkspaceRecord[] {
  return db.prepare(`
    SELECT id, slug, name, tenant_id, brand, isolation, created_at, updated_at
    FROM workspaces
    WHERE tenant_id = ?
    ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, name COLLATE NOCASE ASC
  `).all(tenantId) as WorkspaceRecord[]
}

export function assertWorkspaceTenant(
  db: Database.Database,
  workspaceId: number,
  tenantId: number
): WorkspaceRecord {
  const workspace = getWorkspaceForTenant(db, workspaceId, tenantId)
  if (!workspace) {
    throw new Error('Workspace not found for tenant')
  }
  return workspace
}

export function ensureTenantWorkspaceAccess(
  db: Database.Database,
  tenantId: number,
  workspaceId: number,
  context: AccessAuditContext = {}
): WorkspaceRecord {
  const workspace = getWorkspaceForTenant(db, workspaceId, tenantId)
  if (!workspace) {
    logTenantAccessDenied(db, 'workspace', workspaceId, tenantId, context)
    throw new ForbiddenError('Workspace not accessible for tenant')
  }
  return workspace
}

export function ensureTenantProjectAccess(
  db: Database.Database,
  tenantId: number,
  projectId: number,
  context: AccessAuditContext = {}
): ProjectTenantRecord {
  const project = db.prepare(`
    SELECT p.id, p.workspace_id, w.tenant_id
    FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.id = ?
    LIMIT 1
  `).get(projectId) as ProjectTenantRecord | undefined

  if (!project || project.tenant_id !== tenantId) {
    logTenantAccessDenied(db, 'project', projectId, tenantId, context)
    throw new ForbiddenError('Project not accessible for tenant')
  }

  return project
}
