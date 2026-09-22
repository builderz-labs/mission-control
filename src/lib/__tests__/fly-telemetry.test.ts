// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'
import { buildFlyTelemetry } from '../fly-telemetry'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db)
  for (const [key, value] of Object.entries({
    MC_FLY_ENABLED: 'true', FLY_API_TOKEN: 'test-only', MC_FLY_WORKER_APP: 'workers', MC_FLY_POLL_PROTOCOL: '1',
    MC_FLY_ALLOWED_REPOS: 'https://github.com/example/repo.git',
    MC_FLY_CORE_IMAGE: 'registry.fly.io/workers@sha256:' + 'a'.repeat(64), MC_FLY_CORE_SMALL_HOURLY_USD: '0.10',
    MC_FLY_PER_JOB_BUDGET_USD: '1', MC_FLY_DAILY_BUDGET_USD: '10', MC_FLY_MONTHLY_BUDGET_USD: '100',
    MC_FLY_MAX_WORKERS: '4', MC_FLY_REGIONS: 'iad',
  })) vi.stubEnv(key, value)
})
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

const setting = (value: string) =>
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('fly.enabled', value)

it('reports a configured, admitting pool as healthy', () => {
  expect(buildFlyTelemetry(db, 1).status).toBe('healthy')
})

it('does not report healthy while the fly.enabled setting has admission paused', () => {
  setting('false')
  const snapshot = buildFlyTelemetry(db, 1)
  // The reconciler still drains running jobs with admission off, so an operator
  // reading `healthy` would think new work was starting when none can.
  expect(snapshot.status).toBe('blocked')
  expect(snapshot.bottlenecks.map(entry => entry.label)).toContain('Admission paused by the fly.enabled setting')
})

it('treats the setting being absent as admitting, matching the scheduler default', () => {
  expect(db.prepare("SELECT value FROM settings WHERE key='fly.enabled'").get()).toBeUndefined()
  expect(buildFlyTelemetry(db, 1).status).toBe('healthy')
})

it('keeps the subsystem-off state distinct from a paused one', () => {
  vi.stubEnv('MC_FLY_ENABLED', 'false')
  setting('false')
  expect(buildFlyTelemetry(db, 1).status).toBe('disabled')
})
