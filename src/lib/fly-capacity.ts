import type Database from 'better-sqlite3'

/** One controller-wide limit shared by admission and every agent status view. */
export function flyWorkerLimit(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.MC_FLY_MAX_WORKERS)
  return Number.isFinite(value) && value >= 1 ? Math.min(30, Math.floor(value)) : 6
}

// Launch pacing protects the provider API; it is not a concurrent worker limit.
export const FLY_LAUNCH_BATCH_SIZE = 3
export const FLY_RECONCILE_INTERVAL_MS = 5_000

export function flyCapacity(db: Database.Database) {
  const { active } = db.prepare("SELECT COUNT(*) AS active FROM fly_worker_jobs WHERE state IN ('creating','running','cleaning')").get() as { active: number }
  const limit = flyWorkerLimit()
  return {
    scope: 'controller-global', runtime: 'command', worker_app: process.env.MC_FLY_WORKER_APP || null,
    max_workers: limit, active_workers: active, available_slots: Math.max(0, limit - active),
    launch_batch_size: FLY_LAUNCH_BATCH_SIZE, reconcile_interval_ms: FLY_RECONCILE_INTERVAL_MS,
    native_subagent_limit: null,
    native_subagent_note: 'Native LLM slots belong to the agent host and do not limit this shared Fly command pool.',
    scheduling_note: 'Available slots remain subject to readiness, budgets and provider capacity.',
  }
}
