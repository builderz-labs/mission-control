// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flyRepairMigration } from '../fly-repair-migration'
import { startFlyReconcileLoop } from '../fly-scheduler'
import { getDiskHealth } from '../disk-health'
import { runCommand } from '../command'
import { flySubmissionSchema } from '../fly-admission-schema'

vi.mock('../command', () => ({ runCommand: vi.fn() }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('forward migration and host-local repairs', () => {
  it('upgrades existing 061 rows without rewriting that migration', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`CREATE TABLE fly_submissions (id TEXT PRIMARY KEY,created_at INTEGER);
        CREATE TABLE fly_worker_jobs (cpu_percent REAL,memory_bytes INTEGER);
        INSERT INTO fly_submissions VALUES ('old',100);
        INSERT INTO fly_worker_jobs VALUES (70,2048);`)
      flyRepairMigration.up(db)
      expect(db.prepare('SELECT queue_expires_at FROM fly_submissions').get()).toEqual({ queue_expires_at: 86500 })
      expect(db.prepare('SELECT peak_cpu_percent,peak_memory_bytes FROM fly_worker_jobs').get()).toEqual({ peak_cpu_percent: 70, peak_memory_bytes: 2048 })
      db.prepare('INSERT INTO fly_submissions (id,created_at) VALUES (?,?)').run('new',200)
      expect(db.prepare("SELECT queue_expires_at FROM fly_submissions WHERE id='new'").get()).toEqual({ queue_expires_at: 86600 })
    } finally { db.close() }
  })
  it('serializes Fly observations independently of slow generic scans', async () => {
    vi.useFakeTimers()
    const task = { running: false, nextRun: 0, intervalMs: 15000, lastRun: null }
    let finish: (value: { ok: boolean; message: string }) => void = () => {}
    const run = vi.fn(() => new Promise<{ok:boolean;message:string}>(resolve => { finish = resolve }))
    const timer = startFlyReconcileLoop(task,run)
    await vi.advanceTimersByTimeAsync(45000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(task.running).toBe(true)
    finish({ ok: true, message: 'collected' })
    await vi.advanceTimersByTimeAsync(15000)
    expect(run).toHaveBeenCalledTimes(2)
    clearInterval(timer)
  })
  it('records failed reconciliation without losing the next tick', async () => {
    vi.useFakeTimers()
    const task = { running: false, nextRun: 0, intervalMs: 15000, lastRun: null }
    const timer = startFlyReconcileLoop(task,async () => { throw Error('offline') })
    await vi.advanceTimersByTimeAsync(15000)
    expect(task).toMatchObject({ running: false, lastResult: { ok: false } })
    clearInterval(timer)
  })
  it('probes the writable data volume and rejects malformed output', async () => {
    vi.mocked(runCommand).mockResolvedValue({ stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3 100000 95000 5000 95% /System/Volumes/Data', stderr: '', code: 0 })
    expect(await getDiskHealth('/data')).toEqual({ usedPercent: 95, availableBytes: 5120000 })
    expect(runCommand).toHaveBeenCalledWith('df',['-Pk','/data'],{timeoutMs:3000})
    vi.mocked(runCommand).mockResolvedValue({ stdout: 'bad output', stderr: '', code: 0 })
    await expect(getDiskHealth('/data')).rejects.toThrow('unavailable')
  })
  it('rejects credential-like metadata and null characters at admission', () => {
    const input = { title: 'check', description: 'test', repository: 'https://github.com/example/repo.git', base_sha: 'a'.repeat(40) }
    for (const description of ['bad\u0000text','token=synthetic-secret-long-value','-----BEGIN PRIVATE KEY-----']) {
      expect(flySubmissionSchema.safeParse({ ...input, description }).success).toBe(false)
    }
  })
})
