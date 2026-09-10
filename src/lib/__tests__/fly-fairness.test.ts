// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, expect, it, vi } from 'vitest'
import { flyFairOrder, flyQueueIsContended, flyRepositoryDailyCap, flyRepositorySpendToday } from '../fly-fairness'
import { flyLaunchRegions } from '../fly-capacity'

const A = 'https://github.com/o/a.git'
const B = 'https://github.com/o/b.git'

afterEach(() => vi.unstubAllEnvs())

function seed() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE fly_worker_jobs(id TEXT,submission_id TEXT,repository TEXT,state TEXT,
    estimated_cost_usd REAL DEFAULT 0,observed_cost_usd REAL DEFAULT 0,created_at INTEGER DEFAULT 0,completed_at INTEGER);
    CREATE TABLE fly_submissions(id TEXT,session_id TEXT,state TEXT,payload TEXT);`)
  return db
}

function queued(rows: Array<[string, string, string | null]>) {
  return rows.map(([id, repository, session_id]) => ({ id, session_id, payload: JSON.stringify({ repository }) }))
}

it('leaves an uncontended project in priority order so no slot is wasted', () => {
  const db = seed()
  try {
    const rows = queued([['q1', A, 's1'], ['q2', A, 's1'], ['q3', A, 's1']])
    expect(flyFairOrder(db, rows, 25).map(row => row.id)).toEqual(['q1', 'q2', 'q3'])
  } finally { db.close() }
})

it('defers a project already holding its share behind a waiting project', () => {
  const db = seed()
  try {
    db.exec(`INSERT INTO fly_worker_jobs(id,submission_id,repository,state) VALUES
      ('j1','s_a1','${A}','running'),('j2','s_a2','${A}','running');
      INSERT INTO fly_submissions(id,session_id,state) VALUES ('s_a1','claude','running'),('s_a2','claude','running');`)
    // Two contenders against a limit of 4 gives each a share of 2; A already holds it.
    const rows = queued([['q1', A, 'claude'], ['q2', B, 'codex']])
    expect(flyFairOrder(db, rows, 4).map(row => row.id)).toEqual(['q2', 'q1'])
  } finally { db.close() }
})

it('applies the same share to a single agent session across projects', () => {
  const db = seed()
  try {
    db.exec(`INSERT INTO fly_worker_jobs(id,submission_id,repository,state) VALUES
      ('j1','s1','${A}','running'),('j2','s2','${B}','creating');
      INSERT INTO fly_submissions(id,session_id,state) VALUES ('s1','kimi','running'),('s2','kimi','running');`)
    const rows = queued([['q1', A, 'kimi'], ['q2', B, 'grok']])
    expect(flyFairOrder(db, rows, 4).map(row => row.id)).toEqual(['q2', 'q1'])
  } finally { db.close() }
})

it('reports contention only when another project is queued', () => {
  const db = seed()
  try {
    db.exec(`INSERT INTO fly_submissions(id,session_id,state,payload) VALUES
      ('s1','claude','queued','{"repository":"${A}"}')`)
    expect(flyQueueIsContended(db, A)).toBe(false)
    expect(flyQueueIsContended(db, B)).toBe(true)
  } finally { db.close() }
})

it('counts reserved and observed project spend for the day', () => {
  const db = seed()
  try {
    db.exec(`INSERT INTO fly_worker_jobs(id,submission_id,repository,state,estimated_cost_usd,observed_cost_usd,created_at,completed_at)
      VALUES ('j1','s1','${A}','running',0.20,0.05,100,NULL),
             ('j2','s1','${A}','succeeded',0.20,0.07,100,150),
             ('j3','s1','${B}','succeeded',0.20,0.90,100,150)`)
    expect(flyRepositorySpendToday(db, A, 100)).toBeCloseTo(0.27, 5)
    expect(flyRepositorySpendToday(db, B, 100)).toBeCloseTo(0.90, 5)
  } finally { db.close() }
})

it('derives the project daily cap from a bounded configured share', () => {
  expect(flyRepositoryDailyCap(3)).toBeCloseTo(1.8, 5)
  vi.stubEnv('MC_FLY_REPO_DAILY_SHARE', '0.5')
  expect(flyRepositoryDailyCap(3)).toBeCloseTo(1.5, 5)
  for (const value of ['0', '-1', '2', 'NaN']) {
    vi.stubEnv('MC_FLY_REPO_DAILY_SHARE', value)
    expect(flyRepositoryDailyCap(3)).toBeCloseTo(1.8, 5)
  }
})

it('bounds and de-duplicates the ordered launch regions', () => {
  expect(flyLaunchRegions({ FLY_REGION: 'iad' })).toEqual(['iad'])
  expect(flyLaunchRegions({ MC_FLY_REGIONS: 'iad, ord ,iad, den, sjc' })).toEqual(['iad', 'ord', 'den'])
  expect(flyLaunchRegions({})).toEqual(['iad'])
})

it('keeps memory headroom for a dependency install even without a test check', async () => {
  const { recommendFlyWorkerSize } = await import('../fly-workers')
  const { pricedFlyJob } = await import('../fly-pricing')
  expect(recommendFlyWorkerSize({}, []).size).toBe('core-small')
  expect(recommendFlyWorkerSize({ requiresDependencies: true }, []).size).toBe('core-standard')
  expect(pricedFlyJob({ setup: 'none', checks: ['smoke'], timeout_seconds: 60 }).spec.size).toBe('core-small')
  expect(pricedFlyJob({ setup: 'pnpm-ci', checks: ['smoke'], timeout_seconds: 60 }).spec.size).toBe('core-standard')
  expect(pricedFlyJob({ setup: 'pnpm-ci', checks: ['build'], timeout_seconds: 900 }).spec.size).toBe('core-xlarge')
})
