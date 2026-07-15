import { basename, dirname, join } from 'node:path'
import { NextResponse } from 'next/server'
import type { User } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDatabase, logAuditEvent } from '@/lib/db'
import type { WorkspaceIsolation } from '@/lib/workspaces'

export type UnscopedWorkspaceResource =
  | 'agent_filesystem'
  | 'local_sessions'
  | 'gateway_sessions'
  | 'host_administration'
  | 'runtime_configuration'
  | 'runtime_tasks'
  | 'session_transcripts'
  | 'session_preferences'
  | 'terminal_sessions'
  | 'runtime_memory'

interface IsolationRecord {
  id: number
  tenant_id: number
  isolation: WorkspaceIsolation
}

export interface WorkspaceMemoryAccess {
  isolation: WorkspaceIsolation
  root: string
  scope: string
}

function readIsolation(user: User): IsolationRecord | null {
  return getDatabase().prepare(`
    SELECT id, tenant_id, isolation
    FROM workspaces
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).get(user.workspace_id, user.tenant_id) as IsolationRecord | undefined || null
}

export function getWorkspaceIsolation(user: User): WorkspaceIsolation | null {
  return readIsolation(user)?.isolation ?? null
}

/**
 * Deployment-global runtimes may populate one shared workspace, but they cannot
 * choose between multiple shared workspaces without ownership metadata.
 */
export function resolveSharedRuntimeWorkspaceId(requestedWorkspaceId?: number): number | null {
  const db = getDatabase()
  if (requestedWorkspaceId !== undefined) {
    const row = db.prepare(`
      SELECT id
      FROM workspaces
      WHERE id = ? AND isolation = 'shared'
      LIMIT 1
    `).get(requestedWorkspaceId) as { id: number } | undefined
    return row?.id ?? null
  }

  const rows = db.prepare(`
    SELECT id
    FROM workspaces
    WHERE isolation = 'shared'
    ORDER BY id
    LIMIT 2
  `).all() as Array<{ id: number }>
  return rows.length === 1 ? rows[0].id : null
}

function auditDenial(user: User, resource: UnscopedWorkspaceResource, route: string): void {
  try {
    logAuditEvent({
      action: 'workspace_isolation_denied',
      actor: user.username || 'unknown',
      actor_id: user.id,
      target_type: 'workspace',
      target_id: user.workspace_id,
      detail: {
        resource,
        route,
        tenant_id: user.tenant_id,
        reason: 'resource_has_no_workspace_ownership',
      },
    })
  } catch {
    // Access control must not depend on audit availability.
  }
}

/**
 * Deployment-global resources cannot be safely filtered for a strict workspace
 * until they carry authoritative workspace ownership. Fail closed and record a
 * minimized decision event; never include session IDs, prompts, or file paths.
 */
export function denyUnscopedResourceForStrictWorkspace(
  user: User,
  resource: UnscopedWorkspaceResource,
  route: string,
): NextResponse | null {
  const workspace = readIsolation(user)
  if (workspace?.isolation !== 'strict') {
    if (workspace) return null
    auditDenial(user, resource, route)
    return NextResponse.json({ error: 'Workspace isolation context is unavailable' }, { status: 403 })
  }

  auditDenial(user, resource, route)
  return NextResponse.json(
    { error: 'This resource is unavailable in strict workspaces because it has no workspace ownership metadata' },
    { status: 403 },
  )
}

/**
 * Shared workspaces intentionally use the configured common memory root.
 * Strict workspaces receive a deterministic workspace-owned subtree and FTS
 * namespace, so file paths and search rows cannot cross workspace boundaries.
 */
export function resolveWorkspaceMemoryAccess(user: User): WorkspaceMemoryAccess | null {
  const base = config.memoryDir
  if (!base) return null

  const workspace = readIsolation(user)
  if (!workspace) return null
  if (workspace.isolation === 'strict') {
    const strictRoot = join(dirname(base), `${basename(base)}-workspaces`, String(workspace.id))
    return {
      isolation: 'strict',
      root: strictRoot,
      scope: `workspace:${workspace.id}`,
    }
  }

  return { isolation: 'shared', root: base, scope: 'shared' }
}
