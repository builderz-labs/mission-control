import type Database from 'better-sqlite3'

export type FlyDispatchTask = { id: number; workspace_id: number; metadata?: string | null }
export type FlyDispatchResult = { handled: boolean; deferred: boolean; reason: string }

export function isFlyWorkerImageRef(value: string | undefined, appName = process.env.MC_FLY_WORKER_APP || process.env.FLY_APP_NAME): value is string {
  if (!value || !appName || !/^[a-z0-9-]+$/.test(appName)) return false
  return new RegExp(`^registry\\.fly\\.io/${appName}@sha256:[a-f0-9]{64}$`).test(value)
}

/** Dedicated admission owns Fly jobs. Generic local dispatch must not duplicate them. */
export async function dispatchToFly(db: Database.Database, task: FlyDispatchTask): Promise<FlyDispatchResult> {
  const owned = db.prepare('SELECT id FROM fly_submissions WHERE task_id=? AND workspace_id=?').get(task.id, task.workspace_id)
  return { handled: Boolean(owned), deferred: false,
    reason: owned ? 'Dedicated Fly queue owns this task' : 'Submit independent Fly work through mc_submit_fly_leaf' }
}

