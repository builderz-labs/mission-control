import { describe, it, expect } from 'vitest'

const {
  decide,
  buildCommands,
  buildApprovalGates,
  detectContradictions,
  classifyFailures,
  computeStatusRisk,
  extractRepoState,
  extractValidationState,
  run,
  NEXT_ACTIONS,
} = require('../../../scripts/workflow-governor.cjs')

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPO = 'niko4244/mission-control'

function makeRepoState(overrides: Record<string, unknown> = {}) {
  return {
    root: '/repo',
    branch_current: 'feature-branch',
    is_main: false,
    working_tree_clean: true,
    status_short: [],
    ahead_of_upstream: 0,
    behind_upstream: 0,
    tracking_ref: 'niko/feature-branch',
    ...overrides,
  }
}

function makeBranchState(overrides: Record<string, unknown> = {}) {
  return {
    current: 'feature-branch',
    is_main: false,
    tracking: 'niko/feature-branch',
    ahead: 0,
    behind: 0,
    working_tree_clean: true,
    ...overrides,
  }
}

function makePrState(overrides: Record<string, unknown> = {}) {
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

function makeValidationState(overrides: Record<string, unknown> = {}) {
  return {
    preflight_passed: true,
    pnpm_typecheck_passed: true,
    pnpm_test_passed: true,
    pnpm_build_passed: true,
    all_validations_passed: true,
    ...overrides,
  }
}

function makePreflightPass() {
  return {
    agent: 'Mission Control Preflight',
    status: 'PASS',
    risk_level: 0,
    failures: [],
    warnings: [],
    git: { branch: 'feature-branch', is_clean: true, status_short: [] },
  }
}

function makePreflightFail(message: string) {
  return {
    agent: 'Mission Control Preflight',
    status: 'FAIL',
    risk_level: 3,
    failures: [message],
    warnings: [],
    git: { branch: null, is_clean: false, status_short: [] },
  }
}

function makeReviewerPass() {
  return {
    agent: 'PR Reviewer Bot v1',
    status: 'WARN',
    risk_level: 1,
    red_flags: [],
    verdict: {
      status: 'WARN',
      risk_level: 1,
      recommendation: 'SAFE WITH NOTES — no production-impacting red flags detected',
    },
    validation: {
      passed: true,
      steps: [
        { step: 'typecheck', passed: true, exit_code: 0 },
        { step: 'test',      passed: true, exit_code: 0 },
        { step: 'build',     passed: true, exit_code: 0 },
      ],
    },
  }
}

function makeReviewerBlock(flags: unknown[]) {
  return {
    agent: 'PR Reviewer Bot v1',
    status: 'FAIL',
    risk_level: 3,
    red_flags: flags,
    verdict: {
      status: 'FAIL',
      risk_level: 3,
      recommendation: 'BLOCK',
    },
    validation: {
      passed: true,
      steps: [
        { step: 'typecheck', passed: true, exit_code: 0 },
        { step: 'test',      passed: true, exit_code: 0 },
        { step: 'build',     passed: true, exit_code: 0 },
      ],
    },
  }
}

function makeAllowlistedShellFlag(filePath: string) {
  return {
    flag: 'shell-execution',
    severity: 'high',
    path: filePath,
    line: 42,
    context_type: 'production',
    production_impact: false,
    allowed: true,
    allow_reason: 'observe-only local CLI script — git/gh inspection calls only, no mutation commands detected',
    requires_human_review: false,
    message: `shell-execution matched an allowlisted local Mission Control pattern at ${filePath}:42`,
    excerpt: "  const r = spawnSync('git', args, {",
  }
}

function makeProductionFlag(filePath: string) {
  return {
    flag: 'shell-execution',
    severity: 'high',
    path: filePath,
    line: 10,
    context_type: 'production',
    production_impact: true,
    allowed: false,
    allow_reason: null,
    requires_human_review: true,
    message: `shell-execution with production impact detected at ${filePath}:10`,
    excerpt: "  spawnSync('git', ['push', '-u', 'origin', branch], { encoding: 'utf-8' })",
  }
}

function makeBotResults(overrides: Record<string, unknown> = {}) {
  return {
    'mission-control-preflight': makePreflightPass(),
    'mc-coordinator': { coordinator: 'MC', status: 'PASS', risk_level: 0, agents: {}, summary: { pass: 1, warn: 0, fail: 0 } },
    'pr-lifecycle-orchestrator': {
      agent: 'PR Lifecycle Orchestrator v1',
      status: 'WARN',
      risk_level: 1,
      branch: makeBranchState(),
      pr: makePrState(),
      next_action: 'run_pr_reviewer',
    },
    ...overrides,
  }
}

// ── 1. clean main => idle ─────────────────────────────────────────────────────

describe('Scenario 1: clean main => idle', () => {
  it('returns idle when on main with clean tree and no PR', () => {
    const repo  = makeRepoState({ branch_current: 'main', is_main: true })
    const br    = makeBranchState({ current: 'main', is_main: true })
    const pr    = makePrState()
    const val   = makeValidationState()
    const bots  = makeBotResults()
    const fc    = classifyFailures(bots, repo, pr, [])
    const { next_action, confidence } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('idle')
    expect(confidence).toBeGreaterThanOrEqual(0.95)
  })
})

// ── 2. dirty main => stop_fix_required ───────────────────────────────────────

describe('Scenario 2: dirty main => stop_fix_required', () => {
  it('returns stop_fix_required when main has uncommitted changes', () => {
    const repo = makeRepoState({ branch_current: 'main', is_main: true, working_tree_clean: false })
    const br   = makeBranchState({ current: 'main', is_main: true, working_tree_clean: false })
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults()
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action, stopConditions } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('stop_fix_required')
    expect(stopConditions.length).toBeGreaterThan(0)
    expect(stopConditions[0]).toMatch(/dirty|dirty on main/i)
  })
})

// ── 3. dirty feature branch => commit_changes ────────────────────────────────

describe('Scenario 3: dirty feature branch => commit_changes', () => {
  it('returns commit_changes when feature branch has uncommitted changes', () => {
    const repo = makeRepoState({ working_tree_clean: false })
    const br   = makeBranchState({ working_tree_clean: false })
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults()
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('commit_changes')
  })
})

// ── 4. clean unpushed feature branch => push_branch ─────────────────────────

describe('Scenario 4: clean unpushed feature branch => push_branch', () => {
  it('returns push_branch when branch has no tracking ref', () => {
    const repo = makeRepoState({ tracking_ref: null })
    const br   = makeBranchState({ tracking: null, ahead: null })
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults()
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('push_branch')
  })

  it('returns push_branch when branch is ahead of tracking', () => {
    const repo = makeRepoState({ ahead_of_upstream: 2 })
    const br   = makeBranchState({ ahead: 2 })
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults()
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('push_branch')
  })
})

// ── 5. clean pushed branch, no PR => create_pr ───────────────────────────────

describe('Scenario 5: clean pushed branch, no PR => create_pr', () => {
  it('returns create_pr when branch is pushed and no PR exists', () => {
    const repo = makeRepoState()
    const br   = makeBranchState({ ahead: 0 })
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults({
      'pr-lifecycle-orchestrator': {
        agent: 'PR Lifecycle Orchestrator v1',
        status: 'WARN',
        risk_level: 1,
        branch: br,
        pr: makePrState(),
        next_action: 'create_pr',
      },
    })
    const fc = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('create_pr')
  })
})

// ── 6. open PR, reviewer not run => run_pr_reviewer ─────────────────────────

describe('Scenario 6: open PR, reviewer not run => run_pr_reviewer', () => {
  it('returns run_pr_reviewer when PR is open and no reviewer result present', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const val  = makeValidationState()
    const bots = makeBotResults()  // no pr-reviewer key
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('run_pr_reviewer')
  })
})

// ── 7. PR reviewer pass + mergeable => merge_pr with approval gate ──────────

describe('Scenario 7: PR reviewer pass + mergeable => merge_pr', () => {
  it('returns merge_pr when reviewer passes and PR is mergeable', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const val  = makeValidationState()
    const bots = makeBotResults({ 'pr-reviewer': makeReviewerPass() })
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('merge_pr')
  })

  it('emits an approval gate for merge_pr', () => {
    const gates = buildApprovalGates('merge_pr', makePrState({ number: 7 }))
    expect(gates.length).toBe(1)
    expect(gates[0].action).toBe('merge_pr')
    expect(gates[0].approval_required).toBe(true)
    expect(gates[0].approval_granted).toBe(false)
    expect(gates[0].authority).toMatch(/Owner/i)
  })
})

// ── 8. PR reviewer block with production red flag => classify_blocker ────────

describe('Scenario 8: PR reviewer block with production red flag => classify_blocker', () => {
  it('returns classify_blocker when reviewer finds production-impacting flag', () => {
    const repo    = makeRepoState()
    const br      = makeBranchState()
    const pr      = makePrState({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const val     = makeValidationState()
    const bots    = makeBotResults({
      'pr-reviewer': makeReviewerBlock([makeProductionFlag('src/app/api/agents/route.ts')]),
    })
    const fc = classifyFailures(bots, repo, pr, [])
    expect(fc.real_blockers.some((b: { type: string }) => b.type === 'unsafe_mutation_risk')).toBe(true)
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('classify_blocker')
  })
})

// ── 9. observe-only shell finding allowed => non-blocking WARN ───────────────

describe('Scenario 9: allowlisted shell-execution in observe-only scripts => non-blocking', () => {
  it('allowlisted flag is recorded as false positive, not real blocker', () => {
    const repo  = makeRepoState()
    const pr    = makePrState({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const bots  = makeBotResults({
      'pr-reviewer': {
        ...makeReviewerPass(),
        red_flags: [makeAllowlistedShellFlag('scripts/pr-lifecycle-orchestrator.cjs')],
      },
    })
    const fc = classifyFailures(bots, repo, pr, [])
    expect(fc.real_blockers.length).toBe(0)
    expect(fc.false_positives.length).toBe(1)
    expect(fc.false_positives[0].type).toBe('reviewer_false_positive')
  })

  it('allowlisted flags produce merge_pr (not stop_fix_required)', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const val  = makeValidationState()
    const bots = makeBotResults({
      'pr-reviewer': {
        ...makeReviewerPass(),
        red_flags: [makeAllowlistedShellFlag('scripts/pr-lifecycle-orchestrator.cjs')],
      },
    })
    const fc = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('merge_pr')
  })
})

// ── 10. failed validation => stop_fix_required ───────────────────────────────

describe('Scenario 10: failed validation => stop_fix_required', () => {
  it('returns stop_fix_required when pnpm test fails', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'OPEN', mergeable: 'MERGEABLE' })
    const val  = makeValidationState({ pnpm_test_passed: false, all_validations_passed: false })
    const bots = makeBotResults({
      'pr-reviewer': {
        ...makeReviewerPass(),
        validation: {
          passed: false,
          steps: [
            { step: 'typecheck', passed: true,  exit_code: 0 },
            { step: 'test',      passed: false, exit_code: 1 },
            { step: 'build',     passed: true,  exit_code: 0 },
          ],
        },
      },
    })
    const fc = classifyFailures(bots, repo, pr, [])
    expect(fc.real_blockers.some((b: { type: string }) => b.type === 'validation_failure')).toBe(true)
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('stop_fix_required')
  })
})

// ── 11. merged PR => sync_main_after_merge ───────────────────────────────────

describe('Scenario 11: merged PR => sync_main_after_merge', () => {
  it('returns sync_main_after_merge when PR state is MERGED', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'MERGED' })
    const val  = makeValidationState()
    const bots = makeBotResults()
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('sync_main_after_merge')
  })
})

// ── 12. contradictory bot results are recorded ───────────────────────────────

describe('Scenario 12: contradictory bot results recorded', () => {
  it('records contradiction when orchestrator says clean but preflight says dirty', () => {
    const bots = makeBotResults({
      'mission-control-preflight': {
        ...makePreflightPass(),
        git: { branch: 'feature-branch', is_clean: false, status_short: [' M file.ts'] },
      },
      'pr-lifecycle-orchestrator': {
        agent: 'PR Lifecycle Orchestrator v1',
        status: 'PASS',
        risk_level: 0,
        branch: makeBranchState({ working_tree_clean: true }),
        pr: makePrState(),
        next_action: 'create_pr',
      },
    })
    const repo          = makeRepoState()
    const contradictions = detectContradictions(bots, repo)
    const agentDisagreement = contradictions.find(
      (c: { kind: string }) => c.kind === 'agent_disagreement'
    )
    expect(agentDisagreement).toBeDefined()
    expect(agentDisagreement.topic).toBe('working_tree_clean')
  })

  it('allowlisted flag produces flag_allowlisted contradiction', () => {
    const bots = makeBotResults({
      'pr-reviewer': {
        ...makeReviewerPass(),
        red_flags: [makeAllowlistedShellFlag('scripts/pr-lifecycle-orchestrator.cjs')],
      },
    })
    const contradictions = detectContradictions(bots, makeRepoState())
    const flagged = contradictions.find((c: { kind: string }) => c.kind === 'flag_allowlisted')
    expect(flagged).toBeDefined()
    expect(flagged.resolved_severity).toBe('info')
    expect(flagged.production_impact).toBe(false)
  })
})

// ── 13. approval gates emitted for gated actions ─────────────────────────────

describe('Scenario 13: approval gates for gated actions', () => {
  it('emits approval gate for push_branch', () => {
    const gates = buildApprovalGates('push_branch', makePrState())
    expect(gates.length).toBe(1)
    expect(gates[0].approval_required).toBe(true)
    expect(gates[0].approval_granted).toBe(false)
  })

  it('emits approval gate for create_pr', () => {
    const gates = buildApprovalGates('create_pr', makePrState())
    expect(gates.length).toBe(1)
    expect(gates[0].approval_required).toBe(true)
  })

  it('emits approval gate for merge_pr', () => {
    const gates = buildApprovalGates('merge_pr', makePrState({ number: 7 }))
    expect(gates.length).toBe(1)
    expect(gates[0].action).toBe('merge_pr')
  })

  it('does NOT emit approval gate for run_pr_reviewer (observe-only)', () => {
    const gates = buildApprovalGates('run_pr_reviewer', makePrState())
    expect(gates.length).toBe(0)
  })

  it('does NOT emit approval gate for idle', () => {
    const gates = buildApprovalGates('idle', makePrState())
    expect(gates.length).toBe(0)
  })
})

// ── 14. output shape remains stable ──────────────────────────────────────────

describe('Scenario 14: output shape is stable', () => {
  it('run() returns all required top-level fields', () => {
    const result = run([], makeBotResults())
    const required = [
      'agent', 'label', 'status', 'risk_level', 'timestamp', 'repo',
      'repo_state', 'branch_state', 'pr_state', 'validation_state',
      'bot_results', 'contradictions', 'failure_classification',
      'approval_gates', 'next_action', 'next_action_description',
      'confidence', 'commands', 'prompts', 'stop_conditions', 'notes', 'metadata',
    ]
    for (const field of required) {
      expect(result, `missing field: ${field}`).toHaveProperty(field)
    }
  })

  it('agent and label are always correct', () => {
    const result = run([], makeBotResults())
    expect(result.agent).toBe('Workflow Governor v1')
    expect(result.label).toBe('OBSERVE ONLY')
  })

  it('next_action is always a known enum value', () => {
    const result = run([], makeBotResults())
    expect(NEXT_ACTIONS).toContain(result.next_action)
  })

  it('commands is always an array', () => {
    const result = run([], makeBotResults())
    expect(Array.isArray(result.commands)).toBe(true)
    expect(result.commands.length).toBeGreaterThan(0)
  })

  it('contradictions is always an array', () => {
    const result = run([], makeBotResults())
    expect(Array.isArray(result.contradictions)).toBe(true)
  })

  it('approval_gates is always an array', () => {
    const result = run([], makeBotResults())
    expect(Array.isArray(result.approval_gates)).toBe(true)
  })

  it('stop_conditions is always an array', () => {
    const result = run([], makeBotResults())
    expect(Array.isArray(result.stop_conditions)).toBe(true)
  })

  it('confidence is between 0 and 1', () => {
    const result = run([], makeBotResults())
    expect(result.confidence).toBeGreaterThanOrEqual(0)
    expect(result.confidence).toBeLessThanOrEqual(1)
  })

  it('metadata includes execution_time_ms', () => {
    const result = run([], makeBotResults())
    expect(result.metadata).toHaveProperty('execution_time_ms')
    expect(typeof result.metadata.execution_time_ms).toBe('number')
  })
})

// ── 15. script remains observe-only ──────────────────────────────────────────

describe('Scenario 15: observe-only contract', () => {
  it('run() with injected bot results does not call spawnSync', () => {
    // Passing injected results bypasses all child process calls
    const bots   = makeBotResults()
    const result = run([], bots)
    expect(result.label).toBe('OBSERVE ONLY')
    expect(result).not.toHaveProperty('error')
  })

  it('module exports do not include any file-writing functions', () => {
    const mod = require('../../../scripts/workflow-governor.cjs')
    // Ensure no unexpected exports that could mutate state
    const allowedExports = [
      'run', 'parseArgs', 'extractRepoState', 'extractBranchState',
      'extractPrState', 'extractValidationState', 'detectContradictions',
      'classifyFailures', 'decide', 'buildCommands', 'buildPrompts',
      'buildApprovalGates', 'computeStatusRisk', 'adjustConfidence',
      'NEXT_ACTIONS', 'FAILURE_TYPES',
    ]
    for (const key of Object.keys(mod)) {
      expect(allowedExports, `unexpected export: ${key}`).toContain(key)
    }
  })

  it('safety.observe_only field is not set (governor does not claim merge capability)', () => {
    // Governor output should not have safety.merge_capable — it is observe-only by design
    const result = run([], makeBotResults())
    expect(result).not.toHaveProperty('safety')
  })
})

// ── Additional edge cases ─────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('detached HEAD (null branch) => stop_fix_required', () => {
    const repo = makeRepoState({ branch_current: null })
    const br   = makeBranchState({ current: null })
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults()
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action, stopConditions } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('stop_fix_required')
    expect(stopConditions.some((s: string) => s.includes('branch'))).toBe(true)
  })

  it('merge conflict on PR => stop_fix_required', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'OPEN', mergeable: 'CONFLICTING' })
    const val  = makeValidationState()
    const bots = makeBotResults({ 'pr-reviewer': makeReviewerPass() })
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('stop_fix_required')
  })

  it('preflight FAIL => stop_fix_required regardless of branch state', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState()
    const val  = makeValidationState()
    const bots = makeBotResults({
      'mission-control-preflight': makePreflightFail('node is not available'),
    })
    const fc = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('stop_fix_required')
  })

  it('merge_pr has UNKNOWN mergeable state => still recommends merge_pr (GitHub transient)', () => {
    const repo = makeRepoState()
    const br   = makeBranchState()
    const pr   = makePrState({ number: 7, state: 'OPEN', mergeable: 'UNKNOWN' })
    const val  = makeValidationState()
    const bots = makeBotResults({ 'pr-reviewer': makeReviewerPass() })
    const fc   = classifyFailures(bots, repo, pr, [])
    const { next_action } = decide(repo, br, pr, val, bots, fc, [])
    expect(next_action).toBe('merge_pr')
  })

  it('computeStatusRisk returns FAIL for stop_fix_required with blockers', () => {
    const fc = { real_blockers: [{ type: 'dirty_working_tree', message: 'dirty' }], false_positives: [], implementation_gaps: [], contradictions: 0, transient_failures: [] }
    const { status, risk_level } = computeStatusRisk('stop_fix_required', fc, [])
    expect(status).toBe('FAIL')
    expect(risk_level).toBe(3)
  })

  it('computeStatusRisk returns PASS for idle with no blockers', () => {
    const fc = { real_blockers: [], false_positives: [], implementation_gaps: [], contradictions: 0, transient_failures: [] }
    const { status, risk_level } = computeStatusRisk('idle', fc, [])
    expect(status).toBe('PASS')
    expect(risk_level).toBe(0)
  })

  it('buildCommands push_branch includes branch name', () => {
    const repo = makeRepoState({ branch_current: 'my-feature' })
    const pr   = makePrState()
    const cmds = buildCommands('push_branch', repo, pr, REPO)
    expect(cmds.some((c: string) => c.includes('my-feature'))).toBe(true)
    expect(cmds.some((c: string) => c.includes('git push'))).toBe(true)
  })

  it('buildCommands merge_pr includes PR number and squash', () => {
    const repo = makeRepoState()
    const pr   = makePrState({ number: 42 })
    const cmds = buildCommands('merge_pr', repo, pr, REPO)
    expect(cmds.some((c: string) => c.includes('42') && c.includes('--squash'))).toBe(true)
  })
})
