import { FLY_LAUNCH_BATCH_SIZE } from './fly-capacity'
import type Database from 'better-sqlite3'
import { FlyMachinesClient, type FlyMachineResponse } from './fly-machines-client'
import { flyReadiness, flySubmissionSchema } from './fly-admission-schema'
import { reserveFlyJob, type ReservedJob } from './fly-reservations'
import { recordPolledResult, settleFlyJob } from './fly-polled-result'
import type { SubmissionRow } from './fly-admission'
import { logger } from './logger'
import { expireFlyQueue } from './fly-queue-control'
import { acquireFlySchedulerLease } from './fly-scheduler-lease'

async function pollJob(db: Database.Database, client: FlyMachinesClient, job: ReservedJob, machines: FlyMachineResponse[]) {
  const machine = machines.find(m => m.id === job.machine_id || m.name === job.launch_name)
  const now = Math.floor(Date.now() / 1000)
  if (!machine) {
    // Unknown launch responses remain owned through their deadline.
    if (job.state !== 'creating' || job.expires_at <= now) settleFlyJob(db, job)
    return
  }
  db.prepare('UPDATE fly_worker_jobs SET machine_id=?,started_at=COALESCE(started_at,?) WHERE id=?').run(machine.id,now,job.id)
  if (job.expires_at <= now || job.state === 'cleaning' || ['stopped','destroyed'].includes(machine.state || '')) {
    await client.destroyMachine(machine.id)
    settleFlyJob(db, job, 'Worker exceeded deadline or stopped before result collection')
    return
  }
  if (machine.state !== 'started') return
  const response = await client.readWorkerState(machine.id)
  if (response.exit_code !== 0) return
  const result = recordPolledResult(db, job, response.stdout)
  if (result.state !== 'running') {
    await client.destroyMachine(machine.id)
    settleFlyJob(db, job)
  }
}

export async function reconcileFlyWorkers(db: Database.Database, client = FlyMachinesClient.fromEnv(), admit = true): Promise<{ ok: boolean; message: string }> {
  const lease = acquireFlySchedulerLease(db)
  if (!lease) return { ok: true, message: 'Fly reconciliation already active' }
  try {
    expireFlyQueue(db)
    const active = db.prepare("SELECT * FROM fly_worker_jobs WHERE state IN ('creating','running','cleaning') ORDER BY COALESCE(heartbeat_at,0),created_at,id").all() as ReservedJob[]
    const pending = db.prepare("SELECT 1 FROM fly_submissions WHERE state='queued' AND next_attempt_at<=unixepoch() LIMIT 1").get()
    if (!active.length && (!admit || !pending)) return { ok: true, message: 'Fly idle; no provider poll or idle worker required' }
    if (!client.isEnabled()) return { ok: !active.length, message: 'Fly credential unavailable; remote ownership retained' }
    const machines = await client.listMachines()
    for (let index = 0; index < active.length; index += 4) {
      lease.assertOwned()
      await Promise.all(active.slice(index,index+4).map(async job => {
        try { await pollJob(db,client,job,machines) }
        catch (error) { logger.warn({ jobId: job.id, error: error instanceof Error ? error.name : 'unknown' }, 'Fly observation/cleanup will retry') }
      }))
    }
    if (!admit || flyReadiness().length) return { ok: true, message: 'Existing workers reconciled; admission disabled' }
    const queued = db.prepare(`SELECT s.* FROM fly_submissions s JOIN tasks t ON t.id=s.task_id
      WHERE s.state='queued' AND s.next_attempt_at<=unixepoch()
      ORDER BY (CASE t.priority WHEN 'critical' THEN 3 WHEN 'high' THEN 2 WHEN 'medium' THEN 1 ELSE 0 END
        + (unixepoch()-s.created_at)/300) DESC,s.created_at,s.id LIMIT 30`).all() as SubmissionRow[]
    let launched = 0
    for (const row of queued) {
      lease.assertOwned()
      if (launched >= FLY_LAUNCH_BATCH_SIZE) break
      const input = flySubmissionSchema.parse(JSON.parse(row.payload))
      const reasons = flyReadiness(input)
      if (reasons.length) { db.prepare('UPDATE fly_submissions SET reason=?,next_attempt_at=unixepoch()+60 WHERE id=?').run(reasons.join('; '),row.id); continue }
      const reserved = reserveFlyJob(db,row,input)
      if (!reserved) continue
      if (launched) await new Promise(resolve => setTimeout(resolve,1100))
      launched++
      try {
        const machine = await client.createMachine({ name: reserved.name, region: process.env.FLY_REGION || 'iad', config: reserved.config })
        db.prepare("UPDATE fly_worker_jobs SET machine_id=?,state=CASE WHEN state='creating' THEN 'running' ELSE state END,started_at=COALESCE(started_at,unixepoch()) WHERE id=?")
          .run(machine.id,reserved.id)
      } catch {
        db.prepare("UPDATE fly_submissions SET reason='Launch response unknown; reservation retained pending reconciliation' WHERE id=?").run(row.id)
      }
    }
    return { ok: true, message: `Observed ${active.length} jobs; admitted ${launched} launches` }
  } catch (error) {
    logger.warn({ error: error instanceof Error ? error.name : 'unknown' }, 'Fly unavailable; remote ownership retained')
    return { ok: false, message: 'Fly unavailable; queued work and reservations retained' }
  } finally {
    lease.release()
  }
}
