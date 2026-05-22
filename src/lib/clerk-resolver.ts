/**
 * Clerk JWT verifier shim — Phase 3 Lane D scaffold.
 *
 * Verifies incoming Clerk-signed JWTs against the Clerk Backend API and
 * extracts the claims Mission Control needs to map the user into its own
 * users / workspaces / tenants tables.
 *
 * SCAFFOLD ONLY: not wired into runtime auth at module load. The
 * `clerk-auth-resolver` shim registers this with `registerAuthResolver`
 * when `CLERK_SECRET_KEY` is present at boot.
 *
 * Callers (this PR):
 *   - src/lib/clerk-auth-resolver.ts (resolver-hook registrar)
 *   - src/lib/__tests__/clerk-resolver.test.ts
 *
 * Cutover runbook: docs/phase-3-clerk-cutover-runbook.md
 */

export interface ClerkResolverConfig {
  /** Clerk publishable key (pk_*). Identifies the Clerk instance. */
  publishableKey: string
  /** Clerk secret key (sk_*). Used by `@clerk/backend` verifyToken. */
  secretKey: string
  /**
   * Optional explicit JWT verification key (PEM). When present, allows
   * offline verification without a network call to Clerk JWKS.
   */
  jwtKey?: string
  /** Expected `aud` claim — typically the MC instance hostname. */
  expectedAudience?: string
}

export interface ResolvedClerkUser {
  /** Clerk user id (e.g. `user_2abc...`). Stable per-user. */
  clerkUserId: string
  /** Clerk org id (e.g. `org_2def...`). Null when the JWT carries no org claim. */
  clerkOrgId: string | null
  /** Clerk org slug (e.g. `ceremonia`). Used for tenant lookup. */
  clerkOrgSlug: string | null
  /** Primary email when present in the JWT. */
  email: string | null
  /** Raw expiration epoch seconds — useful for telemetry / logging. */
  expiresAt: number | null
}

/**
 * Minimal verifier interface so tests can substitute a fake without
 * pulling `@clerk/backend` into the test runtime. Production wiring
 * passes a closure over `verifyToken` from `@clerk/backend`.
 */
export type ClerkTokenVerifier = (
  token: string,
  options: { secretKey: string; jwtKey?: string; audience?: string }
) => Promise<Record<string, unknown>>

export interface ResolveOptions {
  /**
   * Optional injected verifier — primarily for tests. When omitted, the
   * resolver attempts a dynamic `import('@clerk/backend')`. This keeps
   * `@clerk/backend` out of MC's hard dependency tree until cutover.
   */
  verifier?: ClerkTokenVerifier
}

const DEFAULT_AUDIENCE_FALLBACK = undefined

/**
 * Extract the bits we care about from a verified Clerk JWT payload.
 * Clerk's standard JWT claims (per Clerk docs):
 *   - `sub`         user id
 *   - `o.id`        active org id (when issued in org context)
 *   - `o.slg`       active org slug
 *   - `email`       primary email (set up via JWT template — defensive)
 *   - `exp`         expiration epoch seconds
 */
function shapeClaims(raw: Record<string, unknown>): ResolvedClerkUser | null {
  const sub = typeof raw.sub === 'string' ? raw.sub : null
  if (!sub) return null

  const orgClaim = (raw.o ?? {}) as { id?: unknown; slg?: unknown }
  const clerkOrgId = typeof orgClaim.id === 'string' ? orgClaim.id : null
  const clerkOrgSlug = typeof orgClaim.slg === 'string' ? orgClaim.slg : null
  const email = typeof raw.email === 'string' ? raw.email : null
  const expiresAt = typeof raw.exp === 'number' ? raw.exp : null

  return {
    clerkUserId: sub,
    clerkOrgId,
    clerkOrgSlug,
    email,
    expiresAt,
  }
}

/**
 * Verify a Clerk JWT and return a shaped user record, or null on any
 * failure mode (expired, wrong audience, malformed, network error).
 * Errors are intentionally swallowed — auth layers treat null as
 * "fall through to the next resolver" rather than 500.
 */
export async function resolveClerkJwt(
  token: string,
  cfg: ClerkResolverConfig,
  opts: ResolveOptions = {}
): Promise<ResolvedClerkUser | null> {
  if (!token || typeof token !== 'string') return null
  if (!cfg.secretKey) return null

  const verifier = opts.verifier ?? (await loadDefaultVerifier())
  if (!verifier) return null

  try {
    const claims = await verifier(token, {
      secretKey: cfg.secretKey,
      jwtKey: cfg.jwtKey,
      audience: cfg.expectedAudience ?? DEFAULT_AUDIENCE_FALLBACK,
    })
    return shapeClaims(claims)
  } catch {
    return null
  }
}

/**
 * Lazy-load `@clerk/backend.verifyToken`. Returns null when the package
 * isn't installed — keeps Phase 3 scaffolding from breaking builds on
 * existing tenants that haven't cut over yet.
 *
 * Uses an indirect specifier so Vite/Vitest's static analyzer can't
 * resolve the module at build time (it'd fail when `@clerk/backend`
 * isn't installed yet). Phase 3 BUILD's cutover step adds the
 * dependency, at which point this resolves naturally at runtime.
 */
async function loadDefaultVerifier(): Promise<ClerkTokenVerifier | null> {
  const specifier = '@clerk/backend'
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dynImport: (s: string) => Promise<any> = new Function(
      's',
      'return import(s)'
    ) as (s: string) => Promise<unknown> as (s: string) => Promise<any>
    const mod = await dynImport(specifier)
    if (typeof mod?.verifyToken === 'function') {
      return mod.verifyToken as ClerkTokenVerifier
    }
    return null
  } catch {
    return null
  }
}

/**
 * Read config from environment with no I/O. Returns null if the
 * required `CLERK_SECRET_KEY` is missing — caller treats that as
 * "Clerk path disabled, fall back to other auth resolvers".
 */
export function getClerkConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): ClerkResolverConfig | null {
  const secretKey = (env.CLERK_SECRET_KEY || '').trim()
  if (!secretKey) return null
  return {
    publishableKey: (env.CLERK_PUBLISHABLE_KEY || '').trim(),
    secretKey,
    jwtKey: (env.CLERK_JWT_KEY || '').trim() || undefined,
    expectedAudience: (env.CLERK_JWT_AUDIENCE || '').trim() || undefined,
  }
}
