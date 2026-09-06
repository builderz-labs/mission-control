// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireFlySchedulerLease } from '../fly-scheduler-lease'
import { readPolledResult, settleFlyJob } from '../fly-polled-result'
import { FlyMachinesClient } from '../fly-machines-client'
import type { ReservedJob } from '../fly-reservations'

vi.mock('../event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Fly recovery boundaries', () => {
  it('renews during slow calls, fences lost ownership, and preserves successor leases', () => {
    vi.useFakeTimers()
    const db = new Database(':memory:')
    db.exec('CREATE TABLE fly_scheduler_lock(id INTEGER,owner TEXT,expires_at INTEGER); INSERT INTO fly_scheduler_lock VALUES(1,NULL,0)')
    const lease = acquireFlySchedulerLease(db)!
    expect(acquireFlySchedulerLease(db)).toBeNull()
    db.exec('UPDATE fly_scheduler_lock SET expires_at=unixepoch()+1')
    vi.advanceTimersByTime(30_000)
    expect((db.prepare('SELECT expires_at-unixepoch() AS ttl FROM fly_scheduler_lock').get() as {ttl:number}).ttl).toBeGreaterThan(100)
    expect(() => lease.assertOwned()).not.toThrow()
    db.exec("UPDATE fly_scheduler_lock SET owner='successor'")
    vi.advanceTimersByTime(30_000)
    expect(() => lease.assertOwned()).toThrow('lease lost')
    lease.release()
    expect(db.prepare('SELECT owner FROM fly_scheduler_lock').get()).toEqual({owner:'successor'})
    expect(vi.getTimerCount()).toBe(0)
    db.close()
  })

  it('settles vanished workers after a long outage without accepting stale live heartbeats', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE fly_worker_jobs(id TEXT,submission_id TEXT,task_id INTEGER,workspace_id INTEGER,state TEXT,
      branch_name TEXT,outcome_json TEXT,started_at INTEGER,created_at INTEGER,hourly_rate_usd REAL,
      observed_cost_usd REAL,completed_at INTEGER,cleanup_completed_at INTEGER,runtime_seconds INTEGER,error_message TEXT);
      CREATE TABLE fly_submissions(id TEXT,attempts INTEGER,state TEXT,reason TEXT,next_attempt_at INTEGER,updated_at INTEGER);
      CREATE TABLE tasks(id INTEGER,workspace_id INTEGER,status TEXT,resolution TEXT,error_message TEXT,updated_at INTEGER);
      INSERT INTO fly_submissions VALUES('s',1,'running',NULL,0,0); INSERT INTO tasks VALUES(1,1,'in_progress',NULL,NULL,0)`)
    const state = JSON.stringify({job_id:'j',branch_name:'branch',state:'running',updated_at:1})
    db.prepare("INSERT INTO fly_worker_jobs(id,submission_id,task_id,workspace_id,state,branch_name,outcome_json,created_at,hourly_rate_usd,observed_cost_usd) VALUES('j','s',1,1,'running','branch',?,unixepoch()-300,0.1,0)").run(state)
    const job = db.prepare('SELECT * FROM fly_worker_jobs').get() as ReservedJob
    expect(() => readPolledResult(state,job)).toThrow('stale')
    expect(() => settleFlyJob(db,job)).not.toThrow()
    expect(db.prepare('SELECT state FROM fly_worker_jobs').get()).toEqual({state:'failed'})
    expect(db.prepare('SELECT state FROM fly_submissions').get()).toEqual({state:'queued'})
    db.close()
  })

  it.each([['2',2000],['999999',10000],['invalid',100]])('bounds provider Retry-After %s', async (header,delay) => {
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('',{status:429,headers:{'retry-after':header}}))
      .mockResolvedValueOnce(new Response('[]'))
    const client = new FlyMachinesClient({apiToken:'test',appName:'test',retries:1,fetchImpl,sleep})
    await expect(client.listMachines()).resolves.toEqual([])
    expect(sleep).toHaveBeenCalledWith(delay)
  })
})
