'use client'

/**
 * Client-side extension registration.
 *
 * Next.js App Router has two separate module graphs (server + client). The
 * extension manifest (extensions.config.ts) is shared data, but React component
 * references must live in the client graph. This file is the single entrypoint
 * that populates the client-side plugin registry (panels + nav items) at
 * module-load time, before any client component renders.
 *
 * Imported for side-effect by src/extensions/ClientBoot.tsx, which is rendered
 * once inside the root layout. Do not import this from server code.
 */

import type { ComponentType } from 'react'
import { registerPanel, registerNavItems, type PluginNavItem } from '@/lib/plugins'
import { clientExtensions } from './manifest.client'

// ── Panel component registry (string id \u2192 React component) ──────────────────
//
// Each extension's panel component is imported here statically so it lands in
// the client bundle and the componentMap is populated synchronously at module
// load. The manifest only carries string ids, keeping it safe to share with
// the server graph.

import { ResolverIntelligencePanel } from './resolver/panels/intelligence-panel'
import { OapApprovalsPanel } from './oap/panels/approvals-panel'
import { AuditTrailPanel } from './oap/panels/audit-trail-panel'
import { LitellmUsagePanel } from './litellm/panels/usage-panel'
import { FleetPanel } from './fleet/panels/fleet-panel'

const componentMap: Record<string, ComponentType> = {
  'resolver-intelligence': ResolverIntelligencePanel,
  'oap-approvals': OapApprovalsPanel,
  'oap-audit': AuditTrailPanel,
  'litellm-usage': LitellmUsagePanel,
  fleet: FleetPanel,
  // mcp and security-audit are backend-only — no panels.
}

// ── Register nav items + panels (idempotent by construction) ────────────────
//
// Module-scope execution happens once per client-graph instantiation. The
// upstream registries dedup on ID (see src/lib/plugins.ts), so even if HMR
// re-executes this module in dev, re-registration is a no-op.

const navItems: PluginNavItem[] = []

for (const ext of clientExtensions) {
  if (!ext.panels) continue
  for (const panel of ext.panels) {
    const component = componentMap[panel.id]
    if (!component) {
      // Manifest declared a panel we don't have a component for \u2014 log and skip
      // rather than crash. This can legitimately happen during staged rollouts.
      // eslint-disable-next-line no-console
      console.warn(
        `[extensions/client] panel "${panel.id}" declared in manifest but no component found in componentMap`,
      )
      continue
    }
    registerPanel(panel.id, component)
    navItems.push({
      id: panel.id,
      label: panel.label,
      icon: panel.icon,
      groupId: panel.groupId,
    })
  }
}

// Symbol-guarded one-time registration. Upstream `registerNavItems` appends
// blindly, which means HMR / React Strict Mode / repeat module loads in dev
// would duplicate every nav item. `Symbol.for` is keyed on the global symbol
// registry so it survives module re-evaluation. This keeps the dedup logic
// out of `src/lib/plugins.ts` and lets that upstream file stay byte-clean.
//
// IMPORTANT: this guard only protects this call site. If a future extension
// or upstream consumer calls `registerNavItems` from somewhere else, that
// caller is responsible for its own dedup (upstream's implementation is
// append-blind). When adding new extension nav items, route them through
// this file's `navItems` collection so they participate in the single guarded
// call; do not call `registerNavItems` directly from elsewhere.
// Exported so tests can clear it between runs without re-declaring the
// string literal (which would silently desync if the key here ever rotates).
export const FORK_NAV_REGISTERED = Symbol.for('@stroupaloop/mc-fork:nav-registered')
type GlobalWithFlag = typeof globalThis & { [FORK_NAV_REGISTERED]?: boolean }
const _globalWithFlag = globalThis as GlobalWithFlag
if (navItems.length > 0 && !_globalWithFlag[FORK_NAV_REGISTERED]) {
  registerNavItems(navItems)
  _globalWithFlag[FORK_NAV_REGISTERED] = true
}

// Export for testability \u2014 allows unit tests to verify what got registered
// without triggering side effects they'd otherwise need to stub out.
export const __clientExtensionsRegistered = {
  panels: Object.keys(componentMap),
  navItems: navItems.map((n) => n.id),
}
