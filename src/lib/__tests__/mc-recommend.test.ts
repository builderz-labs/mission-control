import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SCRIPT_PATH  = path.resolve(__dirname, '../../../scripts/mc-recommend.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

function run(logDir: string): { stdout: string; status: number | null } {
  const r = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, MC_LOG_DIR: logDir },
    timeout: 15000,
  })
  return { stdout: r.stdout || '', status: r.status }
}

// Minimal coordinator report for use as latest.json and history entries
function makeReport(overrides: Record<string, unknown> = {}): object {
  return {
    coordinator: 'Mission Control Coordinator v1',
    label: 'OBSERVE ONLY',
    timestamp: new Date().toISOString(),
    status: 'WARN',
    risk_level: 1,
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

function cleanReport(overrides: Record<string, unknown> = {}): object {
  return makeReport({
    status: 'OK', risk_level: 0,
    agents: {
      repo_steward: {
        status: 'OK', risk_level: 0,
        git: { is_clean: true },
        packages: { dual_lockfile_warn: false },
      },
      skill_intake: { status: 'ok', risk_level: 0 },
    },
    summary: { total_agents: 2, ok: 2, warn: 0, fail: 0, warnings: [], recommended_next_actions: [] },
    ...overrides,
  })
}

function writeDir(dir: string, latest: object, history: object[]) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(latest, null, 2), 'utf-8')
  fs.writeFileSync(
    path.join(dir, 'history.jsonl'),
    history.map(e => JSON.stringify(e)).join('\n') + '\n',
    'utf-8'
  )
}

describe('mc-recommend', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rec-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── Output validity ──────────────────────────────────────────────────────

  it('emits valid JSON', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    expect(() => JSON.parse(run(tmpDir).stdout)).not.toThrow()
  })

  it('exits 0 on valid input', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    expect(run(tmpDir).status).toBe(0)
  })

  it('label is OBSERVE ONLY', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    expect(JSON.parse(run(tmpDir).stdout).label).toBe('OBSERVE ONLY')
  })

  it('has required top-level fields', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    const out = JSON.parse(run(tmpDir).stdout)
    for (const f of ['timestamp', 'label', 'total', 'recommendations', 'coordinator_status', 'drift_detected']) {
      expect(out).toHaveProperty(f)
    }
  })

  it('recommendations is an array', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    expect(Array.isArray(JSON.parse(run(tmpDir).stdout).recommendations)).toBe(true)
  })

  // ── Rule 1: dual lockfile ────────────────────────────────────────────────

  it('dual lockfile warning produces lockfile-hygiene recommendation', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    const recs = JSON.parse(run(tmpDir).stdout).recommendations
    expect(recs.some((rec: { id: string }) => rec.id === 'lockfile-hygiene')).toBe(true)
  })

  it('lockfile-hygiene recommendation has correct priority', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    const recs = JSON.parse(run(tmpDir).stdout).recommendations
    const rec = recs.find((r: { id: string }) => r.id === 'lockfile-hygiene')
    expect(rec.priority).toBe('medium')
  })

  it('lockfile-hygiene action mentions manual review not auto-delete', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    const recs = JSON.parse(run(tmpDir).stdout).recommendations
    const rec = recs.find((r: { id: string }) => r.id === 'lockfile-hygiene')
    expect(rec.action.toLowerCase()).not.toContain('auto')
    expect(rec.action.toLowerCase()).not.toContain('delete')
    expect(rec.action.toLowerCase()).toContain('review')
    expect(rec.action.toLowerCase()).toContain('manually')
  })

  // ── Rule 2: observe-only ─────────────────────────────────────────────────

  it('all recommendations have auto_apply: false', () => {
    const r = makeReport()
    writeDir(tmpDir, r, [r, r])
    const recs = JSON.parse(run(tmpDir).stdout).recommendations
    for (const rec of recs) {
      expect(rec.auto_apply).toBe(false)
    }
  })

  it('auto_apply is false even for critical recommendations', () => {
    const r = makeReport({
      agents: { bad_agent: { status: 'FAIL', risk_level: 3, git: { is_clean: true }, packages: { dual_lockfile_warn: false } } },
      summary: { total_agents: 1, ok: 0, warn: 0, fail: 1, warnings: [], recommended_next_actions: [] },
    })
    writeDir(tmpDir, r, [r, r])
    const recs = JSON.parse(run(tmpDir).stdout).recommendations
    for (const rec of recs) {
      expect(rec.auto_apply).toBe(false)
    }
  })

  // ── Rule 3: clean state → no recommendations ─────────────────────────────

  it('clean latest.json and stable drift produces no recommendations', () => {
    const r = cleanReport()
    writeDir(tmpDir, r, [r, r])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.total).toBe(0)
    expect(out.recommendations).toHaveLength(0)
  })

  it('no dual lockfile → no lockfile-hygiene recommendation', () => {
    const r = cleanReport()
    writeDir(tmpDir, r, [r, r])
    const recs = JSON.parse(run(tmpDir).stdout).recommendations
    expect(recs.some((rec: { id: string }) => rec.id === 'lockfile-hygiene')).toBe(false)
  })

  // ── Rule 4: missing / malformed logs ────────────────────────────────────

  it('missing latest.json exits 1 with JSON error', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    // no latest.json written
    const { status, stdout } = run(tmpDir)
    expect(status).toBe(1)
    const out = JSON.parse(stdout)
    expect(out.status).toBe('error')
    expect(out.recommendations).toHaveLength(0)
  })

  it('malformed latest.json exits 1 with JSON error', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'latest.json'), 'NOT JSON{{{', 'utf-8')
    const { status, stdout } = run(tmpDir)
    expect(status).toBe(1)
    const out = JSON.parse(stdout)
    expect(out.status).toBe('error')
    expect(out.recommendations).toHaveLength(0)
  })

  it('missing history.jsonl does not crash (drift returns gracefully)', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'latest.json'), JSON.stringify(cleanReport()), 'utf-8')
    // no history.jsonl
    const { status, stdout } = run(tmpDir)
    expect(status).toBe(0)
    expect(() => JSON.parse(stdout)).not.toThrow()
  })
})
