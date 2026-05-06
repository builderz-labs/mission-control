import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const COORDINATOR_PATH = path.resolve(__dirname, '../../../scripts/mc-coordinator.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

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
  const registryPath = path.join(dir, 'agent-registry.json')
  fs.writeFileSync(registryPath, JSON.stringify({ schema_version: '1', agents }), 'utf-8')
  return registryPath
}

describe('mc-coordinator verification guard', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-coord-verify-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('fails agent output with an unknown status value', () => {
    const reg = makeTempRegistry([{
      id: 'unknown-status',
      command: ['node', '-e', 'console.log(JSON.stringify({status:"DONE",risk_level:0}))'],
      enabled: true,
      observe_only: true,
      timeout_ms: 5000,
    }], tmpDir)

    const report = JSON.parse(runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir }).stdout)

    expect(report.status).toBe('FAIL')
    expect(report.agents['unknown-status'].status).toBe('FAIL')
    expect(report.agents['unknown-status'].verification.status).toBe('FAIL')
  })

  it('fails agent output when required schema fields are missing', () => {
    const reg = makeTempRegistry([{
      id: 'missing-risk',
      command: ['node', '-e', 'console.log(JSON.stringify({status:"OK"}))'],
      enabled: true,
      observe_only: true,
      timeout_ms: 5000,
    }], tmpDir)

    const report = JSON.parse(runCoordinator({ MC_REGISTRY_PATH: reg, MC_LOG_DIR: tmpDir }).stdout)

    expect(report.status).toBe('FAIL')
    expect(report.agents['missing-risk'].status).toBe('FAIL')
    expect(report.agents['missing-risk'].verification.failures).toContain('Missing required field: risk_level')
  })
})
