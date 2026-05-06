import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'

const {
  verifyCompletedRun,
} = require('../../../scripts/mission-control-verification.cjs')

const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/repo-steward.cjs')

function runSteward(): Record<string, unknown> {
  const output = execSync(`node "${SCRIPT_PATH}"`, { encoding: 'utf-8', cwd: path.resolve(__dirname, '../../..') })
  return JSON.parse(output) as Record<string, unknown>
}

const EXPECTED_FIELDS = [
  'agent',
  'label',
  'status',
  'risk_level',
  'git',
  'packages',
  'project_structure',
  'warnings',
  'recommended_next_actions',
]

const FORBIDDEN_COMMANDS = [
  'git add',
  'git commit',
  'git push',
  'git reset --hard',
  'git clean -f',
  'pnpm install',
  'npm install',
  'pnpm upgrade',
  'pnpm update',
  'npm update',
  'npm upgrade',
  'rm -rf',
]

describe('repo-steward', () => {
  it('emits valid JSON', () => {
    expect(() => runSteward()).not.toThrow()
  })

  it('label is OBSERVE ONLY', () => {
    expect(runSteward().label).toBe('OBSERVE ONLY')
  })

  it('risk_level is a number', () => {
    expect(typeof runSteward().risk_level).toBe('number')
  })

  it('risk_level is 0, 1, 2, or 3', () => {
    expect([0, 1, 2, 3]).toContain(runSteward().risk_level)
  })

  it('status is PASS, WARN, or FAIL', () => {
    expect(['PASS', 'WARN', 'FAIL']).toContain(runSteward().status)
  })

  it('does not emit legacy OK status', () => {
    expect(runSteward().status).not.toBe('OK')
  })

  it('does not rely on legacy OK normalization in verification', () => {
    const output = runSteward()
    const verification = verifyCompletedRun(output)

    expect(verification.warnings).not.toContain('Legacy status OK normalized to PASS')
  })

  it('contains all expected top-level fields', () => {
    const report = runSteward()
    for (const field of EXPECTED_FIELDS) {
      expect(report, `missing field: ${field}`).toHaveProperty(field)
    }
  })

  it('warnings is an array', () => {
    expect(Array.isArray(runSteward().warnings)).toBe(true)
  })

  it('recommended_next_actions is an array', () => {
    expect(Array.isArray(runSteward().recommended_next_actions)).toBe(true)
  })

  it('agent field is Repo Steward v1', () => {
    expect(runSteward().agent).toBe('Repo Steward v1')
  })

  it('does not contain forbidden commands in script source', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf-8')
    for (const cmd of FORBIDDEN_COMMANDS) {
      expect(source, `forbidden command found: "${cmd}"`).not.toContain(cmd)
    }
  })
})
