import type Database from 'better-sqlite3'

/** One controller-wide limit shared by admission and every agent status view. */
export function flyWorkerLimit(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.MC_FLY_MAX_WORKERS)
  return Number.isFinite(value) && value >= 1 ? Math.min(30, Math.floor(value)) : 6
}

// Launch pacing protects the provider API; it is not a concurrent worker limit.
export const FLY_LAUNCH_BATCH_SIZE = 3
export const FLY_RECONCILE_INTERVAL_MS = 5_000

/** Ordered launch regions. A second region is tried only when no Machine was created. */
export function flyLaunchRegions(env: Record<string, string | undefined> = process.env): string[] {
  const configured = (env.MC_FLY_REGIONS || env.FLY_REGION || 'iad').split(',').map(value => value.trim()).filter(Boolean)
  return [...new Set(configured)].slice(0, 3)
}

export function flyCapacity(db: Database.Database) {
  const { active } = db.prepare("SELECT COUNT(*) AS active FROM fly_worker_jobs WHERE state IN ('creating','running','cleaning')").get() as { active: number }
  const limit = flyWorkerLimit()
  return {
    scope: 'controller-global', runtime: 'command', worker_app: process.env.MC_FLY_WORKER_APP || null,
    max_workers: limit, active_workers: active, available_slots: Math.max(0, limit - active),
    launch_batch_size: FLY_LAUNCH_BATCH_SIZE, reconcile_interval_ms: FLY_RECONCILE_INTERVAL_MS,
    // A label, not an enforcement point. Machines are created at
    // POST /apps/{MC_FLY_WORKER_APP}/machines with no network field, so the app
    // decides the network and this only names it. Set it when the worker app
    // moves, never on its own: alone it reports an isolation that does not exist.
    worker_network: process.env.MC_FLY_WORKER_NETWORK || 'default-org-6pn',
    launch_regions: flyLaunchRegions(),
    fair_share_note: 'One project or session may use the whole pool while nothing else waits, then yields an equal share.',
    native_subagent_limit: null,
    native_subagent_note: 'Native LLM slots belong to the agent host and do not limit this shared Fly command pool.',
    scheduling_note: 'Available slots remain subject to readiness, budgets and provider capacity.',
  }
}
