/**
 * Clerk auth-resolver boot-time hook — Phase 3 Lane D scaffold.
 *
 * Conditionally installs the Clerk JWT resolver when MC starts. The
 * hook is gated by env (`CLERK_SECRET_KEY`) so existing tenants that
 * still run CF Access at the proxy edge are unaffected.
 *
 * Wiring: imported + invoked from `plugin-loader.ts` (or any other
 * boot-time entrypoint) once. Idempotent: safe to call twice — the
 * second call is a no-op via the moduleScoped `_installed` flag.
 *
 * Callers (this PR):
 *   - src/lib/plugin-loader.ts (boot-time hook)
 *   - src/lib/__tests__/clerk-auth-resolver.test.ts (verified via injection)
 *
 * Cutover runbook: docs/phase-3-clerk-cutover-runbook.md
 */

import { registerClerkResolver } from './clerk-auth-resolver'

let _installed = false

/**
 * Install the Clerk auth resolver if env is configured. Safe to call
 * multiple times; only the first successful registration takes effect.
 */
export function installClerkAuthResolver(): boolean {
  if (_installed) return true
  const ok = registerClerkResolver()
  if (ok) {
    _installed = true
    // Boot-time stdout log — kept narrow so logs aren't polluted on
    // every dev start where Clerk is absent.
    // eslint-disable-next-line no-console
    console.info('[clerk] auth resolver registered (Phase 3 scaffold)')
  }
  return ok
}

/**
 * Test-only reset hook. Resets the `_installed` flag so the next call
 * re-runs. Not exported from any production callsite.
 */
export function _resetForTests(): void {
  _installed = false
}
