/**
 * Clerk → MC `registerAuthResolver` shim — Phase 3 Lane D scaffold.
 *
 * Wires the Clerk JWT verifier (`clerk-resolver.ts`) and org→tenant
 * map (`clerk-tenant-map.ts`) into the MC auth pipeline via the
 * existing `registerAuthResolver` extension point at
 * `src/lib/auth.ts:36-38`.
 *
 * Bootstrap is gated by `CLERK_SECRET_KEY` presence — when absent,
 * `registerClerkResolver()` is a no-op and MC's existing local /
 * Google / proxy-auth paths run unchanged.
 *
 * Multi-tenant safety: when `CLERK_ORG_TENANT_MAP` is configured,
 * a JWT carrying an unknown / missing org claim resolves to null and
 * the request falls through to the next auth layer (typically
 * rejecting at 401). This matches the spike report §5 requirement.
 *
 * Callers (this PR):
 *   - src/lib/__tests__/clerk-auth-resolver.test.ts
 *   - src/lib/clerk-bootstrap.ts (boot-time hook)
 *
 * Cutover runbook: docs/phase-3-clerk-cutover-runbook.md
 */

import { registerAuthResolver, type User } from './auth'
import {
  resolveClerkJwt,
  getClerkConfigFromEnv,
  type ClerkResolverConfig,
  type ResolveOptions,
  type ResolvedClerkUser,
} from './clerk-resolver'
import {
  loadOrgTenantMap,
  resolveTenant,
  type OrgTenantMap,
  type OrgTenantBinding,
} from './clerk-tenant-map'

export interface RegisterClerkResolverOptions {
  /** Override config for tests; production reads from env. */
  config?: ClerkResolverConfig | null
  /** Override tenant map for tests. */
  orgTenantMap?: OrgTenantMap
  /** Inject a verifier (test seam). */
  resolveOptions?: ResolveOptions
  /**
   * When true, JWTs without an org claim are mapped to the dev-default
   * binding. Off in production — multi-tenant safety requires an
   * explicit org slug. Default: false.
   */
  allowOrglessJwt?: boolean
  /** Inject the registrar for tests so we don't pollute the global hook. */
  registrar?: (hook: ClerkAuthHook) => void
}

type ClerkAuthHook = (apiKey: string, agentName: string | null) => User | null

/**
 * Build a User shape MC can consume from a verified Clerk JWT +
 * tenant binding. Synthetic id of 0 mirrors MC's existing api-key
 * user path; downstream code that needs a stable DB row should run
 * the Phase 3 BUILD D2 (`resolveOrProvisionProxyUser` org gate),
 * which is intentionally out of scope for this scaffold.
 */
export function mapToMcUser(
  clerk: ResolvedClerkUser,
  binding: OrgTenantBinding,
  agentName: string | null = null
): User {
  return {
    id: 0,
    username: clerk.email ?? clerk.clerkUserId,
    display_name: clerk.email ?? clerk.clerkUserId,
    role: 'operator',
    workspace_id: binding.workspaceId,
    tenant_id: binding.tenantId,
    provider: 'proxy',
    email: clerk.email,
    avatar_url: null,
    is_approved: 1,
    created_at: 0,
    updated_at: 0,
    last_login_at: null,
    agent_name: agentName,
  }
}

/**
 * Async resolution path — the path tests and the future async
 * middleware exercise. Returns a User or null.
 */
export async function resolveClerkUser(
  apiKey: string,
  agentName: string | null,
  opts: RegisterClerkResolverOptions = {}
): Promise<User | null> {
  const cfg = opts.config ?? getClerkConfigFromEnv()
  if (!cfg) return null
  if (!apiKey) return null

  const map = opts.orgTenantMap ?? loadOrgTenantMap()
  const clerk = await resolveClerkJwt(apiKey, cfg, opts.resolveOptions ?? {})
  if (!clerk) return null

  const binding =
    resolveTenant(clerk.clerkOrgSlug, map) ??
    (opts.allowOrglessJwt ? map.default ?? null : null)
  if (!binding) return null

  return mapToMcUser(clerk, binding, agentName)
}

/**
 * Synchronous bridge. MC's `registerAuthResolver` signature is
 * synchronous; production cutover will replace this with an explicit
 * async middleware (see runbook §3). For the scaffold's purposes the
 * sync hook acts as a no-op placeholder — async verification happens
 * via `resolveClerkUser` which the bootstrap layer can plug into a
 * middleware shim at cutover time.
 */
function makeSyncHook(_opts: RegisterClerkResolverOptions): ClerkAuthHook {
  return function clerkAuthHookSyncStub(_apiKey: string, _agentName: string | null): User | null {
    // SCAFFOLD: sync hook is a deliberate no-op. Real auth flows
    // through `resolveClerkUser` via the async middleware added at
    // cutover. Registering this stub reserves the hook slot and
    // gives tests / typechecking something concrete to bind to.
    return null
  }
}

/**
 * Register the Clerk hook with MC's auth pipeline.
 * No-ops when `CLERK_SECRET_KEY` is not configured.
 * Returns true when registration happened, false otherwise.
 */
export function registerClerkResolver(opts: RegisterClerkResolverOptions = {}): boolean {
  const cfg = opts.config ?? getClerkConfigFromEnv()
  if (!cfg) return false
  const registrar = opts.registrar ?? registerAuthResolver
  registrar(makeSyncHook(opts))
  return true
}
