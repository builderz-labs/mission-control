// Request-level auth helpers: getUserFromRequest, requireRole, workspace/tenant extraction.
// Also owns the plugin hook registry for custom API key resolvers.

import { getDatabase } from '../db'
import { parseMcSessionCookieHeader } from '../session-cookie'
import type { User } from './types'
import { getDefaultWorkspaceContext } from './workspace-context'
import { validateSession } from './session'
import { resolveOrProvisionProxyUser } from './users'
import {
  safeCompare,
  hashApiKey,
  extractApiKeyFromHeaders,
  resolveActiveApiKey,
  parseAgentScopes,
  deriveRoleFromScopes,
} from './api-keys'

// Plugin hook: extensions can register a custom API key resolver without modifying this file.
type AuthResolverHook = (apiKey: string, agentName: string | null) => User | null
let _authResolverHook: AuthResolverHook | null = null

export function registerAuthResolver(hook: AuthResolverHook): void {
  _authResolverHook = hook
}

/**
 * Role hierarchy levels for access control.
 * viewer < operator < admin
 */
const ROLE_LEVELS: Record<string, number> = { viewer: 0, operator: 1, admin: 2 }

export function getUserFromRequest(request: Request): User | null {
  // Extract agent identity header (optional, for attribution)
  const agentName = (request.headers.get('x-agent-name') || '').trim() || null

  // Proxy / trusted-header auth (MC_PROXY_AUTH_HEADER)
  // When the gateway has already authenticated the user and injects their username
  // as a trusted header (e.g. X-Auth-Username from Envoy OIDC claimToHeaders),
  // skip the local login form entirely.
  const proxyAuthHeader = (process.env.MC_PROXY_AUTH_HEADER || '').trim()
  if (proxyAuthHeader) {
    const proxyUsername = (request.headers.get(proxyAuthHeader) || '').trim()
    if (proxyUsername) {
      const user = resolveOrProvisionProxyUser(proxyUsername)
      if (user) return { ...user, agent_name: agentName }
    }
  }

  // Check session cookie
  const cookieHeader = request.headers.get('cookie') || ''
  const sessionToken = parseMcSessionCookieHeader(cookieHeader)
  if (sessionToken) {
    const user = validateSession(sessionToken)
    if (user) return { ...user, agent_name: agentName }
  }

  // Check API key - DB override first, then env var
  const apiKey = extractApiKeyFromHeaders(request.headers)
  const configuredApiKey = resolveActiveApiKey()

  if (configuredApiKey && apiKey && safeCompare(apiKey, configuredApiKey)) {
    return {
      id: 0,
      username: 'api',
      display_name: 'API Access',
      role: 'admin',
      workspace_id: getDefaultWorkspaceContext().workspaceId,
      tenant_id: getDefaultWorkspaceContext().tenantId,
      created_at: 0,
      updated_at: 0,
      last_login_at: null,
      agent_name: agentName,
    }
  }

  // Agent-scoped API keys
  if (apiKey) {
    try {
      const db = getDatabase()
      const keyHash = hashApiKey(apiKey)
      const now = Math.floor(Date.now() / 1000)
      const row = db.prepare(`
        SELECT id, agent_id, workspace_id, scopes, expires_at, revoked_at
        FROM agent_api_keys
        WHERE key_hash = ?
        LIMIT 1
      `).get(keyHash) as {
        id: number
        agent_id: number
        workspace_id: number
        scopes: string
        expires_at: number | null
        revoked_at: number | null
      } | undefined

      if (row && !row.revoked_at && (!row.expires_at || row.expires_at > now)) {
        const scopes = parseAgentScopes(row.scopes)
        const agent = db
          .prepare('SELECT id, name FROM agents WHERE id = ? AND workspace_id = ?')
          .get(row.agent_id, row.workspace_id) as { id: number; name: string } | undefined

        if (agent) {
          if (agentName && agentName !== agent.name && !scopes.has('admin')) {
            return null
          }

          db.prepare('UPDATE agent_api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id)

          return {
            id: -row.id,
            username: `agent:${agent.name}`,
            display_name: agent.name,
            role: deriveRoleFromScopes(scopes),
            workspace_id: row.workspace_id,
            tenant_id: getDefaultWorkspaceContext().tenantId,
            created_at: 0,
            updated_at: now,
            last_login_at: now,
            agent_name: agent.name,
          }
        }
      }
    } catch {
      // ignore missing table / startup race
    }
  }

  // Plugin hook: allow Pro (or other extensions) to resolve custom API keys
  if (apiKey && _authResolverHook) {
    const resolved = _authResolverHook(apiKey, agentName)
    if (resolved) return resolved
  }

  return null
}

/**
 * Check if a user meets the minimum role requirement.
 * Returns { user } on success, or { error, status } on failure (401 or 403).
 */
export function requireRole(
  request: Request,
  minRole: User['role']
): { user: User; error?: never; status?: never } | { user?: never; error: string; status: 401 | 403 } {
  const user = getUserFromRequest(request)
  if (!user) {
    return { error: 'Authentication required', status: 401 }
  }
  if ((ROLE_LEVELS[user.role] ?? -1) < ROLE_LEVELS[minRole]) {
    return { error: `Requires ${minRole} role or higher`, status: 403 }
  }
  return { user }
}

export function getWorkspaceIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.workspace_id || getDefaultWorkspaceContext().workspaceId
}

export function getTenantIdFromRequest(request: Request): number {
  const user = getUserFromRequest(request)
  return user?.tenant_id || getDefaultWorkspaceContext().tenantId
}
