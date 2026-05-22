/**
 * Clerk org slug → MC internal tenant/workspace mapping.
 *
 * The MC database uses integer FK tenant_id / workspace_id. Clerk
 * carries an org slug claim in its JWT (`o.slg`). This module is the
 * narrow bridge.
 *
 * Source of truth: env var `CLERK_ORG_TENANT_MAP` as JSON, e.g.
 *
 *   CLERK_ORG_TENANT_MAP='{"ceremonia":{"tenantId":1,"workspaceId":1},"eric":{"tenantId":2,"workspaceId":2}}'
 *
 * When unset, falls back to a single-tenant dev map so local-dev
 * doesn't require env wiring.
 *
 * SCAFFOLD ONLY — Phase 3 cutover provisions per-tenant maps via
 * the docker-compose env file. No DB-backed map yet.
 *
 * Callers (this PR):
 *   - src/lib/clerk-auth-resolver.ts
 *   - src/lib/__tests__/clerk-tenant-map.test.ts
 */

export interface OrgTenantBinding {
  tenantId: number
  workspaceId: number
}

export interface OrgTenantMap {
  [clerkOrgSlug: string]: OrgTenantBinding
}

const DEV_FALLBACK_MAP: OrgTenantMap = Object.freeze({
  // Dev convenience — matches MC's getDefaultWorkspaceContext fallback (workspace 1, tenant 1)
  default: { tenantId: 1, workspaceId: 1 },
}) as OrgTenantMap

/**
 * Parse the env-var JSON. Returns the dev fallback on missing/invalid JSON.
 * Never throws — bad config logs through caller, doesn't crash boot.
 */
export function loadOrgTenantMap(
  env: Record<string, string | undefined> = process.env
): OrgTenantMap {
  const raw = (env.CLERK_ORG_TENANT_MAP || '').trim()
  if (!raw) return DEV_FALLBACK_MAP

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEV_FALLBACK_MAP
    }
    const validated: OrgTenantMap = {}
    for (const [slug, binding] of Object.entries(parsed as Record<string, unknown>)) {
      if (!binding || typeof binding !== 'object') continue
      const b = binding as { tenantId?: unknown; workspaceId?: unknown }
      if (typeof b.tenantId !== 'number' || typeof b.workspaceId !== 'number') continue
      if (!Number.isInteger(b.tenantId) || !Number.isInteger(b.workspaceId)) continue
      if (b.tenantId < 1 || b.workspaceId < 1) continue
      validated[slug] = { tenantId: b.tenantId, workspaceId: b.workspaceId }
    }
    // Empty after validation → fall back to dev map so we don't lock everyone out
    return Object.keys(validated).length > 0 ? validated : DEV_FALLBACK_MAP
  } catch {
    return DEV_FALLBACK_MAP
  }
}

/**
 * Resolve a Clerk org slug to a MC tenant/workspace binding.
 * Returns null when:
 *   - org slug is null (Clerk JWT had no org claim)
 *   - org slug is not in the map (unknown tenant — fail closed)
 * Caller decides whether null → reject vs default-workspace.
 */
export function resolveTenant(
  orgSlug: string | null,
  map: OrgTenantMap = loadOrgTenantMap()
): OrgTenantBinding | null {
  if (!orgSlug) return null
  const binding = map[orgSlug]
  return binding ?? null
}
