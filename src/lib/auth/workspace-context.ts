// Workspace / tenant resolution helpers shared across the auth domain.
// Extracted to avoid circular imports: both session.ts and users.ts need these.

import { getDatabase } from '../db'

export function getDefaultWorkspaceContext(): { workspaceId: number; tenantId: number } {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT id, tenant_id
      FROM workspaces
      ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get() as { id?: number; tenant_id?: number } | undefined
    return {
      workspaceId: row?.id || 1,
      tenantId: row?.tenant_id || 1,
    }
  } catch {
    return { workspaceId: 1, tenantId: 1 }
  }
}

export function resolveTenantForWorkspace(workspaceId: number): number {
  const db = getDatabase()
  const row = db.prepare(`SELECT tenant_id FROM workspaces WHERE id = ? LIMIT 1`).get(workspaceId) as { tenant_id?: number } | undefined
  return row?.tenant_id || getDefaultWorkspaceContext().tenantId
}
