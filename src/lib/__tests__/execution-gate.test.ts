import { describe, expect, it, vi, afterEach } from 'vitest'
import { checkExecutionGate } from '@/lib/execution-gate'
import * as coordination from '@/lib/agent-coordination'

describe('checkExecutionGate — unknown agent', () => {
  it('blocks and sets risk_level 3 for an unknown agent id', () => {
    const v = checkExecutionGate({ agentId: 'does-not-exist' })
    expect(v.allowed).toBe(false)
    expect(v.risk_level).toBe(3)
    expect(v.reason).toMatch(/unknown agent/i)
  })
})

describe('checkExecutionGate — status gates', () => {
  it('blocks repo-steward from git push via blocked_commands', () => {
    // 'git push' is in the registry but in repo-steward's blocked_commands
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git push' })
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/blocked_commands/i)
  })

  it('blocks a truly unknown command at the contract layer', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'python3 script.py' })
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/command registry/i)
  })

  it('allows repo-steward to report (no command)', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward' })
    expect(v.allowed).toBe(true)
    expect(v.decision_trace.contract).toBe('N/A')
    expect(v.decision_trace.argument_guard).toBe('N/A')
  })

  it('allows repo-steward to run an allowed command', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status' })
    expect(v.allowed).toBe(true)
  })
})

describe('checkExecutionGate — approval gate', () => {
  it('blocks skill-intake without approval', () => {
    const v = checkExecutionGate({ agentId: 'skill-intake' })
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/approval/i)
  })

  it('allows skill-intake with explicit approval', () => {
    const v = checkExecutionGate({ agentId: 'skill-intake', options: { approved: true } })
    expect(v.allowed).toBe(true)
  })
})

describe('checkExecutionGate — blocked_commands enforcement', () => {
  it('blocks passive-income-bot from running curl via blocked_commands', () => {
    // 'curl' is in the registry but in passive-income-bot's blocked_commands
    const v = checkExecutionGate({
      agentId: 'passive-income-bot',
      command: 'curl https://example.com',
      options: { approved: true },
    })
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/blocked_commands/i)
  })
})

describe('checkExecutionGate — risk_level surfaced', () => {
  it('returns the agent risk_level in every verdict', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward' })
    expect(typeof v.risk_level).toBe('number')
    expect([0, 1, 2, 3]).toContain(v.risk_level)
  })

  it('returns risk_level 0 for repo-steward', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward' })
    expect(v.risk_level).toBe(0)
  })

  it('returns risk_level 2 for passive-income-bot', () => {
    const v = checkExecutionGate({ agentId: 'passive-income-bot' })
    expect(v.risk_level).toBe(2)
  })
})

describe('checkExecutionGate — command_intent and command_risk_profile', () => {
  it('surfaces intent and risk_profile for a valid allowed command', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status' })
    expect(v.allowed).toBe(true)
    expect(v.command_intent).toBe('read')
    expect(v.command_risk_profile).toBe('low')
  })

  it('does not set intent or risk_profile when no command is given', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward' })
    expect(v.command_intent).toBeUndefined()
    expect(v.command_risk_profile).toBeUndefined()
  })

  it('does not set intent or risk_profile when command fails contract validation', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'python3 script.py' })
    expect(v.allowed).toBe(false)
    expect(v.command_intent).toBeUndefined()
    expect(v.command_risk_profile).toBeUndefined()
  })
})

describe('checkExecutionGate — never executes', () => {
  it('returns a plain object with no side effects (smoke)', () => {
    const v = checkExecutionGate({ agentId: 'systems-curator' })
    expect(v).toHaveProperty('allowed')
    expect(v).toHaveProperty('reason')
    expect(v).toHaveProperty('risk_level')
  })
})

describe('checkExecutionGate — WARN + risk_level gate', () => {
  afterEach(() => { vi.restoreAllMocks() })

  function mockWarnWithRisk(risk: coordination.RiskLevel) {
    vi.spyOn(coordination, 'findAgent').mockReturnValue({
      id: 'mc-coordinator',
      name: 'MC Coordinator',
      status: 'ACTIVE',
      mode: 'EXECUTION_ALLOWED',
      owner: 'platform',
      system_area: 'coordination',
      allowed_commands: [],
      blocked_commands: [],
      dependencies: ['nonexistent-dep'],
      last_run: null,
      risk_level: risk,
      handoff_summary: null,
    })
  }

  it('WARN + risk_level 0 → allowed true', () => {
    mockWarnWithRisk(0)
    const v = checkExecutionGate({ agentId: 'mc-coordinator', options: { force: true } })
    expect(v.allowed).toBe(true)
    expect(v.risk_level).toBe(0)
  })

  it('WARN + risk_level 1 → allowed true', () => {
    mockWarnWithRisk(1)
    const v = checkExecutionGate({ agentId: 'mc-coordinator', options: { force: true } })
    expect(v.allowed).toBe(true)
    expect(v.risk_level).toBe(1)
  })

  it('WARN + risk_level 2 + approved → allowed true', () => {
    mockWarnWithRisk(2)
    // effective_risk=2 requires approval; force alone is not enough
    const v = checkExecutionGate({ agentId: 'mc-coordinator', options: { force: true, approved: true } })
    expect(v.allowed).toBe(true)
    expect(v.risk_level).toBe(2)
  })

  it('WARN + risk_level 3 → allowed false, reason mentions risk_level', () => {
    mockWarnWithRisk(3)
    const v = checkExecutionGate({ agentId: 'mc-coordinator', options: { force: true } })
    expect(v.allowed).toBe(false)
    expect(v.risk_level).toBe(3)
    expect(v.reason).toMatch(/risk_level 3/i)
  })
})

describe('checkExecutionGate — risk composition', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('low agent + low command → effective_risk=0 → allowed', () => {
    // repo-steward (risk 0) + git status (low)
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status' })
    expect(v.effective_risk_level).toBe(0)
    expect(v.allowed).toBe(true)
  })

  it('low agent + high command → effective_risk=2 → blocked without approval', () => {
    // repo-steward (risk 0) + rm (high → 2) → effective = max(0,2) = 2
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'rm -rf /tmp/cache' })
    expect(v.effective_risk_level).toBe(2)
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/effective_risk_level 2/i)
    expect(v.command_risk_profile).toBe('high')
  })

  it('low agent + high command + approved → passes risk gate', () => {
    // effective_risk=2 with approval passes the composition gate;
    // coordination then blocks because OBSERVE_ONLY cannot run rm
    const v = checkExecutionGate({
      agentId: 'repo-steward',
      command: 'rm -rf /tmp/cache',
      options: { approved: true },
    })
    expect(v.effective_risk_level).toBe(2)
    // coordination blocks (OBSERVE_ONLY + rm not in allowed_commands), not risk gate
    expect(v.allowed).toBe(false)
    expect(v.reason).not.toMatch(/effective_risk_level/i)
  })

  it('agent risk=1 + high command → effective_risk=2 → blocked without approval', () => {
    // skill-intake (risk 1) + rm (high → 2) → effective = max(1,2) = 2
    const v = checkExecutionGate({ agentId: 'skill-intake', command: 'rm -rf /tmp/cache' })
    expect(v.effective_risk_level).toBe(2)
    expect(v.risk_level).toBe(1)
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/effective_risk_level 2/i)
  })

  it('agent risk=2 + medium command → effective_risk=2 → blocked without approval', () => {
    // passive-income-bot (risk 2) + git log (low → 0) → effective = max(2,0) = 2
    const v = checkExecutionGate({ agentId: 'passive-income-bot', command: 'git log' })
    expect(v.effective_risk_level).toBe(2)
    expect(v.risk_level).toBe(2)
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/effective_risk_level 2/i)
  })

  it('effective_risk >= 3 blocks even when coordination would allow', () => {
    vi.spyOn(coordination, 'findAgent').mockReturnValue({
      id: 'mc-coordinator',
      name: 'MC Coordinator',
      status: 'ACTIVE',
      mode: 'EXECUTION_ALLOWED',
      owner: 'platform',
      system_area: 'coordination',
      allowed_commands: [],
      blocked_commands: [],
      dependencies: [],
      last_run: null,
      risk_level: 3,
      handoff_summary: null,
    })
    // coordination would ALLOW (EXECUTION_ALLOWED, no deps, no blocked_commands)
    // but effective_risk = max(3, 0) = 3 → force BLOCK
    const v = checkExecutionGate({ agentId: 'mc-coordinator', command: 'git log', options: { approved: true } })
    expect(v.effective_risk_level).toBe(3)
    expect(v.allowed).toBe(false)
    expect(v.reason).toMatch(/effective_risk_level 3/i)
  })

  it('effective_risk_level is always present in the verdict', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward' })
    expect(typeof v.effective_risk_level).toBe('number')
    expect([0, 1, 2, 3]).toContain(v.effective_risk_level)
  })
})
