import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SCRIPT_PATH  = path.resolve(__dirname, '../../../scripts/mc-execute.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

function run(logDir: string, mcRoot: string): { stdout: string; status: number | null } {
  const r = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, MC_LOG_DIR: logDir, MC_ROOT: mcRoot },
    timeout: 15000,
  })
  return { stdout: r.stdout || '', status: r.status }
}

function writeApprovals(dir: string, entries: object[]) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'approvals.jsonl'),
    entries.map(e => JSON.stringify(e)).join('\n') + '\n',
    'utf-8'
  )
}

function readExecuted(dir: string) {
  try {
    return fs.readFileSync(path.join(dir, 'executed.jsonl'), 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l))
  } catch { return [] }
}

describe('mc-execute', () => {
  let tmpDir: string
  let tmpRoot: string

  beforeEach(() => {
    tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-exec-test-'))
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-exec-root-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir,  { recursive: true, force: true })
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  // ── Output validity ──────────────────────────────────────────────────────

  it('emits valid JSON', () => {
    writeApprovals(tmpDir, [])
    expect(() => JSON.parse(run(tmpDir, tmpRoot).stdout)).not.toThrow()
  })

  it('exits 0 with no approvals', () => {
    writeApprovals(tmpDir, [])
    expect(run(tmpDir, tmpRoot).status).toBe(0)
  })

  it('exits 0 when approvals file is missing', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    expect(run(tmpDir, tmpRoot).status).toBe(0)
  })

  // ── Read-and-dispatch ────────────────────────────────────────────────────

  it('dispatches approved lockfile-hygiene by deleting package-lock.json', () => {
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'approved', timestamp: new Date().toISOString() },
    ])
    run(tmpDir, tmpRoot)
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  it('writes execution result to executed.jsonl', () => {
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'approved', timestamp: new Date().toISOString() },
    ])
    run(tmpDir, tmpRoot)
    const executed = readExecuted(tmpDir)
    expect(executed).toHaveLength(1)
    expect(executed[0].decision_id).toBe('lockfile-hygiene')
    expect(executed[0].result).toBe('success')
    expect(executed[0].executed_at).toBeTruthy()
  })

  it('dispatches count is reported in stdout', () => {
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'approved', timestamp: new Date().toISOString() },
    ])
    const out = JSON.parse(run(tmpDir, tmpRoot).stdout)
    expect(out.dispatched).toBe(1)
    expect(out.results[0].result).toBe('success')
  })

  // ── Idempotency ──────────────────────────────────────────────────────────

  it('second run skips already-executed decisions', () => {
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'approved', timestamp: new Date().toISOString() },
    ])
    run(tmpDir, tmpRoot)  // first run — deletes file
    fs.writeFileSync(lockPath, '{}', 'utf-8')  // recreate the file
    const out2 = JSON.parse(run(tmpDir, tmpRoot).stdout)
    expect(out2.dispatched).toBe(0)
    expect(out2.already_executed).toBe(1)
    // file should NOT be deleted again (decision was already executed)
    expect(fs.existsSync(lockPath)).toBe(true)
  })

  it('executed.jsonl has exactly one entry after two runs', () => {
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'approved', timestamp: new Date().toISOString() },
    ])
    run(tmpDir, tmpRoot)
    run(tmpDir, tmpRoot)
    expect(readExecuted(tmpDir)).toHaveLength(1)
  })

  // ── Reject skipping ──────────────────────────────────────────────────────

  it('rejected decisions are not dispatched', () => {
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'rejected', timestamp: new Date().toISOString() },
    ])
    const out = JSON.parse(run(tmpDir, tmpRoot).stdout)
    expect(out.dispatched).toBe(0)
    expect(out.total_rejected).toBe(1)
    expect(fs.existsSync(lockPath)).toBe(true)
    expect(readExecuted(tmpDir)).toHaveLength(0)
  })

  // ── Unknown IDs ──────────────────────────────────────────────────────────

  it('unknown decision id is acknowledged without crashing', () => {
    writeApprovals(tmpDir, [
      { decision_id: 'some-future-rule', status: 'approved', timestamp: new Date().toISOString() },
    ])
    const { status, stdout } = run(tmpDir, tmpRoot)
    expect(status).toBe(0)
    const out = JSON.parse(stdout)
    expect(out.dispatched).toBe(1)
    expect(out.results[0].result).toBe('acknowledged')
  })

  // ── Dispatch gate enforcement ────────────────────────────────────────────

  it('gate prevents filesystem mutation for decision_ids not in the dispatch gate', () => {
    // Even if an approval exists, decision_ids outside DISPATCH_GATE are routed
    // to defaultDispatch (acknowledge-only) — no filesystem mutation can occur.
    const lockPath = path.join(tmpRoot, 'package-lock.json')
    fs.writeFileSync(lockPath, '{}', 'utf-8')
    writeApprovals(tmpDir, [
      { decision_id: 'hypothetical-mutation-op', status: 'approved', timestamp: new Date().toISOString() },
    ])
    const out = JSON.parse(run(tmpDir, tmpRoot).stdout)
    expect(out.dispatched).toBe(1)
    expect(out.results[0].result).toBe('acknowledged')
    // File must be untouched — defaultDispatch cannot mutate filesystem
    expect(fs.existsSync(lockPath)).toBe(true)
  })

  // ── Lock file absent ─────────────────────────────────────────────────────

  it('lockfile-hygiene returns skipped when package-lock.json is already absent', () => {
    writeApprovals(tmpDir, [
      { decision_id: 'lockfile-hygiene', status: 'approved', timestamp: new Date().toISOString() },
    ])
    // no package-lock.json in tmpRoot
    const out = JSON.parse(run(tmpDir, tmpRoot).stdout)
    expect(out.results[0].result).toBe('skipped')
  })
})
