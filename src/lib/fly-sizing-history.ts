import type Database from 'better-sqlite3'
import type { FlySubmission } from './fly-admission-schema'
import { pricedFlyJob } from './fly-pricing'
import { FLY_WORKER_SPECS, type FlyWorkerSize } from './fly-workers'

/** A sample's CPU share is meaningless without the vCPU count it was measured against. */
function sampleCpus(imageKind: string): number {
  return FLY_WORKER_SPECS[imageKind as FlyWorkerSize]?.cpus ?? 1
}

/** Admission and reservation must use the same history and price selection. */
export function priceFromFlyHistory(db: Database.Database, input: FlySubmission) {
  const samples = db.prepare(`SELECT j.peak_cpu_percent AS cpu_percent,j.peak_memory_bytes AS memory_bytes,j.runtime_seconds,j.observed_cost_usd,j.image_kind
    FROM fly_worker_jobs j JOIN fly_submissions s ON s.id=j.submission_id
    WHERE j.state='succeeded' AND j.repository=? AND json_extract(s.payload,'$.setup')=?
      AND json_extract(s.payload,'$.runtime')=? AND json_extract(s.payload,'$.checks')=?
    ORDER BY j.completed_at DESC LIMIT 50`)
    .all(input.repository,input.setup,input.runtime,JSON.stringify(input.checks)) as Array<{
      cpu_percent: number; memory_bytes: number; runtime_seconds: number; observed_cost_usd: number; image_kind: string
    }>
  return pricedFlyJob(input,samples.map(sample => ({ cpuPercent:sample.cpu_percent,memoryMb:sample.memory_bytes/1048576,
    runtimeSeconds:sample.runtime_seconds,costUsd:sample.observed_cost_usd,cpus:sampleCpus(sample.image_kind) })))
}
