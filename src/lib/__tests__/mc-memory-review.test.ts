import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SCRIPT_PATH  = path.resolve(__dirname, '../../../scripts/mc-memory-review.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

function run(env: Record<string, string> = {}): { stdout: string; status: number | null } {
  const r = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    timeout: 15000,
  })
  return { stdout: r.stdout || '', status: r.status }
}

function readLog(dir: string) {
  try {
    return fs.readFileSync(path.join(dir, 'memory-review.jsonl'), 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l))
  } catch { return [] }
}

describe('mc-memory-review', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-review-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('exits 0', () => {
    expect(run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-01' }).status).toBe(0)
  })

  it('emits valid JSON', () => {
    const { stdout } = run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-02' })
    expect(() => JSON.parse(stdout)).not.toThrow()
  })

  it('creates memory-review.jsonl on first run', () => {
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-03' })
    expect(fs.existsSync(path.join(tmpDir, 'memory-review.jsonl'))).toBe(true)
  })

  it('log entry has required fields', () => {
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-04' })
    const log = readLog(tmpDir)
    expect(log).toHaveLength(1)
    const entry = log[0]
    expect(entry).toHaveProperty('date', '2099-01-04')
    expect(entry).toHaveProperty('timestamp')
    expect(typeof entry.pending_review).toBe('number')
    expect(typeof entry.high_risk_count).toBe('number')
  })

  it('is idempotent — second run on same date is skipped', () => {
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-05' })
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-05' })
    expect(readLog(tmpDir)).toHaveLength(1)
  })

  it('second run on same date returns status skipped', () => {
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-06' })
    const { stdout } = run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-06' })
    expect(JSON.parse(stdout).status).toBe('skipped')
  })

  it('different dates produce separate log entries', () => {
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-07' })
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-08' })
    expect(readLog(tmpDir)).toHaveLength(2)
  })

  it('log entry has entries_sample array', () => {
    run({ MC_LOG_DIR: tmpDir, MC_REVIEW_DATE: '2099-01-09' })
    const entry = readLog(tmpDir)[0]
    expect(Array.isArray(entry.entries_sample)).toBe(true)
  })
})
