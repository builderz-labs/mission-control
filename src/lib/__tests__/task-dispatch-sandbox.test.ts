import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CLAUDE_CLI_ALLOWED_TOOL_NAMES,
  CLI_MAX_BUDGET_USD_CEILING,
  clampCliMaxBudgetUsd,
  filterCliAllowedTools,
  resolveCliDispatchCwd,
  resolveCliSandboxOptions,
} from '@/lib/task-dispatch'

// Real directory layout for cwd-scoping tests:
//   root/            (workspace root)
//   root/project/    (valid cwd)
//   root/escape-link -> outside/   (symlink escape)
//   outside/         (sibling of root, must never be reachable)
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sandbox-test-'))
const root = path.join(base, 'root')
const project = path.join(root, 'project')
const outside = path.join(base, 'outside')
fs.mkdirSync(project, { recursive: true })
fs.mkdirSync(outside, { recursive: true })
const escapeLink = path.join(root, 'escape-link')
fs.symlinkSync(outside, escapeLink, 'dir')
// realpath the expectations: on macOS os.tmpdir() itself sits behind a symlink
const realRoot = fs.realpathSync(root)
const realProject = fs.realpathSync(project)

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true })
})

describe('filterCliAllowedTools', () => {
  it('passes through tools on the conservative allowlist, deduplicated', () => {
    expect(filterCliAllowedTools(['Read', 'Grep', 'Read'])).toEqual(['Read', 'Grep'])
  })

  it('drops unknown tools while keeping valid ones', () => {
    expect(filterCliAllowedTools(['Read', 'DangerousTool', 'Bash(rm:*)', 'Bash']))
      .toEqual(['Read', 'Bash'])
  })

  it('never admits --dangerously-skip-permissions or non-string entries', () => {
    expect(filterCliAllowedTools(['--dangerously-skip-permissions', 42, null])).toBeNull()
  })

  it('returns null (flag omitted, fail closed) for non-arrays and all-invalid lists', () => {
    expect(filterCliAllowedTools(undefined)).toBeNull()
    expect(filterCliAllowedTools('Read,Grep')).toBeNull()
    expect(filterCliAllowedTools([])).toBeNull()
    expect(filterCliAllowedTools(['NotATool'])).toBeNull()
  })

  it('accepts every name in the exported allowlist constant', () => {
    expect(filterCliAllowedTools([...CLAUDE_CLI_ALLOWED_TOOL_NAMES]))
      .toEqual([...CLAUDE_CLI_ALLOWED_TOOL_NAMES])
  })
})

describe('clampCliMaxBudgetUsd', () => {
  it('passes through a sane finite positive budget', () => {
    expect(clampCliMaxBudgetUsd(5)).toBe(5)
    expect(clampCliMaxBudgetUsd(0.5)).toBe(0.5)
  })

  it('caps at the ceiling', () => {
    expect(clampCliMaxBudgetUsd(10_000)).toBe(CLI_MAX_BUDGET_USD_CEILING)
    expect(clampCliMaxBudgetUsd(CLI_MAX_BUDGET_USD_CEILING)).toBe(CLI_MAX_BUDGET_USD_CEILING)
  })

  it('rejects zero, negatives, non-finite values, and non-numbers', () => {
    expect(clampCliMaxBudgetUsd(0)).toBeNull()
    expect(clampCliMaxBudgetUsd(-3)).toBeNull()
    expect(clampCliMaxBudgetUsd(Number.POSITIVE_INFINITY)).toBeNull()
    expect(clampCliMaxBudgetUsd(Number.NaN)).toBeNull()
    expect(clampCliMaxBudgetUsd('5')).toBeNull()
    expect(clampCliMaxBudgetUsd(undefined)).toBeNull()
  })
})

describe('resolveCliDispatchCwd', () => {
  it('is disabled when no workspace root is configured', () => {
    expect(resolveCliDispatchCwd('project', '')).toBeNull()
    expect(resolveCliDispatchCwd(realProject, '')).toBeNull()
  })

  it('resolves a relative path inside the root', () => {
    expect(resolveCliDispatchCwd('project', root)).toBe(realProject)
  })

  it('resolves an absolute path inside the root', () => {
    expect(resolveCliDispatchCwd(project, root)).toBe(realProject)
  })

  it('accepts the root itself', () => {
    expect(resolveCliDispatchCwd('.', root)).toBe(realRoot)
  })

  it('rejects ../ traversal out of the root', () => {
    expect(resolveCliDispatchCwd('../outside', root)).toBeNull()
    expect(resolveCliDispatchCwd('project/../../outside', root)).toBeNull()
  })

  it('rejects absolute paths outside the root', () => {
    expect(resolveCliDispatchCwd(outside, root)).toBeNull()
    expect(resolveCliDispatchCwd(os.tmpdir(), root)).toBeNull()
  })

  it('rejects symlinks inside the root that point outside it', () => {
    expect(resolveCliDispatchCwd('escape-link', root)).toBeNull()
  })

  it('rejects a sibling directory that shares the root as a path prefix', () => {
    // root2 startsWith(root) as a string but is not inside root/
    const sibling = `${root}2`
    fs.mkdirSync(sibling, { recursive: true })
    expect(resolveCliDispatchCwd(sibling, root)).toBeNull()
  })

  it('rejects missing paths and non-directories', () => {
    expect(resolveCliDispatchCwd('does-not-exist', root)).toBeNull()
    const file = path.join(root, 'file.txt')
    fs.writeFileSync(file, 'x')
    expect(resolveCliDispatchCwd('file.txt', root)).toBeNull()
  })

  it('ignores non-string and empty input', () => {
    expect(resolveCliDispatchCwd(undefined, root)).toBeNull()
    expect(resolveCliDispatchCwd('   ', root)).toBeNull()
    expect(resolveCliDispatchCwd(42, root)).toBeNull()
  })
})

describe('resolveCliSandboxOptions', () => {
  it('returns all-null (today\'s behavior) when nothing is configured', () => {
    expect(resolveCliSandboxOptions({ id: 1, agent_config: null, metadata: null }, ''))
      .toEqual({ allowedTools: null, maxBudgetUsd: null, cwd: null })
    expect(resolveCliSandboxOptions({ id: 1, agent_config: '{"openclawId":"main"}', metadata: '{}' }, root))
      .toEqual({ allowedTools: null, maxBudgetUsd: null, cwd: null })
  })

  it('sources options from the agent config', () => {
    const agent_config = JSON.stringify({
      dispatchAllowedTools: ['Read', 'Grep', 'BogusTool'],
      dispatchMaxBudgetUsd: 250,
      dispatchCwd: 'project',
    })
    expect(resolveCliSandboxOptions({ id: 1, agent_config, metadata: null }, root)).toEqual({
      allowedTools: ['Read', 'Grep'],
      maxBudgetUsd: CLI_MAX_BUDGET_USD_CEILING,
      cwd: realProject,
    })
  })

  it('lets tasks.metadata override individual fields (camelCase and snake_case)', () => {
    const agent_config = JSON.stringify({
      dispatchAllowedTools: ['Read'],
      dispatchMaxBudgetUsd: 10,
      dispatchCwd: 'project',
    })
    const metadata = JSON.stringify({
      dispatch_max_budget_usd: 2,
      dispatchAllowedTools: ['Bash', 'Edit'],
    })
    expect(resolveCliSandboxOptions({ id: 1, agent_config, metadata }, root)).toEqual({
      allowedTools: ['Bash', 'Edit'],
      maxBudgetUsd: 2,
      cwd: realProject, // untouched by metadata → agent config wins
    })
  })

  it('disables cwd when no workspace root is configured even if requested', () => {
    const agent_config = JSON.stringify({ dispatchCwd: 'project' })
    expect(resolveCliSandboxOptions({ id: 1, agent_config, metadata: null }, '').cwd).toBeNull()
  })

  it('ignores malformed agent config and metadata payloads', () => {
    expect(resolveCliSandboxOptions({ id: 1, agent_config: '{not json', metadata: '[1,2]' }, root))
      .toEqual({ allowedTools: null, maxBudgetUsd: null, cwd: null })
  })
})
