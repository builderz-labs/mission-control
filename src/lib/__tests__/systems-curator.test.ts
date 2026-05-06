import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'node:fs'
import path from 'node:path'
import curator from '../../../scripts/systems-curator.cjs'
const { verifyCompletedRun } = require('../../../scripts/mission-control-verification.cjs')

const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/systems-curator.cjs')
const PROJECT_ROOT = path.resolve(__dirname, '../../..')

function runScript(): { stdout: string; status: number | null } {
  const result = spawnSync('node', [SCRIPT_PATH], {
    encoding: 'utf-8',
    cwd: PROJECT_ROOT,
    timeout: 15000,
  })
  return {
    stdout: result.stdout || '',
    status: result.status,
  }
}

describe('systems-curator helpers', () => {
  it('normalizes agent names across separators and case', () => {
    expect(curator.normalizeAgentName('Systems Curator')).toBe('systemscurator')
    expect(curator.normalizeAgentName('systems-curator')).toBe('systemscurator')
    expect(curator.normalizeAgentName('systems_curator')).toBe('systemscurator')
  })

  it('parses documented agent names from AGENT_REGISTRY markdown', () => {
    const names = curator.parseDocumentedAgentNames(`
| Name | \`passive-income-bot\` |
| Name | \`systems-curator\` |
`)
    expect(names).toEqual(['passive-income-bot', 'systems-curator'])
  })

  it('detects package scripts that point to missing node targets', () => {
    const inspected = curator.inspectPackageScriptsData({
      scripts: {
        ok: 'node scripts/repo-steward.cjs',
        broken: 'node scripts/definitely-missing.cjs',
      },
    })

    expect(inspected.broken_targets.some((entry: { script: string; target: string }) =>
      entry.script === 'broken' && entry.target === 'scripts/definitely-missing.cjs'
    )).toBe(true)
  })

  it('detects the cron docs/runtime mismatch', () => {
    const warning = curator.detectScheduleMismatch(
      'All cron jobs are stored in the Mission Control database.',
      'const file = path.join(openclawHome, "cron", "jobs.json")'
    )
    expect(warning).toContain('SCHEDULES.md')
    expect(warning).toContain('jobs.json')
  })

  it('detects unsafe mutable execution paths from source text', () => {
    const findings = curator.detectUnsafeExecutionPaths('scripts/mc-execute.cjs', 'fs.unlinkSync(lockPath)')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toContain('unlinkSync')
  })

  it('does not flag explicitly gated and path-constrained mc-execute deletion', () => {
    const source = fs.readFileSync(path.resolve(PROJECT_ROOT, 'scripts/mc-execute.cjs'), 'utf-8')
    const findings = curator.detectUnsafeExecutionPaths('scripts/mc-execute.cjs', source)

    expect(findings).toEqual([])
    expect(curator.hasExplicitDeletionSafetyGuards(source)).toBe(true)
  })
})

describe('systems-curator CLI', () => {
  it('exits 0', () => {
    expect(runScript().status).toBe(0)
  })

  it('emits valid JSON', () => {
    expect(() => JSON.parse(runScript().stdout)).not.toThrow()
  })

  it('labels output as OBSERVE ONLY', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(parsed.label).toBe('OBSERVE ONLY')
  })

  it('includes required top-level fields', () => {
    const parsed = JSON.parse(runScript().stdout)
    for (const field of [
      'status',
      'risk_level',
      'label',
      'warnings',
      'recommended_next_actions',
      'registry',
      'coordinator',
      'package_scripts',
    ]) {
      expect(parsed).toHaveProperty(field)
    }
  })

  it('emits only canonical Mission Control statuses', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(['PASS', 'WARN', 'FAIL']).toContain(parsed.status)
  })

  it('reports systems-curator as registered and observe-only in this repo', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(parsed.registry.systems_curator_registered).toBe(true)
    expect(parsed.registry.systems_curator_observe_only).toBe(true)
  })

  it('reports warnings as an array of strings', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(Array.isArray(parsed.warnings)).toBe(true)
    for (const warning of parsed.warnings) {
      expect(typeof warning).toBe('string')
    }
  })

  it('does not fail on the gated mc-execute deletion path', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(parsed.unsafe_mutable_paths).toEqual([])
    expect(parsed.warnings.join(' ')).not.toContain('fs.unlinkSync')
    expect(parsed.status).not.toBe('FAIL')
  })

  it('does not emit legacy OK status', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(parsed.status).not.toBe('OK')
  })

  it('does not rely on legacy OK normalization in verification', () => {
    const parsed = JSON.parse(runScript().stdout)
    const verification = verifyCompletedRun(parsed)

    expect(verification.warnings).not.toContain('Legacy status OK normalized to PASS')
  })

  it('does not warn about PLANNED agents being absent from the coordinator', () => {
    const parsed = JSON.parse(runScript().stdout)
    const warningText = parsed.warnings.join(' ')
    // PLANNED agents are intentionally absent from enabled coordinator agents — not a drift
    expect(warningText).not.toMatch(/stocks-research-bot/)
    expect(warningText).not.toMatch(/sports-betting-bot/)
    expect(warningText).not.toMatch(/appliance-bot/)
    expect(warningText).not.toMatch(/builder-bot/)
    expect(warningText).not.toMatch(/research-scout/)
    expect(warningText).not.toMatch(/content-bot/)
  })

  it('registry.documented_missing_from_runtime is empty when all documented agents are in JSON', () => {
    const parsed = JSON.parse(runScript().stdout)
    expect(parsed.registry.documented_missing_from_runtime).toHaveLength(0)
  })
})

describe('systems-curator helpers — malformed agent validation', () => {
  it('does not flag PLANNED agents without command as malformed', () => {
    const findings = curator.detectUnsafeExecutionPaths('scripts/mc-execute.cjs', 'fs.mkdirSync(path)')
    expect(findings).toHaveLength(0)
  })
})
