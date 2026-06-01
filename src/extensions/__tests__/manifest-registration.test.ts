/**
 * Fork-regression: extension manifest + client registration contract.
 *
 * Catches integration-shape failures that per-extension unit tests miss:
 *   - A scheduled task disappears from the manifest (silent drop after rebase).
 *   - A panel's componentMap entry goes missing (renders as upstream-blank).
 *   - The Symbol-guarded one-time nav registration regresses to append-blind
 *     behavior (HMR / Strict Mode would duplicate every nav item).
 *
 * Sibling to `client-boot.test.ts` (onboarding suppression) and
 * `fork-contract.test.ts` (upstream byte-clean check, ships separately).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FORK_NAV_REGISTERED } from '../client'

// ── Server-side: scheduled task contract ─────────────────────────────────────
//
// The manifest in extensions.config.ts is the source of truth for what
// mountExtensions() registers. Test the manifest directly rather than poking
// the module-private extensionTaskState array — same guarantee, no test-only
// production-code export required.

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({}),
}))

vi.mock('../resolver/telemetry', () => ({
  ensureResolverTables: vi.fn(),
  ingestResolverTelemetry: vi.fn(),
  rebuildResolverDailyMetrics: vi.fn(),
}))

vi.mock('../litellm/cache-metrics', () => ({
  ensureCacheDailyTable: vi.fn(),
  rollupCacheMetrics: vi.fn(() => ({ rows_upserted: 0 })),
}))

vi.mock('../litellm/usage', () => ({
  ensureLitellmUsageTable: vi.fn(),
}))

describe('extensions.config — scheduled task manifest', () => {
  it('declares exactly the 3 expected scheduled tasks across all extensions', async () => {
    const { extensions } = await import('../extensions.config')
    const taskIds = extensions
      .flatMap((ext) => (ext.scheduledTasks ?? []).map((t) => `${ext.id}:${t.name}`))
      .sort()
    expect(taskIds).toEqual(
      [
        'litellm:litellm_cache_rollup',
        'resolver:resolver_metrics_rollup',
        'resolver:resolver_telemetry_ingest',
      ].sort(),
    )
  })

  it('every scheduled task has a positive intervalMs and an async fn', async () => {
    const { extensions } = await import('../extensions.config')
    for (const ext of extensions) {
      for (const task of ext.scheduledTasks ?? []) {
        expect(task.intervalMs, `${ext.id}:${task.name}`).toBeGreaterThan(0)
        expect(typeof task.fn, `${ext.id}:${task.name}`).toBe('function')
      }
    }
  })

  it('every scheduled task fn invokes its declared inner function (no empty bodies)', async () => {
    // Catches two regression classes at once:
    //   1. Task body throws synchronously → we'd see this as a rejection here.
    //   2. Task body is silently emptied (e.g., `async () => {}` after a
    //      refactor that orphaned the inner call) → we'd see this as the
    //      mock not being called. Without this assertion, an empty body
    //      would pass `resolves.not.toThrow` trivially.
    const { extensions } = await import('../extensions.config')
    const telemetry = await import('../resolver/telemetry')
    const cacheMetrics = await import('../litellm/cache-metrics')
    const innerByTaskId: Record<string, ReturnType<typeof vi.fn>> = {
      'resolver:resolver_telemetry_ingest': telemetry.ingestResolverTelemetry as unknown as ReturnType<typeof vi.fn>,
      'resolver:resolver_metrics_rollup': telemetry.rebuildResolverDailyMetrics as unknown as ReturnType<typeof vi.fn>,
      'litellm:litellm_cache_rollup': cacheMetrics.rollupCacheMetrics as unknown as ReturnType<typeof vi.fn>,
    }
    for (const ext of extensions) {
      for (const task of ext.scheduledTasks ?? []) {
        const id = `${ext.id}:${task.name}`
        const inner = innerByTaskId[id]
        expect(inner, `no inner-fn mapping for ${id}`).toBeDefined()
        inner.mockClear()
        await expect(task.fn(), `${id} threw under happy-path mocks`).resolves.not.toThrow()
        expect(inner, `${id} did not invoke its inner function`).toHaveBeenCalled()
      }
    }
  })

  it('declares the expected api routes per extension (nav-registration sibling check)', async () => {
    const { extensions } = await import('../extensions.config')
    const byId = Object.fromEntries(extensions.map((e) => [e.id, e]))
    expect(byId.resolver.apiRoutes.map((r) => r.path)).toContain('/resolver/metrics')
    expect(byId.litellm.apiRoutes.map((r) => r.path)).toContain('/litellm/usage/summary')
    expect(byId.oap.apiRoutes.map((r) => r.path)).toContain('/oap/approvals')
    expect(byId.fleet.apiRoutes.map((r) => r.path)).toContain('/fleet/services')
    expect(byId.fleet.apiRoutes.map((r) => r.path)).toContain('/fleet/bulk-redeploy')
    expect(byId.mcp.apiRoutes.map((r) => r.path)).toContain('/mcp-audit/verify')
    expect(byId['security-audit'].apiRoutes.map((r) => r.path)).toContain('/security-audit')
  })
})

// ── Client-side: nav registration + Symbol guard ─────────────────────────────
//
// client.ts populates the upstream plugin registry via `registerNavItems` /
// `registerPanel`. The Symbol-keyed one-time guard prevents re-registration
// across HMR / React Strict Mode. Verify both shapes here.

// vi.mock factories are hoisted above top-level const declarations, so the
// mock fns must be initialized inside `vi.hoisted` to avoid a TDZ error.
const { registerNavItemsMock, registerPanelMock } = vi.hoisted(() => ({
  registerNavItemsMock: vi.fn(),
  registerPanelMock: vi.fn(),
}))

vi.mock('@/lib/plugins', () => ({
  registerNavItems: (items: unknown[]) => registerNavItemsMock(items),
  registerPanel: (id: string, component: unknown) => registerPanelMock(id, component),
}))

describe('client.ts — nav + panel registration', () => {
  beforeEach(() => {
    registerNavItemsMock.mockClear()
    registerPanelMock.mockClear()
    // Symbol.for keys live on the global registry — clear so each test
    // starts from a clean slate.
    delete (globalThis as Record<symbol, unknown>)[FORK_NAV_REGISTERED]
    vi.resetModules()
  })

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[FORK_NAV_REGISTERED]
  })

  it('registers the expected 5 panels via registerPanel (one per UI extension)', async () => {
    // Assert the actual registration receipt — not the static componentMap
    // shape. A regression that drops the registerPanel loop would still
    // leave componentMap intact, so reading registerPanelMock.calls is the
    // load-bearing check.
    await import('../client')
    const registeredIds = registerPanelMock.mock.calls.map((c) => c[0] as string).sort()
    expect(registeredIds).toEqual(
      ['fleet', 'litellm-usage', 'oap-approvals', 'oap-audit', 'resolver-intelligence'],
    )
  })

  it('registers nav items for every panel declared in clientExtensions', async () => {
    const { __clientExtensionsRegistered } = await import('../client')
    expect(__clientExtensionsRegistered.navItems.sort()).toEqual(
      ['fleet', 'litellm-usage', 'oap-approvals', 'oap-audit', 'resolver-intelligence'],
    )
  })

  it('calls registerNavItems exactly once per process (Symbol guard works)', async () => {
    await import('../client')
    expect(registerNavItemsMock).toHaveBeenCalledTimes(1)

    // Re-import after resetModules → fresh module evaluation. The Symbol
    // flag survives on globalThis, so the second eval must not re-register.
    vi.resetModules()
    await import('../client')
    expect(registerNavItemsMock).toHaveBeenCalledTimes(1)
  })

  it('passes nav items with the expected shape (id + label + groupId + icon)', async () => {
    await import('../client')
    const calls = registerNavItemsMock.mock.calls
    expect(calls).toHaveLength(1)
    const items = calls[0][0] as Array<{
      id: string
      label: string
      groupId: string
      icon: string
    }>
    for (const item of items) {
      expect(item.id).toBeTypeOf('string')
      expect(item.label).toBeTypeOf('string')
      expect(item.groupId).toBeTypeOf('string')
      expect(item.icon).toBeTypeOf('string')
    }
  })
})
