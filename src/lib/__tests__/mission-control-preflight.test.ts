import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'child_process'

const {
  runMissionControlPreflight,
} = require('../../../scripts/mission-control-preflight.cjs')
const {
  validateMissionControlResult,
} = require('../../../scripts/mission-control-result-schema.cjs')
const {
  safeRun,
} = require('../../../scripts/local-capabilities.cjs')

function initRepo(dir: string) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'preflight-test',
    version: '1.0.0',
  }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n', 'utf-8')

  const commands = [
    ['git', ['init']],
    ['git', ['config', 'user.email', 'preflight@example.com']],
    ['git', ['config', 'user.name', 'Preflight Tester']],
    ['git', ['add', 'package.json', 'pnpm-lock.yaml']],
    ['git', ['commit', '-m', 'init']],
  ] as const

  for (const [cmd, args] of commands) {
    const result = spawnSync(cmd, args, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    })

    if (result.status !== 0) {
      throw new Error(`Failed to initialize test repo: ${cmd} ${args.join(' ')}\n${result.stderr}`)
    }
  }
}

describe('mission-control preflight', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-preflight-'))
    initRepo(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns PASS for a clean local environment', () => {
    const result = runMissionControlPreflight({ root: tmpDir, env: {} })

    expect(result.status).toBe('PASS')
    expect(result.failures).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('returns WARN for a dirty working tree', () => {
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'pending\n', 'utf-8')

    const result = runMissionControlPreflight({ root: tmpDir, env: {} })

    expect(result.status).toBe('WARN')
    expect(result.warnings).toContain('Working tree is dirty')
  })

  it('returns FAIL when a critical tool is missing', () => {
    const result = runMissionControlPreflight({
      root: tmpDir,
      env: {},
      runCommand(command: string, args: string[]) {
        if (command === 'pnpm' && args[0] === '--version') {
          return { ok: false, stdout: '', stderr: '', error: 'not found' }
        }
        return safeRun(command, args)
      },
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('pnpm is not available (not found).')
  })

  it('returns FAIL when git state is unreadable', () => {
    const result = runMissionControlPreflight({
      root: tmpDir,
      env: {},
      runCommand(command: string, args: string[]) {
        if (command === 'git' && (args.includes('branch') || args.includes('status'))) {
          return { ok: false, stdout: '', stderr: '', error: 'git unavailable' }
        }
        return safeRun(command, args)
      },
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('Unable to read current git branch')
  })

  it('returns WARN when dual lockfiles are present', () => {
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}\n', 'utf-8')

    const result = runMissionControlPreflight({ root: tmpDir, env: {} })

    expect(result.status).toBe('WARN')
    expect(result.warnings).toContain('Both package-lock.json and pnpm-lock.yaml are present')
  })

  it('returns FAIL when dangerous execution flags are enabled', () => {
    const result = runMissionControlPreflight({
      root: tmpDir,
      env: {
        MC_ALLOW_EXECUTE: '1',
        MC_DISABLE_RATE_LIMIT: '1',
      },
    })

    expect(result.status).toBe('FAIL')
    expect(result.failures).toContain('MC_ALLOW_EXECUTE is enabled')
    expect(result.failures).toContain('MC_DISABLE_RATE_LIMIT is enabled')
  })

  it('returns WARN when execution is requested without dangerous flags', () => {
    const result = runMissionControlPreflight({
      root: tmpDir,
      env: {},
      executeRequested: true,
    })

    expect(result.status).toBe('WARN')
    expect(result.warnings).toContain('Execution was explicitly requested for this coordinator run')
  })

  it('preflight output validates against the canonical result schema', () => {
    const result = runMissionControlPreflight({ root: tmpDir, env: {} })
    const validation = validateMissionControlResult(result)

    expect(validation.valid).toBe(true)
    expect(validation.failures).toEqual([])
  })
})
