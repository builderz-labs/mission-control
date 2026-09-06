// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'
import { submitFlyLeaf, type SubmissionRow } from '../fly-admission'
import { flySubmissionSchema } from '../fly-admission-schema'
import { reserveFlyJob, type ReservedJob } from '../fly-reservations'
import { reconcileFlyWorkers } from '../fly-reconciler'
import { FlyMachinesClient } from '../fly-machines-client'

vi.mock('../event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
let db: Database.Database
const repo = 'https://github.com/example/repo.git'
const other = 'https://github.com/example/other.git'
const input = (repository = repo) => flySubmissionSchema.parse({ title: 'Check revision', description: 'Run smoke', repository, base_sha: 'a'.repeat(40), timeout_seconds: 60 })
const row = () => db.prepare("SELECT * FROM fly_submissions WHERE state='queued' ORDER BY created_at LIMIT 1").get() as SubmissionRow

beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db)
  for (const [key, value] of Object.entries({ MC_FLY_ENABLED: 'true', FLY_API_TOKEN: 'test-only', MC_FLY_WORKER_APP: 'workers-new', MC_FLY_POLL_PROTOCOL: '1',
    MC_FLY_ALLOWED_REPOS: `${repo},${other}`, MC_FLY_CORE_IMAGE: 'registry.fly.io/workers-new@sha256:' + 'a'.repeat(64), MC_FLY_CORE_SMALL_HOURLY_USD: '0.10',
    MC_FLY_PER_JOB_BUDGET_USD: '1', MC_FLY_DAILY_BUDGET_USD: '10', MC_FLY_MONTHLY_BUDGET_USD: '100', MC_FLY_MAX_WORKERS: '4', MC_FLY_REGIONS: 'iad' })) vi.stubEnv(key, value)
})
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

function client(fetchImpl: typeof fetch) {
  return new FlyMachinesClient({ apiToken: 'test-only', appName: 'workers-new', fetchImpl, sleep: async () => undefined, retries: 0 })
}

it('records the worker app that owns each reservation', () => {
  submitFlyLeaf(db, input(), 1, 'tester')
  const reservation = reserveFlyJob(db, row(), input())!
  expect(reservation.app).toBe('workers-new')
  expect((db.prepare('SELECT worker_app AS app FROM fly_worker_jobs').get() as { app: string }).app).toBe('workers-new')
})

it('keeps observing a retiring worker app while new work targets the current one', async () => {
  submitFlyLeaf(db, input(), 1, 'tester')
  const reserved = reserveFlyJob(db, row(), input())!
  db.prepare("UPDATE fly_worker_jobs SET worker_app='workers-old',state='running',machine_id='m-old' WHERE id=?").run(reserved.id)
  const seen: string[] = []
  const fetchImpl = vi.fn(async (url: string | URL) => {
    seen.push(String(url))
    return new Response(JSON.stringify([{ id: 'm-old', name: reserved.name, state: 'created' }]), { status: 200 })
  }) as unknown as typeof fetch
  const result = await reconcileFlyWorkers(db, client(fetchImpl), false)
  expect(result.ok).toBe(true)
  expect(seen.some(url => url.includes('/apps/workers-old/machines'))).toBe(true)
  expect(seen.every(url => !url.includes('/apps/workers-new/machines'))).toBe(true)
})

it('retries a refused launch in the next region without duplicating a Machine', async () => {
  vi.stubEnv('MC_FLY_REGIONS', 'iad,ord')
  submitFlyLeaf(db, input(), 1, 'tester')
  const regions: string[] = []
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response('[]', { status: 200 })
    const body = JSON.parse(String(init.body)) as { region: string; name: string }
    regions.push(body.region)
    if (body.region === 'iad') return new Response('no capacity', { status: 503 })
    return new Response(JSON.stringify({ id: 'm-ord', name: body.name, state: 'created' }), { status: 200 })
  }) as unknown as typeof fetch
  await reconcileFlyWorkers(db, client(fetchImpl), true)
  expect(regions).toEqual(['iad', 'ord'])
  const jobs = db.prepare('SELECT machine_id AS id, state FROM fly_worker_jobs').all() as Array<{ id: string; state: string }>
  expect(jobs).toEqual([{ id: 'm-ord', state: 'running' }])
})

it('holds a project to its daily share only while another project is queued', () => {
  // reserve=0.01/job; daily=0.03 keeps the global gate open while the 60% project cap is 0.018.
  vi.stubEnv('MC_FLY_DAILY_BUDGET_USD', '0.03')
  const settle = (cost: number) => db.prepare("UPDATE fly_worker_jobs SET state='succeeded',observed_cost_usd=? WHERE state='creating'").run(cost)
  submitFlyLeaf(db, input(), 1, 'tester')
  expect(reserveFlyJob(db, row(), input())).not.toBeNull()
  settle(0.012)

  // Over its share, but no other project is waiting, so the slot is still granted.
  submitFlyLeaf(db, { ...input(), request_id: 'same-project-2' }, 1, 'tester')
  expect(reserveFlyJob(db, row(), input())).not.toBeNull()
  settle(0.001)

  // The same over-share request now yields once a second project queues behind it.
  submitFlyLeaf(db, { ...input(), request_id: 'same-project-3' }, 1, 'tester')
  submitFlyLeaf(db, { ...input(other), request_id: 'other-project-1' }, 1, 'tester')
  const contended = db.prepare("SELECT * FROM fly_submissions WHERE state='queued' AND payload LIKE ? ORDER BY created_at LIMIT 1")
    .get(`%${repo}%`) as SubmissionRow
  expect(reserveFlyJob(db, contended, input())).toBeNull()
  expect((db.prepare('SELECT reason FROM fly_submissions WHERE id=?').get(contended.id) as { reason: string }).reason)
    .toContain('Project daily compute share')
  // The waiting project is unaffected by the other project's share.
  const waiting = db.prepare("SELECT * FROM fly_submissions WHERE state='queued' AND payload LIKE ? LIMIT 1").get(`%${other}%`) as SubmissionRow
  expect(reserveFlyJob(db, waiting, input(other))).not.toBeNull()
})

it('accepts an immutable image from an explicitly owned registry app only', async () => {
  const { flyImageApps, isFlyWorkerImageRef } = await import('../fly-orchestrator')
  const digest = 'a'.repeat(64)
  vi.stubEnv('MC_FLY_IMAGE_APPS', 'workers-old, workers-old ,')
  expect(flyImageApps()).toEqual(['workers-new', 'workers-old'])
  expect(isFlyWorkerImageRef(`registry.fly.io/workers-old@sha256:${digest}`)).toBe(true)
  expect(isFlyWorkerImageRef(`registry.fly.io/workers-new@sha256:${digest}`)).toBe(true)
  expect(isFlyWorkerImageRef(`registry.fly.io/someone-else@sha256:${digest}`)).toBe(false)
  expect(isFlyWorkerImageRef('registry.fly.io/workers-old:latest')).toBe(false)
  expect(isFlyWorkerImageRef(`registry.fly.io/workers-old@sha256:${digest}`, 'workers-new')).toBe(false)
})
