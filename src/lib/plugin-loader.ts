/**
 * Plugin Loader
 *
 * Simple explicit loader following the initPro() pattern.
 * Plugins register via direct import + init() call.
 *
 * Dynamic MC_PLUGINS env-based loading can be added later.
 */

import { installClerkAuthResolver } from './clerk-bootstrap'

export function loadPlugins(): void {
  // Plugins register via direct import + init() call.
  // Example:
  //   import { initHyperbrowserPlugin } from '@/plugins/hyperbrowser'
  //   initHyperbrowserPlugin()

  // Phase 3 scaffold: conditionally install Clerk auth resolver.
  // No-op when CLERK_SECRET_KEY is unset (existing CF Access tenants).
  installClerkAuthResolver()
}
