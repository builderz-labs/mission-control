// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { flyCapacity, flyWorkerLimit } from '../fly-capacity'

afterEach(() => vi.unstubAllEnvs())
it('normalizes the single reservation and reporting limit', () => {
  expect(flyWorkerLimit({ MC_FLY_MAX_WORKERS: '25' })).toBe(25)
  expect(flyWorkerLimit({ MC_FLY_MAX_WORKERS: '25.9' })).toBe(25)
  expect(flyWorkerLimit({ MC_FLY_MAX_WORKERS: '100' })).toBe(30)
  for (const value of ['', 'NaN', '-1', '0.5']) expect(flyWorkerLimit({ MC_FLY_MAX_WORKERS: value })).toBe(6)
})
it('counts every workspace reservation, including unknown launches and pending cleanup', () => {
  vi.stubEnv('MC_FLY_MAX_WORKERS', '25')
  const db = new Database(':memory:')
  try {
    db.exec("CREATE TABLE fly_worker_jobs(state TEXT,workspace_id INTEGER); INSERT INTO fly_worker_jobs VALUES ('creating',1),('running',2),('cleaning',2),('succeeded',1)")
    expect(flyCapacity(db)).toMatchObject({ scope: 'controller-global', max_workers: 25, active_workers: 3, available_slots: 22, launch_batch_size: 3, reconcile_interval_ms: 5000, native_subagent_limit: null })
    vi.stubEnv('MC_FLY_MAX_WORKERS', '2')
    expect(flyCapacity(db).available_slots).toBe(0)
  } finally { db.close() }
})
