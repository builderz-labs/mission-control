import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'

const {
  validateMissionControlResult,
} = require('../../../scripts/mission-control-result-schema.cjs')

const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/skill-intake.cjs')
const DATA_PATH = path.resolve(__dirname, '../../../data/mission-control/skill-intake.json')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

const EXPECTED_REPOS = [
  'https://github.com/TauricResearch/TradingAgents',
  'https://github.com/1jehuang/jcode',
  'https://github.com/mattpocock/skills',
  'https://github.com/browserbase/skills',
  'https://github.com/simstudioai/sim',
  'https://github.com/obra/superpowers',
]

const REQUIRED_FIELDS = [
  'name', 'repo_url', 'category', 'proposed_use',
  'integration_status', 'risk_level', 'allowed_actions', 'forbidden_actions', 'notes',
]

const FORBIDDEN_COMMANDS = [
  'git clone', 'npm install', 'pnpm install', 'npm update', 'pnpm update',
  'pip install', 'curl', 'wget', 'Invoke-WebRequest', 'gh repo clone', 'rm -rf',
]

const INSTALL_LIKE = ['install', 'clone', 'execute', 'update', 'upgrade', 'vendor']
const CANONICAL_FIELDS = [
  'agent',
  'label',
  'status',
  'risk_level',
  'summary',
  'checks',
  'failures',
  'warnings',
  'next_actions',
  'recommended_next_actions',
  'validation',
  'metadata',
]

function runIntake(): Record<string, unknown> {
  const r = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    timeout: 15000,
  })
  return JSON.parse(r.stdout) as Record<string, unknown>
}

describe('skill-intake', () => {
  it('emits valid JSON', () => {
    expect(() => runIntake()).not.toThrow()
  })

  it('status is PASS', () => {
    expect(runIntake().status).toBe('PASS')
  })

  it('label is OBSERVE ONLY', () => {
    expect(runIntake().label).toBe('OBSERVE ONLY')
  })

  it('includes the canonical Mission Control result fields', () => {
    const output = runIntake()
    for (const field of CANONICAL_FIELDS) {
      expect(output).toHaveProperty(field)
    }
  })

  it('validates against the canonical Mission Control result schema', () => {
    const output = runIntake()
    const validation = validateMissionControlResult(output)

    expect(validation.valid).toBe(true)
    expect(validation.failures).toEqual([])
  })

  it('risk_level is present and equals 0 for a healthy observe-only run', () => {
    expect(runIntake().risk_level).toBe(0)
  })

  it('total is 6', () => {
    expect(runIntake().total).toBe(6)
  })

  it('all six repos are present in candidate_list', () => {
    const output = runIntake()
    const list = output.candidate_list as Array<{ repo_url: string }>
    const urls = list.map(e => e.repo_url)
    for (const expected of EXPECTED_REPOS) {
      expect(urls, `missing repo: ${expected}`).toContain(expected)
    }
  })

  it('all entries have required fields in data file', () => {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
    for (const entry of data.entries) {
      for (const field of REQUIRED_FIELDS) {
        expect(entry, `entry "${entry.name}" missing field: ${field}`).toHaveProperty(field)
      }
    }
  })

  it('all entries have integration_status: candidate', () => {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
    for (const entry of data.entries) {
      expect(entry.integration_status).toBe('candidate')
    }
  })

  it('all risk_level values are 0, 1, 2, or 3', () => {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
    for (const entry of data.entries) {
      expect([0, 1, 2, 3]).toContain(entry.risk_level)
    }
  })

  it('allowed_actions does not include install/clone/execute for any entry', () => {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'))
    for (const entry of data.entries) {
      for (const action of (entry.allowed_actions as string[])) {
        for (const bad of INSTALL_LIKE) {
          expect(action.toLowerCase(), `entry "${entry.name}" has unsafe allowed_action: ${action}`).not.toContain(bad)
        }
      }
    }
  })

  it('output includes counts_by_category', () => {
    const output = runIntake()
    expect(output).toHaveProperty('counts_by_category')
    const counts = output.counts_by_category as Record<string, number>
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(6)
  })

  it('output includes counts_by_risk', () => {
    const output = runIntake()
    expect(output).toHaveProperty('counts_by_risk')
    const counts = output.counts_by_risk as Record<string, number>
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    expect(total).toBe(6)
  })

  it('does not contain forbidden commands in script source', () => {
    const source = fs.readFileSync(SCRIPT_PATH, 'utf-8')
    for (const cmd of FORBIDDEN_COMMANDS) {
      expect(source, `forbidden command in source: "${cmd}"`).not.toContain(cmd)
    }
  })

  it('validation_errors is an empty array', () => {
    const output = runIntake()
    expect(output.validation_errors).toEqual([])
  })

  it('uses PASS/WARN/FAIL status values, not legacy OK', () => {
    expect(['PASS', 'WARN', 'FAIL']).toContain(runIntake().status)
    expect(runIntake().status).not.toBe('OK')
  })
})
