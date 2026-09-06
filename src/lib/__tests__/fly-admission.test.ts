// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '../migrations'
import { submitFlyLeaf, type SubmissionRow } from '../fly-admission'
import { flySubmissionSchema } from '../fly-admission-schema'
import { reserveFlyJob, type ReservedJob } from '../fly-reservations'
import { recordPolledResult, settleFlyJob } from '../fly-polled-result'
import { reconcileFlyWorkers } from '../fly-reconciler'
import { FlyMachinesClient } from '../fly-machines-client'
import { expireFlyQueue, releaseQueuedFlySubmission } from '../fly-queue-control'
import { flyCommittedSpend } from '../fly-budget'
import { buildFlyActivity } from '../fly-activity'

vi.mock('../event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
let db: Database.Database
const repo = 'https://github.com/example/repo.git'
const input = () => flySubmissionSchema.parse({ title: 'Check revision', description: 'Run smoke', repository: repo, base_sha: 'a'.repeat(40), timeout_seconds: 60 })
const row = () => db.prepare('SELECT * FROM fly_submissions ORDER BY created_at LIMIT 1').get() as SubmissionRow
const job = () => db.prepare('SELECT * FROM fly_worker_jobs ORDER BY rowid DESC LIMIT 1').get() as ReservedJob
beforeEach(() => {
  db = new Database(':memory:'); runMigrations(db)
  for (const [key,value] of Object.entries({ MC_FLY_ENABLED: 'true', FLY_API_TOKEN: 'test-only', MC_FLY_WORKER_APP: 'test-workers', MC_FLY_POLL_PROTOCOL: '1',
    MC_FLY_ALLOWED_REPOS: repo, MC_FLY_CORE_IMAGE: 'registry.fly.io/test-workers@sha256:'+ 'a'.repeat(64), MC_FLY_CORE_SMALL_HOURLY_USD: '0.10',
    MC_FLY_PER_JOB_BUDGET_USD: '1', MC_FLY_DAILY_BUDGET_USD: '10', MC_FLY_MONTHLY_BUDGET_USD: '100', MC_FLY_MAX_WORKERS: '2' })) vi.stubEnv(key,value)
})
afterEach(() => { db.close(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('durable Fly admission and ownership', () => {
  it('keeps unavailable resource measurements null', () => {
    submitFlyLeaf(db,input(),1,'tester'); reserveFlyJob(db,row(),input()); const current = job()
    recordPolledResult(db,current,JSON.stringify({job_id:current.id,branch_name:current.branch_name,state:'running',updated_at:Math.floor(Date.now()/1000)}))
    expect(db.prepare('SELECT cpu_percent,memory_bytes,swap_bytes FROM fly_worker_jobs').get()).toEqual({cpu_percent:null,memory_bytes:null,swap_bytes:null})
  })
  it('idempotently admits a leaf without requiring a local agent row', () => {
    const first = submitFlyLeaf(db,input(),1,'tester')
    expect(first).toMatchObject({ accepted: true, state: 'queued', safe_local_fallback: false })
    expect(submitFlyLeaf(db,input(),1,'tester')).toEqual(first)
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 })
  })
  it('declines unavailable or unsupported runtime work without claiming it', () => {
    vi.stubEnv('MC_FLY_ENABLED','false')
    expect(submitFlyLeaf(db,input(),1,'tester')).toMatchObject({ route: 'local',safe_local_fallback: true })
    vi.stubEnv('MC_FLY_ENABLED','true')
    expect(submitFlyLeaf(db,{...input(),runtime:'claude'},1,'tester')).toMatchObject({ route:'local' })
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 })
  })
  it('rejects conflicting request IDs and credential-bearing repositories', () => {
    submitFlyLeaf(db,{...input(),request_id:'fixed-key-123'},1,'tester')
    expect(submitFlyLeaf(db,{...input(),request_id:'fixed-key-123',title:'different'},1,'tester')).toMatchObject({route:'rejected',safe_local_fallback:false})
    expect(flySubmissionSchema.safeParse({...input(),repository:'https://secret@github.com/example/repo.git'}).success).toBe(false)
  })
  it('reserves the entire deadline, persists the rate, and isolates branch/payload', () => {
    submitFlyLeaf(db,input(),1,'tester'); const reservation = reserveFlyJob(db,row(),input())!
    expect(job().hourly_rate_usd).toBe(0.1)
    expect(db.prepare('SELECT estimated_cost_usd AS cost FROM fly_worker_jobs').get()).toEqual({ cost:0.01 })
    const payload=JSON.parse(Buffer.from(reservation.config.files[0].raw_value,'base64').toString())
    expect(payload).toMatchObject({runtime:'command',base_sha:'a'.repeat(40)})
    expect(payload.branch_name).toMatch(/^mc\/fly-task-\d+-[a-f0-9]{8}$/)
    expect(reservation.config.env).not.toHaveProperty('FLY_API_TOKEN')
    expect(reserveFlyJob(db,row(),input())).toBeNull()
  })
  it('enforces 25 reservations and keeps the 26th queued until a slot is released', () => {
    vi.stubEnv('MC_FLY_MAX_WORKERS', '25')
    const submissions: SubmissionRow[] = []
    for (let index = 0; index < 26; index++) {
      const request = { ...input(), request_id: `capacity-check-${index}` }
      submitFlyLeaf(db, request, 1, 'tester')
      const current = db.prepare('SELECT * FROM fly_submissions ORDER BY rowid DESC LIMIT 1').get() as SubmissionRow
      submissions.push(current)
      expect(Boolean(reserveFlyJob(db, current, request))).toBe(index < 25)
    }
    expect(db.prepare("SELECT COUNT(*) AS n FROM fly_worker_jobs WHERE state='creating'").get()).toEqual({ n: 25 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM fly_submissions WHERE state='queued'").get()).toEqual({ n: 1 })
    db.prepare("UPDATE fly_worker_jobs SET state='succeeded',cleanup_completed_at=unixepoch() WHERE rowid=(SELECT MIN(rowid) FROM fly_worker_jobs)").run()
    expect(reserveFlyJob(db, submissions[25], { ...input(), request_id: 'capacity-check-25' })).not.toBeNull()
  })
  it('keeps capacity reserved until cleanup is confirmed and prevents terminal resurrection', () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input())
    const current=job()
    recordPolledResult(db,current,JSON.stringify({job_id:current.id,branch_name:current.branch_name,state:'succeeded',result_sha:'a'.repeat(40),error_message:null,updated_at:Math.floor(Date.now()/1000),resolution:'Checks passed'}))
    expect(job().state).toBe('cleaning')
    settleFlyJob(db,current)
    expect(job().state).toBe('succeeded')
    recordPolledResult(db,current,JSON.stringify({job_id:current.id,branch_name:current.branch_name,state:'running',result_sha:null,resolution:null,error_message:null,updated_at:Math.floor(Date.now()/1000)}))
    expect(job().state).toBe('succeeded')
    expect(db.prepare('SELECT status FROM tasks').get()).toEqual({status:'review'})
  })
  it('holds unknown create outcomes through the deadline without local fallback', async () => {
    submitFlyLeaf(db,input(),1,'tester')
    const client=new FlyMachinesClient({apiToken:'test',appName:'test-workers'})
    vi.spyOn(client,'listMachines').mockResolvedValue([])
    const create=vi.spyOn(client,'createMachine').mockRejectedValue(new Error('response lost'))
    await reconcileFlyWorkers(db,client)
    expect(job().state).toBe('creating');expect(row().state).toBe('running')
    await reconcileFlyWorkers(db,client)
    expect(create).toHaveBeenCalledTimes(1)
    expect(job().state).toBe('creating')
  })
  it('retains cleanup and budget ownership when Fly is unavailable', async () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input())
    db.prepare("UPDATE fly_worker_jobs SET state='cleaning',machine_id='machine-1'").run()
    const client=new FlyMachinesClient({apiToken:'test',appName:'test-workers'})
    vi.spyOn(client,'listMachines').mockRejectedValue(new Error('network down'))
    expect((await reconcileFlyWorkers(db,client)).ok).toBe(false)
    expect(job().state).toBe('cleaning')
  })
  it('limits infrastructure retries to two attempts', () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input());settleFlyJob(db,job())
    expect(row().state).toBe('queued')
    db.prepare('UPDATE fly_submissions SET next_attempt_at=0').run()
    reserveFlyJob(db,row(),input());settleFlyJob(db,job())
    expect(row()).toMatchObject({state:'failed',attempts:2})
  })
  it('queues 500 leaves with a global cap and refuses to overspend', () => {
    for(let i=0;i<500;i++) submitFlyLeaf(db,{...input(),request_id:`load-task-${i}`},1,'tester')
    const rows=db.prepare('SELECT * FROM fly_submissions').all() as SubmissionRow[]
    for(const r of rows)reserveFlyJob(db,r,input())
    expect(db.prepare('SELECT COUNT(*) AS n FROM fly_worker_jobs').get()).toEqual({n:2})
    expect(db.prepare("SELECT COUNT(*) AS n FROM fly_submissions WHERE state='queued'").get()).toEqual({n:498})
    vi.stubEnv('MC_FLY_MAX_WORKERS','30');vi.stubEnv('MC_FLY_DAILY_BUDGET_USD','0.02')
    expect(reserveFlyJob(db,rows[2],input())).toBeNull()
  })
  it('rejects permanently unconfigured pricing and images before taking ownership', () => {
    vi.stubEnv('MC_FLY_CORE_SMALL_HOURLY_USD','0')
    expect(submitFlyLeaf(db,input(),1,'tester')).toMatchObject({route:'local',safe_local_fallback:true})
    vi.stubEnv('MC_FLY_CORE_SMALL_HOURLY_USD','0.1');vi.stubEnv('MC_FLY_CORE_IMAGE','registry.fly.io/test-workers:latest')
    expect(submitFlyLeaf(db,input(),1,'tester')).toMatchObject({route:'local'})
    expect(flySubmissionSchema.safeParse({...input(),description:''}).success).toBe(false)
  })
  it('passes the selected browser class into the Machine', () => {
    vi.stubEnv('MC_FLY_BROWSER_IMAGE','registry.fly.io/test-workers@sha256:'+'b'.repeat(64))
    vi.stubEnv('MC_FLY_BROWSER_STANDARD_HOURLY_USD','0.2')
    const leaf = {...input(),setup:'pnpm-ci-playwright' as const}
    expect(submitFlyLeaf(db,leaf,1,'tester').accepted).toBe(true)
    expect(reserveFlyJob(db,row(),leaf)?.config.env.MC_FLY_WORKER_CLASS).toBe('browser')
  })
  it('expires queued work but cannot release unknown launch ownership', () => {
    submitFlyLeaf(db,input(),1,'tester')
    expect(releaseQueuedFlySubmission(db,2,row().id,'cancelled').released).toBe(false)
    db.prepare('UPDATE fly_submissions SET queue_expires_at=1').run();expireFlyQueue(db)
    expect(row().state).toBe('expired')
    expect(submitFlyLeaf(db,input(),1,'tester')).toMatchObject({route:'local',safe_local_fallback:true})
    submitFlyLeaf(db,{...input(),request_id:'different-leaf'},1,'tester')
    const next=db.prepare("SELECT * FROM fly_submissions WHERE state='queued'").get() as SubmissionRow
    reserveFlyJob(db,next,input())
    expect(releaseQueuedFlySubmission(db,1,next.id,'cancelled')).toEqual({released:false,safe_local_fallback:false})
  })
  it('keeps completed crossing-boundary costs in the conservative period ledger', () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input())
    db.prepare("UPDATE fly_worker_jobs SET state='succeeded',created_at=100,completed_at=300,observed_cost_usd=0.02").run()
    expect(flyCommittedSpend(db,200)).toBe(0.02)
    expect(flyCommittedSpend(db,400)).toBe(0)
  })
  it('makes cancellation idempotent and session telemetry workspace-scoped', () => {
    submitFlyLeaf(db,{...input(),session_id:'session-A',request_id:'session-task-a'},1,'tester')
    const first=row()
    reserveFlyJob(db,first,input())
    db.prepare("UPDATE fly_worker_jobs SET observed_cost_usd=0.012").run()
    submitFlyLeaf(db,{...input(),session_id:'session-B',request_id:'session-task-b'},1,'tester')
    const second=db.prepare("SELECT * FROM fly_submissions WHERE session_id='session-B'").get() as SubmissionRow
    expect(buildFlyActivity(db,1,'session-A')).toMatchObject({submissions:1,active_workers:1,estimated_compute_usd:0.012})
    expect(buildFlyActivity(db,2,'session-A')).toMatchObject({submissions:0,active_workers:0,jobs:[]})
    expect(releaseQueuedFlySubmission(db,1,second.id,'cancelled').released).toBe(true)
    expect(releaseQueuedFlySubmission(db,1,second.id,'cancelled').released).toBe(true)
    expect(buildFlyActivity(db,1,'session-B').states).toEqual({cancelled:1})
  })
  it('uses historical peaks before admission and does not accept unpriced upsizing', () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input())
    db.prepare("UPDATE fly_worker_jobs SET state='succeeded',peak_cpu_percent=90,peak_memory_bytes=3000000000").run()
    db.prepare("UPDATE fly_submissions SET state='succeeded'").run()
    expect(submitFlyLeaf(db,{...input(),request_id:'history-next'},1,'tester')).toMatchObject({accepted:false,route:'local'})
    vi.stubEnv('MC_FLY_CORE_PERFORMANCE_HOURLY_USD','0.2')
    expect(submitFlyLeaf(db,{...input(),request_id:'history-next'},1,'tester').accepted).toBe(true)
    runMigrations(db) // Forward migrations remain idempotent on the integrated schema.
  })
  it('drains active workers even when admission is explicitly paused', async () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input())
    db.prepare("UPDATE fly_worker_jobs SET state='running',machine_id='m1'").run()
    const client=new FlyMachinesClient({apiToken:'test',appName:'test-workers'})
    vi.spyOn(client,'listMachines').mockResolvedValue([])
    const create=vi.spyOn(client,'createMachine')
    await reconcileFlyWorkers(db,client,false)
    expect(job().state).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })
  it('includes earlier attempts in the per-job budget', () => {
    submitFlyLeaf(db,input(),1,'tester');reserveFlyJob(db,row(),input());settleFlyJob(db,job())
    db.prepare('UPDATE fly_worker_jobs SET observed_cost_usd=0.009').run()
    db.prepare('UPDATE fly_submissions SET next_attempt_at=0').run()
    vi.stubEnv('MC_FLY_PER_JOB_BUDGET_USD','0.015')
    expect(reserveFlyJob(db,row(),input())).toBeNull()
    expect(row().reason).toContain('Cumulative per-job')
  })
})
