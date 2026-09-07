import type Database from 'better-sqlite3'

export type FlyDispatchTask = { id: number; workspace_id: number; metadata?: string | null }
export type FlyDispatchResult = { handled: boolean; deferred: boolean; reason: string }

/**
 * The registry app is an artifact namespace; the worker app is the runtime trust
 * boundary. Both must be explicitly owned, and the reference must stay immutable.
 */
export function flyImageApps(env: Record<string, string | undefined> = process.env): string[] {
  const apps = [env.MC_FLY_WORKER_APP || env.FLY_APP_NAME, ...(env.MC_FLY_IMAGE_APPS || '').split(',')]
  return [...new Set(apps.map(app => (app || '').trim()).filter(app => /^[a-z0-9-]+$/.test(app)))]
}

export function isFlyWorkerImageRef(value: string | undefined, appName?: string): value is string {
  if (!value) return false
  const apps = appName === undefined ? flyImageApps() : [appName].filter(app => /^[a-z0-9-]+$/.test(app))
  return apps.some(app => new RegExp(`^registry\\.fly\\.io/${app}@sha256:[a-f0-9]{64}$`).test(value))
}

/** Dedicated admission owns Fly jobs. Generic local dispatch must not duplicate them. */
export async function dispatchToFly(db: Database.Database, task: FlyDispatchTask): Promise<FlyDispatchResult> {
  const owned = db.prepare('SELECT id FROM fly_submissions WHERE task_id=? AND workspace_id=?').get(task.id, task.workspace_id)
  return { handled: Boolean(owned), deferred: false,
    reason: owned ? 'Dedicated Fly queue owns this task' : 'Submit independent Fly work through mc_submit_fly_leaf' }
}

