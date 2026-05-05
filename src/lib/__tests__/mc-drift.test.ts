import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SCRIPT_PATH  = path.resolve(__dirname, '../../../scripts/mc-drift.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

const FORBIDDEN = [
  'git add', 'git commit', 'git push', 'git reset', 'git clean',
  'fetch(', 'http.get', 'https.get', 'axios', 'XMLHttpRequest',
  'execSync', 'spawnSync', 'exec(', 'spawn(',
]

function run(logDir: string): { stdout: string; status: number | null } {
  const r = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, MC_LOG_DIR: logDir },
    timeout: 10000,
  })
  return { stdout: r.stdout || '', status: r.status }
}

function makeRun(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    coordinator: 'Mission Control Coordinator v1',
    label: 'OBSERVE ONLY',
    timestamp: new Date().toISOString(),
    status: 'WARN',
    risk_level: 1,
    agents: {
      repo_steward: { status: 'WARN', risk_level: 1 },
      skill_intake: { status: 'ok',   risk_level: 0 },
    },
    summary: { total_agents: 2, ok: 1, warn: 1, fail: 0, warnings: ['dual lockfile'], recommended_next_actions: [] },
    ...overrides,
  })
}

function writeHistory(dir: string, runs: string[]) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'history.jsonl'), runs.join('\n') + '\n', 'utf-8')
}

describe('mc-drift', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-drift-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── Output validity ──────────────────────────────────────────────────────

  it('emits valid JSON', () => {
    writeHistory(tmpDir, [makeRun(), makeRun()])
    expect(() => JSON.parse(run(tmpDir).stdout)).not.toThrow()
  })

  it('exits 0', () => {
    writeHistory(tmpDir, [makeRun(), makeRun()])
    expect(run(tmpDir).status).toBe(0)
  })

  it('output has required top-level fields', () => {
    writeHistory(tmpDir, [makeRun(), makeRun()])
    const out = JSON.parse(run(tmpDir).stdout)
    for (const f of ['timestamp', 'drift_detected', 'changes']) {
      expect(out).toHaveProperty(f)
    }
  })

  // ── No drift ─────────────────────────────────────────────────────────────

  it('drift_detected is false when runs are identical', () => {
    const r = makeRun()
    writeHistory(tmpDir, [r, r])
    expect(JSON.parse(run(tmpDir).stdout).drift_detected).toBe(false)
  })

  // ── Risk change ───────────────────────────────────────────────────────────

  it('detects risk_level increase', () => {
    writeHistory(tmpDir, [
      makeRun({ risk_level: 0 }),
      makeRun({ risk_level: 2 }),
    ])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.risk_change).toEqual({ before: 0, after: 2 })
  })

  it('detects risk_level decrease', () => {
    writeHistory(tmpDir, [
      makeRun({ risk_level: 2 }),
      makeRun({ risk_level: 0 }),
    ])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.risk_change).toEqual({ before: 2, after: 0 })
  })

  it('no risk_change when levels are equal', () => {
    writeHistory(tmpDir, [makeRun({ risk_level: 1 }), makeRun({ risk_level: 1 })])
    expect(JSON.parse(run(tmpDir).stdout).changes.risk_change).toBeNull()
  })

  // ── Warnings ──────────────────────────────────────────────────────────────

  it('detects new warning', () => {
    const prev = makeRun({ summary: { warnings: ['dual lockfile'], recommended_next_actions: [] } })
    const curr = makeRun({ summary: { warnings: ['dual lockfile', 'new issue'], recommended_next_actions: [] } })
    writeHistory(tmpDir, [prev, curr])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.new_warnings).toContain('new issue')
  })

  it('detects resolved warning', () => {
    const prev = makeRun({ summary: { warnings: ['dual lockfile', 'old issue'], recommended_next_actions: [] } })
    const curr = makeRun({ summary: { warnings: ['dual lockfile'], recommended_next_actions: [] } })
    writeHistory(tmpDir, [prev, curr])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.resolved_warnings).toContain('old issue')
  })

  // ── Agent status changes ──────────────────────────────────────────────────

  it('detects agent status change OK → WARN', () => {
    const prev = makeRun({ agents: { repo_steward: { status: 'OK', risk_level: 0 }, skill_intake: { status: 'ok', risk_level: 0 } } })
    const curr = makeRun({ agents: { repo_steward: { status: 'WARN', risk_level: 1 }, skill_intake: { status: 'ok', risk_level: 0 } } })
    writeHistory(tmpDir, [prev, curr])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    const change = out.changes.agent_status_changes.find((c: { agent: string }) => c.agent === 'repo_steward')
    expect(change).toMatchObject({ agent: 'repo_steward', before: 'OK', after: 'WARN' })
  })

  it('detects agent status change WARN → FAIL', () => {
    const prev = makeRun({ agents: { repo_steward: { status: 'WARN', risk_level: 1 } } })
    const curr = makeRun({ agents: { repo_steward: { status: 'FAIL', risk_level: 3 } } })
    writeHistory(tmpDir, [prev, curr])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.agent_status_changes[0]).toMatchObject({ before: 'WARN', after: 'FAIL' })
  })

  // ── New / missing agents ──────────────────────────────────────────────────

  it('detects new agent', () => {
    const prev = makeRun({ agents: { repo_steward: { status: 'WARN', risk_level: 1 } } })
    const curr = makeRun({ agents: { repo_steward: { status: 'WARN', risk_level: 1 }, skill_intake: { status: 'ok', risk_level: 0 } } })
    writeHistory(tmpDir, [prev, curr])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.new_agents).toContain('skill_intake')
  })

  it('detects missing agent', () => {
    const prev = makeRun({ agents: { repo_steward: { status: 'WARN', risk_level: 1 }, skill_intake: { status: 'ok', risk_level: 0 } } })
    const curr = makeRun({ agents: { repo_steward: { status: 'WARN', risk_level: 1 } } })
    writeHistory(tmpDir, [prev, curr])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(true)
    expect(out.changes.missing_agents).toContain('skill_intake')
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles empty history gracefully', () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'history.jsonl'), '', 'utf-8')
    const { status, stdout } = run(tmpDir)
    expect(status).toBe(0)
    expect(JSON.parse(stdout).drift_detected).toBe(false)
  })

  it('handles single-run history gracefully', () => {
    writeHistory(tmpDir, [makeRun()])
    const out = JSON.parse(run(tmpDir).stdout)
    expect(out.drift_detected).toBe(false)
    expect(out.changes.notes[0]).toContain('one run')
  })

  it('handles missing history file gracefully', () => {
    const { status, stdout } = run(tmpDir)
    expect(status).toBe(0)
    expect(JSON.parse(stdout).drift_detected).toBe(false)
  })

  // ── Safety ────────────────────────────────────────────────────────────────

  it('does not contain forbidden commands in source', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf-8')
    for (const cmd of FORBIDDEN) {
      expect(source, `forbidden: "${cmd}"`).not.toContain(cmd)
    }
  })
})
