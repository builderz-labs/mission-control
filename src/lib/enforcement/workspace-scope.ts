/**
 * Workspace Scope Enforcement
 *
 * Central helpers for deriving and enforcing workspace_id boundaries.
 * Routes must not access resources from other workspaces; this module
 * makes that check reusable and fail-closed.
 */

import { NextResponse } from 'next/server'
import type { User } from '@/lib/auth'

/**
 * Derive workspace_id from an authenticated user.
 * Returns null (fail-closed) if workspace_id is missing, non-numeric, or ≤ 0.
 */
export function resolveWorkspaceId(user: User): number | null {
  const id = user.workspace_id
  if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) return null
  return id
}

/**
 * Require a valid workspace_id from an authenticated user.
 * Returns `{ workspaceId }` on success or `{ response }` (400) when missing.
 * Check with `'workspaceId' in result` to discriminate.
 */
export function requireWorkspaceId(
  user: User,
): { workspaceId: number } | { response: NextResponse } {
  const workspaceId = resolveWorkspaceId(user)
  if (workspaceId === null) {
    return {
      response: NextResponse.json({ error: 'Workspace context required' }, { status: 400 }),
    }
  }
  return { workspaceId }
}

/**
 * Check that a resource's workspace_id matches the caller's workspace.
 */
export function isInWorkspace(user: User, resourceWorkspaceId: number): boolean {
  const id = resolveWorkspaceId(user)
  if (id === null) return false
  return id === resourceWorkspaceId
}

/**
 * Enforce workspace boundary for a specific resource.
 * Returns null when access is allowed, or a 403 NextResponse to return directly.
 *
 * Usage:
 *   const deny = enforceWorkspaceBoundary(auth.user, task.workspace_id)
 *   if (deny) return deny
 */
export function enforceWorkspaceBoundary(user: User, resourceWorkspaceId: number): NextResponse | null {
  if (!isInWorkspace(user, resourceWorkspaceId)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  return null
}

/**
 * Enforce that an agent API key can only access its own agent.
 *
 * Accepts the URL path segment which may be a name ("repo-steward") or a
 * numeric DB id ("42"). Compares by agent_id when numeric, by agent_name
 * when a name string. Ambiguous numeric ownership fails closed.
 *
 * Human users (no agent_name) and admin-scoped keys are not restricted.
 *
 * Returns null when access is allowed, or a 403 NextResponse to return directly.
 */
export function requireAgentSelfAccess(user: User, targetAgentIdOrName: string): NextResponse | null {
  if (!user.agent_name) return null
  if (user.role === 'admin') return null

  const targetNumeric = Number(targetAgentIdOrName)
  if (Number.isFinite(targetNumeric) && targetNumeric > 0) {
    // Numeric ID path requires authoritative numeric ownership. Custom auth
    // resolvers that provide only agent_name can use the name-based route.
    if (user.agent_id == null || user.agent_id !== targetNumeric) {
      return NextResponse.json(
        { error: 'Access denied: agent key may only access its own agent.' },
        { status: 403 },
      )
    }
    return null
  }

  // Name-based path
  if (user.agent_name !== targetAgentIdOrName) {
    return NextResponse.json(
      { error: 'Access denied: agent key may only access its own agent.' },
      { status: 403 },
    )
  }
  return null
}

/**
 * Enforce that an agent API key can only access tasks assigned to itself.
 *
 * Human users (no agent_name) and admin-scoped keys are not restricted.
 * Agent-scoped keys (agent_name set, non-admin) may only access tasks
 * where assigned_to matches the key's agent_name.
 *
 * Returns null when access is allowed, or a 403 NextResponse to return directly.
 */
export function requireAgentTaskAccess(user: User, taskAssignedTo: string | null): NextResponse | null {
  if (!user.agent_name) return null
  if (user.role === 'admin') return null
  if (taskAssignedTo !== user.agent_name) {
    return NextResponse.json({ error: 'Access denied: agent key may only access its own tasks.' }, { status: 403 })
  }
  return null
}
