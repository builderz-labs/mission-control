import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const COORDINATOR_PATH = path.resolve(__dirname, '../../../scripts/mc-coordinator.cjs')
const REGISTRY_PATH    = path.resolve(__dirname, '../../../data/mission-control/agent-registry.json')
const PROJECT_ROOT     = path.resolve(__dirname, '../../..')

const FORBIDDEN = [
  'git add', 'git commit', 'git push', 'git reset', 'git clean',
  'pnpm install', 'npm install', 'pnpm update', 'npm update',
  'gh skill install', 'rm -rf', 'curl', 'wget', 'Invoke-WebRequest',
]

function runCoordinator(env: Record<string, string> = {}): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('node', [COORDINATOR_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    timeout: 60000,
  })
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status }
}

function makeTempRegistry(agents: unknown[], dir: string): string {
  const p = path.join(dir, 'agent-registry.json')
  fs.writeFileSync(p, JSON.stringify({ schema_version: '1', agents }), 'utf-8')
  return p
}

describe('mc-coordinator', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-coord-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── Registry ─────────────────────────────────────────────────────────────

  it('agent-registry.json exists and is valid JSON', () => {
    expect(fs.existsSync(REGISTRY_PATH)).toBe(true)
    expect(() => JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))).not.toThrow()
  })

  it('registry contains repo-steward', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    expect(reg.agents.map((a: { id: string }) => a.id)).toContain('repo-steward')
  })

  it('registry contains skill-intake', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    expect(reg.agents.map((a: { id: string }) => a.id)).toContain('skill-intake')
  })

  it('all registry agents have id and enabled fields', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    for (const agent of reg.agents) {
      expect(agent, `agent missing id`).toHaveProperty('id')
      expect(agent, `agent ${agent.id} missing enabled`).toHaveProperty('enabled')
    }
  })

  it('enabled agents have command, observe_only, and timeout_ms', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    for (const agent of reg.agents.filter((a: { enabled: boolean }) => a.enabled)) {
      for (const field of ['command', 'observe_only', 'timeout_ms']) {
        expect(agent, `agent ${agent.id} missing ${field}`).toHaveProperty(field)
      }
    }
  })

  it('PLANNED agents have enabled: false', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    for (const agent of reg.agents.filter((a: { status: string }) => a.status === 'PLANNED')) {
      expect(agent.enabled, `PLANNED agent ${agent.id} must not be enabled`).toBe(false)
    }
  })

  it('all enabled agents have observe_only: true', () => {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'))
    for (const a of reg.agents.filter((a: { enabled: boolean }) => a.enabled)) {
      expect(a.observe_only, `${a.id} must be observe_only`).toBe(true)
    }
  })

  // ── Output shape ──────────────────────────────────────────────────────────

  it('emits valid JSON', () => {
    expect(() => JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)).not.toThrow()
  })

  it('coordinator field is correct', () => {
    expect(JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout).coordinator)
      .toBe('Mission Control Coordinator v1')
  })

  it('label is OBSERVE ONLY', () => {
    expect(JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout).label)
      .toBe('OBSERVE ONLY')
  })

  it('has all required top-level fields', () => {
    const report = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    for (const f of ['status', 'risk_level', 'agents', 'summary', 'timestamp']) {
      expect(report).toHaveProperty(f)
    }
  })

  it('status is PASS, WARN, or FAIL', () => {
    expect(['PASS', 'WARN', 'FAIL']).toContain(
      JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout).status
    )
  })

  it('risk_level is 0–3', () => {
    expect([0, 1, 2, 3]).toContain(
      JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout).risk_level
    )
  })

  it('summary has total_agents, pass, warn, fail', () => {
    const { summary } = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    for (const f of ['total_agents', 'pass', 'warn', 'fail']) {
      expect(typeof summary[f]).toBe('number')
    }
  })

  it('does not emit legacy summary.ok', () => {
    const { summary } = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    expect(summary).not.toHaveProperty('ok')
  })

  it('agents key contains repo-steward and skill-intake', () => {
    const { agents } = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    expect(agents).toHaveProperty('repo-steward')
    expect(agents).toHaveProperty('skill-intake')
  })

  it('skill-intake no longer fails canonical schema verification for missing risk_level', () => {
    const report = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    const skillIntake = report.agents['skill-intake']

    expect(skillIntake).toBeDefined()
    expect(skillIntake.status).toBe('PASS')
    expect(skillIntake.risk_level).toBe(0)
    expect(skillIntake.warnings || []).not.toContain('Missing required field: risk_level')
    expect(JSON.stringify(skillIntake)).not.toContain('Missing required field: risk_level')
  })

  it('systems-curator no longer fails on the gated mc-execute deletion path', () => {
    const report = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    const systemsCurator = report.agents['systems-curator']

    expect(systemsCurator).toBeDefined()
    expect(systemsCurator.status).not.toBe('FAIL')
    expect((systemsCurator.warnings || []).join(' ')).not.toContain('fs.unlinkSync')
    expect(report.status).not.toBe('FAIL')
  })

  it('repo-steward no longer triggers legacy OK normalization warnings', () => {
    const report = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    const repoSteward = report.agents['repo-steward']
    const summaryWarnings = report.summary?.warnings || []

    expect(repoSteward).toBeDefined()
    expect(repoSteward.status).not.toBe('FAIL')
    expect((repoSteward.warnings || []).join(' ')).not.toContain('Legacy status OK normalized to PASS')
    expect(JSON.stringify(summaryWarnings)).not.toContain('Legacy status OK normalized to PASS')
  })

  it('systems-curator no longer triggers legacy OK normalization warnings', () => {
    const report = JSON.parse(runCoordinator({ MC_LOG_DIR: tmpDir }).stdout)
    const systemsCurator = report.agents['systems-curator']
    const summaryWarnings = report.summary?.warnings || []

    expect(systemsCurator).toBeDefined()
    expect((systemsCurator.warnings || []).join(' ')).not.toContain('Legacy status OK normalized to PASS')
    expect(JSON.stringify(summaryWarnings)).not.toContain('Legacy status OK normalized to PASS')
  })

  // ── Log persistence ───────────────────────────────────────────────────────

  it('writes latest.json', () => {
    runCoordinator({ MC_LOG_DIR: tmpDir })
    expect(fs.existsSync(path.join(tmpDir, 'latest.json'))).toBe(true)
  })

  it('latest.json matches coordinator field in stdout', () => {
    const { stdout } = runCoordinator({ MC_LOG_DIR: tmpDir })
    const latest = JSON.parse(fs.readFileSync(path.join(tmpDir, 'latest.json'), 'utf-8'))
    expect(latest.coordinator).toBe(JSON.parse(stdout).coordinator)
  })

  it('history.jsonl appends one line per run', () => {
    runCoordinator({ MC_LOG_DIR: tmpDir })
    runCoordinator({ MC_LOG_DIR: tmpDir })
    const lines = fs.readFileSync(path.join(tmpDir, 'history.jsonl'), 'utf-8')
      .trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow()
  })

  // ── Failure handling ──────────────────────────────────────────────────────

  it('captures failed agent without crashing', () => {
    const reg = makeTempRegistry([{
      id: 'bad_agent', name: 'Bad',
      command: ['node', '-e', 'process.exit(1)'],
      enabled: true, observe_only: true, timeout_ms: 5000,
    }], tmpDir)
    const { status, stdout } = runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir })
    expect(status).toBe(0)
    const report = JSON.parse(stdout)
    expect(report.agents.bad_agent.status).toBe('FAIL')
  })

  it('FAIL agent sets overall status to FAIL', () => {
    const reg = makeTempRegistry([{
      id: 'bad', command: ['node', '-e', 'process.exit(1)'],
      enabled: true, observe_only: true, timeout_ms: 5000,
    }], tmpDir)
    expect(JSON.parse(runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir }).stdout).status)
      .toBe('FAIL')
  })

  it('exits 1 when any enabled agent has observe_only: false', () => {
    const reg = makeTempRegistry([{
      id: 'unsafe', command: ['node', '-e', 'console.log("{}")'],
      enabled: true, observe_only: false, timeout_ms: 5000,
    }], tmpDir)
    const { status } = runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir })
    expect(status).toBe(1)
  })

  it('error output names the violating agent when observe_only is false', () => {
    const reg = makeTempRegistry([{
      id: 'rogue-agent', command: ['node', '-e', 'console.log("{}")'],
      enabled: true, observe_only: false, timeout_ms: 5000,
    }], tmpDir)
    const r = runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir })
    // error is written to stderr
    expect(r.stderr || r.stdout).toContain('rogue-agent')
  })

  it('all-observe_only registry runs normally (exit 0)', () => {
    const reg = makeTempRegistry([{
      id: 'safe_agent', command: ['node', '-e', 'console.log(JSON.stringify({status:"OK",risk_level:0}))'],
      enabled: true, observe_only: true, timeout_ms: 5000,
    }], tmpDir)
    const { status } = runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir })
    expect(status).toBe(0)
  })

  it('handles empty registry without crashing', () => {
    const reg = makeTempRegistry([], tmpDir)
    const { status, stdout } = runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir })
    expect(status).toBe(0)
    expect(() => JSON.parse(stdout)).not.toThrow()
  })

  it('risk_level is max of child risk_levels', () => {
    const reg = makeTempRegistry([
      { id: 'a1', command: ['node', '-e', 'console.log(JSON.stringify({status:"OK",risk_level:0}))'],
        enabled: true, observe_only: true, timeout_ms: 5000 },
      { id: 'a2', command: ['node', '-e', 'console.log(JSON.stringify({status:"WARN",risk_level:2}))'],
        enabled: true, observe_only: true, timeout_ms: 5000 },
    ], tmpDir)
    const report = JSON.parse(runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir }).stdout)
    expect(report.risk_level).toBe(2)
    expect(report.status).toBe('WARN')
  })

  it('surfaces pre-flight FAIL before running child agents', () => {
    const reg = makeTempRegistry([{
      id: 'should-not-run',
      command: ['node', '-e', 'console.log(JSON.stringify({status:"PASS",risk_level:0,summary:{},checks:[],failures:[],warnings:[],next_actions:[],validation:{},metadata:{}}))'],
      enabled: true,
      observe_only: true,
      timeout_ms: 5000,
    }], tmpDir)

    const report = JSON.parse(runCoordinator({
      MC_REGISTRY_PATH: reg,
      MC_LOG_DIR: tmpDir,
      MC_ALLOW_EXECUTE: '1',
    }).stdout)

    expect(report.status).toBe('FAIL')
    expect(report.agents['mission-control-preflight'].status).toBe('FAIL')
    expect(report.agents['should-not-run']).toBeUndefined()
  })

  // ── Safety ────────────────────────────────────────────────────────────────

  it('does not contain forbidden commands in source', () => {
    const source = fs.readFileSync(COORDINATOR_PATH, 'utf-8')
    for (const cmd of FORBIDDEN) {
      expect(source, `forbidden: "${cmd}"`).not.toContain(cmd)
    }
  })
})
