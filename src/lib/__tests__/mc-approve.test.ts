import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SCRIPT_PATH  = path.resolve(__dirname, '../../../scripts/mc-approve.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

// Re-use the same fixture helpers as mc-recommend tests
function makeReport(overrides: Record<string, unknown> = {}): object {
  return {
    coordinator: 'Mission Control Coordinator v1',
    label: 'OBSERVE ONLY',
    timestamp: new Date().toISOString(),
    status: 'WARN', risk_level: 1,
    agents: {
      repo_steward: {
        status: 'WARN', risk_level: 1,
        git: { is_clean: true },
        packages: { dual_lockfile_warn: true },
      },
      skill_intake: { status: 'ok', risk_level: 0 },
    },
    summary: { total_agents: 2, ok: 1, warn: 1, fail: 0, warnings: ['dual lockfile'], recommended_next_actions: [] },
    ...overrides,
  }
}

function writeDir(dir: string, report: object) {
  fs.mkdirSync(dir, { recursive: true })
  const entry = JSON.stringify(report)
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(report, null, 2), 'utf-8')
  fs.writeFileSync(path.join(dir, 'history.jsonl'), entry + '\n' + entry + '\n', 'utf-8')
}

function run(args: string[], logDir: string): { stdout: string; status: number | null } {
  const r = spawnSync('node', [SCRIPT_PATH, ...args], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, MC_LOG_DIR: logDir },
    timeout: 20000,
  })
  return { stdout: r.stdout || '', status: r.status }
}

function readApprovals(dir: string) {
  try {
    return fs.readFileSync(path.join(dir, 'approvals.jsonl'), 'utf-8')
      .trim().split('\n').filter(Boolean)
      .map(l => JSON.parse(l))
  } catch { return [] }
}

describe('mc-approve', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-approve-test-'))
    writeDir(tmpDir, makeReport())
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── list ─────────────────────────────────────────────────────────────────

  it('list emits valid JSON', () => {
    expect(() => JSON.parse(run(['list'], tmpDir).stdout)).not.toThrow()
  })

  it('list exits 0', () => {
    expect(run(['list'], tmpDir).status).toBe(0)
  })

  it('list shows lockfile-hygiene as pending by default', () => {
    const out = JSON.parse(run(['list'], tmpDir).stdout)
    const d = out.decisions.find((x: { id: string }) => x.id === 'lockfile-hygiene')
    expect(d).toBeDefined()
    expect(d.approval_status).toBe('pending')
  })

  it('list label is OBSERVE ONLY', () => {
    expect(JSON.parse(run(['list'], tmpDir).stdout).label).toBe('OBSERVE ONLY')
  })

  it('list has total, pending, approved, rejected counts', () => {
    const out = JSON.parse(run(['list'], tmpDir).stdout)
    for (const f of ['total', 'pending', 'approved', 'rejected']) {
      expect(typeof out[f]).toBe('number')
    }
  })

  // ── approve ───────────────────────────────────────────────────────────────

  it('approving a valid decision exits 0', () => {
    expect(run(['approve', 'lockfile-hygiene'], tmpDir).status).toBe(0)
  })

  it('approving returns status ok with decision_id and timestamp', () => {
    const out = JSON.parse(run(['approve', 'lockfile-hygiene'], tmpDir).stdout)
    expect(out.status).toBe('ok')
    expect(out.decision_id).toBe('lockfile-hygiene')
    expect(out.approval).toBe('approved')
    expect(out.timestamp).toBeTruthy()
  })

  it('approving writes entry to approvals.jsonl', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    const entries = readApprovals(tmpDir)
    expect(entries).toHaveLength(1)
    expect(entries[0].decision_id).toBe('lockfile-hygiene')
    expect(entries[0].status).toBe('approved')
  })

  it('approved decision shows approved in list', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    const out = JSON.parse(run(['list'], tmpDir).stdout)
    const d = out.decisions.find((x: { id: string }) => x.id === 'lockfile-hygiene')
    expect(d.approval_status).toBe('approved')
  })

  it('--note is stored in approvals.jsonl', () => {
    run(['approve', 'lockfile-hygiene', '--note', 'reviewed by niko'], tmpDir)
    const entries = readApprovals(tmpDir)
    expect(entries[0].note).toBe('reviewed by niko')
  })

  // ── reject ────────────────────────────────────────────────────────────────

  it('rejecting a valid decision exits 0', () => {
    expect(run(['reject', 'lockfile-hygiene'], tmpDir).status).toBe(0)
  })

  it('rejecting writes rejected entry to approvals.jsonl', () => {
    run(['reject', 'lockfile-hygiene'], tmpDir)
    const entries = readApprovals(tmpDir)
    expect(entries[0].status).toBe('rejected')
  })

  it('rejected decision shows rejected in list', () => {
    run(['reject', 'lockfile-hygiene'], tmpDir)
    const out = JSON.parse(run(['list'], tmpDir).stdout)
    const d = out.decisions.find((x: { id: string }) => x.id === 'lockfile-hygiene')
    expect(d.approval_status).toBe('rejected')
  })

  // ── duplicate blocked ─────────────────────────────────────────────────────

  it('duplicate approve exits 1', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    expect(run(['approve', 'lockfile-hygiene'], tmpDir).status).toBe(1)
  })

  it('duplicate approve returns JSON error', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    const out = JSON.parse(run(['approve', 'lockfile-hygiene'], tmpDir).stdout)
    expect(out.status).toBe('error')
    expect(out.message).toContain('already')
  })

  it('reject after approve exits 1', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    expect(run(['reject', 'lockfile-hygiene'], tmpDir).status).toBe(1)
  })

  it('only one entry in approvals.jsonl after duplicate attempt', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    run(['approve', 'lockfile-hygiene'], tmpDir)
    expect(readApprovals(tmpDir)).toHaveLength(1)
  })

  // ── invalid id ────────────────────────────────────────────────────────────

  it('approving invalid id exits 1', () => {
    expect(run(['approve', 'nonexistent-decision'], tmpDir).status).toBe(1)
  })

  it('approving invalid id returns JSON error', () => {
    const out = JSON.parse(run(['approve', 'nonexistent-decision'], tmpDir).stdout)
    expect(out.status).toBe('error')
    expect(out.message).toContain('nonexistent-decision')
  })

  it('invalid id writes nothing to approvals.jsonl', () => {
    run(['approve', 'nonexistent-decision'], tmpDir)
    expect(readApprovals(tmpDir)).toHaveLength(0)
  })

  // ── persistence ───────────────────────────────────────────────────────────

  it('approvals persist across separate runs', () => {
    run(['approve', 'lockfile-hygiene'], tmpDir)
    // second independent process reads the same file
    const out = JSON.parse(run(['list'], tmpDir).stdout)
    const d = out.decisions.find((x: { id: string }) => x.id === 'lockfile-hygiene')
    expect(d.approval_status).toBe('approved')
    expect(d.approved_at).toBeTruthy()
  })

  // ── edge cases ────────────────────────────────────────────────────────────

  it('no command exits 1 with usage message', () => {
    expect(run([], tmpDir).status).toBe(1)
  })

  it('unknown command exits 1', () => {
    expect(run(['bogus'], tmpDir).status).toBe(1)
  })

  it('approve without id exits 1', () => {
    expect(run(['approve'], tmpDir).status).toBe(1)
  })
})
