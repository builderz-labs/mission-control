import { describe, it, expect } from 'vitest'

const { decide, buildCommands } = require('../../../scripts/pr-lifecycle-orchestrator.cjs')

// Helpers
function makeBranch(overrides: {
  current?: string | null
  is_main?: boolean
  tracking?: string | null
  ahead?: number | null
  behind?: number | null
  working_tree_clean?: boolean
} = {}) {
  return {
    current: 'feature-branch',
    is_main: false,
    tracking: null,
    ahead: null,
    behind: null,
    working_tree_clean: true,
    ...overrides,
  }
}

function makePr(overrides: {
  number?: number | null
  state?: string | null
  base?: string | null
  head?: string | null
  mergeable?: string | null
  changed_files?: number | null
} = {}) {
  return {
    number: null,
    state: null,
    base: null,
    head: null,
    mergeable: null,
    changed_files: null,
    ...overrides,
  }
}

const REPO = 'niko4244/mission-control'

// --- decide ---

describe('decide', () => {
  it('dirty main => stop_fix_required', () => {
    const branch = makeBranch({ current: 'main', is_main: true, working_tree_clean: false })
    const { next_action, stopConditions } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('stop_fix_required')
    expect(stopConditions.length).toBeGreaterThan(0)
  })

  it('dirty feature branch => commit_changes', () => {
    const branch = makeBranch({ working_tree_clean: false })
    const { next_action } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('commit_changes')
  })

  it('clean feature branch with no tracking => push_branch', () => {
    const branch = makeBranch({ tracking: null })
    const { next_action } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('push_branch')
  })

  it('clean pushed feature branch ahead of tracking => push_branch', () => {
    const branch = makeBranch({ tracking: 'niko/feature-branch', ahead: 2, behind: 0 })
    const { next_action } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('push_branch')
  })

  it('clean pushed feature branch in sync, no PR => create_pr', () => {
    const branch = makeBranch({ tracking: 'niko/feature-branch', ahead: 0, behind: 0 })
    const { next_action } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('create_pr')
  })

  it('clean pushed feature branch, PR open and mergeable => run_pr_reviewer', () => {
    const branch = makeBranch({ tracking: 'niko/feature-branch', ahead: 0, behind: 0 })
    const pr = makePr({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const { next_action } = decide(branch, pr, REPO)
    expect(next_action).toBe('run_pr_reviewer')
  })

  it('clean pushed feature branch, PR CONFLICTING => stop_fix_required', () => {
    const branch = makeBranch({ tracking: 'niko/feature-branch', ahead: 0, behind: 0 })
    const pr = makePr({ number: 7, state: 'OPEN', mergeable: 'CONFLICTING' })
    const { next_action, stopConditions } = decide(branch, pr, REPO)
    expect(next_action).toBe('stop_fix_required')
    expect(stopConditions.some((s: string) => s.includes('conflict'))).toBe(true)
  })

  it('clean main with no PR => idle', () => {
    const branch = makeBranch({ current: 'main', is_main: true, working_tree_clean: true })
    const { next_action } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('idle')
  })

  it('clean main with merged PR => sync_main_after_merge', () => {
    const branch = makeBranch({ current: 'main', is_main: true, working_tree_clean: true })
    const pr = makePr({ number: 6, state: 'MERGED' })
    const { next_action } = decide(branch, pr, REPO)
    expect(next_action).toBe('sync_main_after_merge')
  })

  it('null branch current => stop_fix_required', () => {
    const branch = makeBranch({ current: null })
    const { next_action } = decide(branch, makePr(), REPO)
    expect(next_action).toBe('stop_fix_required')
  })

  it('closed PR on feature branch => stop_fix_required', () => {
    const branch = makeBranch({ tracking: 'niko/feature-branch', ahead: 0, behind: 0 })
    const pr = makePr({ number: 7, state: 'CLOSED' })
    const { next_action, stopConditions } = decide(branch, pr, REPO)
    expect(next_action).toBe('stop_fix_required')
    expect(stopConditions.some((s: string) => s.includes('closed'))).toBe(true)
  })
})

// --- buildCommands ---

describe('buildCommands', () => {
  it('push_branch produces git push command with branch name', () => {
    const branch = makeBranch({ current: 'my-feature' })
    const cmds = buildCommands('push_branch', branch, makePr(), REPO)
    expect(cmds.some((c: string) => c.includes('git push') && c.includes('my-feature'))).toBe(true)
  })

  it('run_pr_reviewer includes pr number when provided', () => {
    const branch = makeBranch()
    const pr = makePr({ number: 42 })
    const cmds = buildCommands('run_pr_reviewer', branch, pr, REPO)
    expect(cmds.some((c: string) => c.includes('42'))).toBe(true)
    expect(cmds.some((c: string) => c.includes('pr-reviewer.cjs'))).toBe(true)
  })

  it('merge_pr includes pr number and squash flag', () => {
    const branch = makeBranch()
    const pr = makePr({ number: 99 })
    const cmds = buildCommands('merge_pr', branch, pr, REPO)
    expect(cmds.some((c: string) => c.includes('99') && c.includes('--squash'))).toBe(true)
  })

  it('sync_main_after_merge includes checkout main and pull', () => {
    const cmds = buildCommands('sync_main_after_merge', makeBranch(), makePr(), REPO)
    expect(cmds.some((c: string) => c.includes('checkout main'))).toBe(true)
    expect(cmds.some((c: string) => c.includes('pull'))).toBe(true)
  })

  it('idle includes mc-coordinator', () => {
    const cmds = buildCommands('idle', makeBranch(), makePr(), REPO)
    expect(cmds.some((c: string) => c.includes('mc-coordinator'))).toBe(true)
  })
})

// --- output shape ---

describe('output shape (via decide + buildCommands)', () => {
  it('decide always returns next_action, stopConditions, notes', () => {
    const result = decide(makeBranch(), makePr(), REPO)
    expect(result).toHaveProperty('next_action')
    expect(result).toHaveProperty('stopConditions')
    expect(result).toHaveProperty('notes')
    expect(Array.isArray(result.stopConditions)).toBe(true)
    expect(Array.isArray(result.notes)).toBe(true)
  })

  it('buildCommands always returns an array', () => {
    const cmds = buildCommands('idle', makeBranch(), makePr(), REPO)
    expect(Array.isArray(cmds)).toBe(true)
    expect(cmds.length).toBeGreaterThan(0)
  })

  it('script module exports are present', () => {
    const mod = require('../../../scripts/pr-lifecycle-orchestrator.cjs')
    expect(typeof mod.run).toBe('function')
    expect(typeof mod.decide).toBe('function')
    expect(typeof mod.buildCommands).toBe('function')
    expect(typeof mod.inspectBranch).toBe('function')
    expect(typeof mod.inspectPr).toBe('function')
  })
})

// --- observe-only contract ---

describe('observe-only contract', () => {
  it('run() returns an object without mutating anything (smoke test)', () => {
    const { run } = require('../../../scripts/pr-lifecycle-orchestrator.cjs')
    const result = run([])
    expect(result).toHaveProperty('agent', 'PR Lifecycle Orchestrator v1')
    expect(result).toHaveProperty('label', 'OBSERVE ONLY')
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('risk_level')
    expect(result).toHaveProperty('repo')
    expect(result).toHaveProperty('branch')
    expect(result).toHaveProperty('pr')
    expect(result).toHaveProperty('next_action')
    expect(result).toHaveProperty('commands')
    expect(result).toHaveProperty('stop_conditions')
    expect(result).toHaveProperty('notes')
    expect(typeof result.branch.current).toMatch(/string|null/)
    expect(typeof result.branch.is_main).toBe('boolean')
    expect(typeof result.branch.working_tree_clean).toBe('boolean')
    expect(Array.isArray(result.commands)).toBe(true)
    expect(Array.isArray(result.stop_conditions)).toBe(true)
    expect(Array.isArray(result.notes)).toBe(true)
  })
})
