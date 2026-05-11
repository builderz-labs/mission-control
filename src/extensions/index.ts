/**
 * Extensions index — @stroupaloop/mission-control
 *
 * This is the single mount point for all AMS customizations. Each extension
 * declares its API routes, startup hooks, and scheduled tasks via the manifest
 * in extensions.config.ts. The main application calls `mountExtensions()` once
 * at boot (in src/lib/db.ts alongside initScheduler) to wire everything in.
 *
 * Separation of concerns:
 *   - Upstream files under src/app/api/, src/lib/, src/components/ are untouched
 *     except for the ONE import line added to src/lib/db.ts.
 *   - All AMS-specific logic lives under src/extensions/<area>/.
 *   - This file is the only cross-cutting glue.
 */

import { extensions } from './extensions.config'
import type { ExtensionManifest } from './extensions.config'
import { applyForkDefaults } from './fork-defaults'

// Re-export the type for consumers
export type { ExtensionManifest }

let mounted = false
let extensionTickInterval: ReturnType<typeof setInterval> | null = null

/**
 * Track per-task state (lastRun, running) for the extension task loop.
 * We run extension tasks on a dedicated timer rather than wedging them
 * into the upstream scheduler at `src/lib/scheduler.ts` — that file is
 * NOT one of the approved upstream-touch points per FORK.md, and gating
 * extension tasks through upstream's settings-based enable/disable was
 * the root cause of `litellm_cache_rollup` silently never firing prior
 * to #320.
 *
 * Trade-off: extension tasks no longer show up in the `/api/scheduler`
 * status endpoint (only built-in tasks do). They still run on their
 * declared interval; the visibility cost is acceptable for the contract
 * cleanliness gain. A future fork-only `/api/extensions/scheduled`
 * endpoint can surface them if needed.
 */
type ExtensionTaskState = {
  id: string
  name: string
  intervalMs: number
  fn: () => Promise<{ ok: boolean; message: string }>
  lastRun: number
  running: boolean
}
const extensionTaskState: ExtensionTaskState[] = []
const EXTENSION_TICK_MS = 30_000

/**
 * Register all extension routes and run startup hooks.
 * Called once from src/lib/db.ts after the scheduler is initialized.
 * Safe to call multiple times (idempotent via `mounted` guard).
 */
export async function mountExtensions(): Promise<void> {
  if (mounted) return
  mounted = true

  // AMS fork-level default settings (onboarding bypass, etc.)
  // Runs before any extension hooks so UI preferences are settled before
  // the first page render touches the settings table.
  applyForkDefaults()

  for (const ext of extensions) {
    // Run startup hooks
    if (ext.startupHooks) {
      for (const hook of ext.startupHooks) {
        try {
          await hook()
        } catch (err) {
          console.error(`[extensions] startup hook failed for ${ext.id}:`, err)
        }
      }
    }

    // Register scheduled tasks on the extension-owned timer (not upstream's
    // scheduler — see comment on extensionTaskState above).
    if (ext.scheduledTasks) {
      for (const task of ext.scheduledTasks) {
        extensionTaskState.push({
          id: `${ext.id}:${task.name}`,
          name: task.name,
          intervalMs: task.intervalMs,
          fn: async () => {
            try {
              await task.fn()
              return { ok: true, message: `${ext.id}:${task.name} completed` }
            } catch (err: any) {
              return { ok: false, message: err?.message ?? 'unknown error' }
            }
          },
          lastRun: 0,
          running: false,
        })
      }
    }

    // Note: API routes in Next.js app router are file-based and are wired by
    // placing the handlers in src/extensions/<area>/api/ and re-exporting them
    // from src/app/api/<path>/route.ts shim files. See each extension's api/
    // directory for the handler implementations, and the corresponding shims
    // in src/app/api/ for the Next.js routing entry points.
  }

  // Start the extension task loop if any tasks were registered.
  if (extensionTaskState.length > 0 && !extensionTickInterval) {
    extensionTickInterval = setInterval(extensionTick, EXTENSION_TICK_MS)
    console.info(`[extensions] scheduled ${extensionTaskState.length} task(s) on extension tick (${EXTENSION_TICK_MS}ms)`)
  }
}

async function extensionTick(): Promise<void> {
  const now = Date.now()
  for (const task of extensionTaskState) {
    if (task.running) continue
    if (now - task.lastRun < task.intervalMs) continue
    task.running = true
    task.lastRun = now
    const startedAt = Date.now()
    try {
      const result = await task.fn()
      const durationMs = Date.now() - startedAt
      if (result.ok) {
        console.info(`[extensions] task ${task.id} ok in ${durationMs}ms: ${result.message}`)
      } else {
        console.warn(`[extensions] task ${task.id} returned not-ok in ${durationMs}ms: ${result.message}`)
      }
    } catch (err: any) {
      console.error(`[extensions] task ${task.id} threw:`, err?.message ?? err)
    } finally {
      task.running = false
    }
  }
}

