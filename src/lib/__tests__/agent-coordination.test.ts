import { describe, expect, it } from 'vitest'
import {
  listCoordinatedAgents,
  validateAgentForExecution,
  createAgentHandoff,
  summarizeAgentState,
  findAgent,
  type CoordinatedAgent,
  type HandoffSummary,
} from '@/lib/agent-coordination'

function makeAgent(overrides: Partial<CoordinatedAgent> = {}): CoordinatedAgent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    status: 'ACTIVE',
    mode: 'EXECUTION_ALLOWED',
    owner: 'test',
    system_area: 'test',
    allowed_commands: ['echo'],
    blocked_commands: ['rm'],
    dependencies: [],
    last_run: null,
    risk_level: 0,
    handoff_summary: null,
    ...overrides,
  }
}

describe('listCoordinatedAgents', () => {
  it('returns an array', () => {
    expect(Array.isArray(listCoordinatedAgents())).toBe(true)
  })

  it('returns copies — mutations do not affect registry', () => {
    const [first] = listCoordinatedAgents()
    first.name = 'MUTATED'
    const [again] = listCoordinatedAgents()
    expect(again.name).not.toBe('MUTATED')
  })
})

describe('registry — derived from data/mission-control/agent-registry.json', () => {
  it('all returned agents have ACTIVE status (PLANNED agents are excluded)', () => {
    const agents = listCoordinatedAgents()
    for (const a of agents) {
      expect(a.status, `${a.id} should be ACTIVE in the coordination registry`).toBe('ACTIVE')
    }
  })

  it('includes the five expected ACTIVE agents', () => {
    const ids = listCoordinatedAgents().map(a => a.id)
    expect(ids).toContain('repo-steward')
    expect(ids).toContain('skill-intake')
    expect(ids).toContain('systems-curator')
    expect(ids).toContain('mc-coordinator')
    expect(ids).toContain('passive-income-bot')
  })

  it('PLANNED agents are not findable and cannot execute', () => {
    const planned = ['stocks-research-bot', 'sports-betting-bot', 'appliance-bot', 'builder-bot', 'research-scout', 'content-bot']
    for (const id of planned) {
      expect(findAgent(id), `${id} should not be in the coordination registry`).toBeUndefined()
    }
  })
})

describe('validateAgentForExecution — unregistered agent', () => {
  it('blocks an unknown agent (not in registry)', () => {
    const unknown = makeAgent({ id: 'does-not-exist' })
    const result = validateAgentForExecution(unknown)
    expect(result.outcome).toBe('BLOCKED')
    expect(result.reason).toMatch(/not in the coordination registry/i)
  })
})

describe('validateAgentForExecution — status gates', () => {
  it('blocks a PLANNED agent', () => {
    const agent = findAgent('repo-steward')!
    const planned = { ...agent, status: 'PLANNED' } as CoordinatedAgent
    // Force the id to exist in registry but override status for this test
    // We test the status gate using a registry agent with status overridden
    // (registry check passes because id is valid, status is evaluated next)
    const result = validateAgentForExecution({ ...planned })
    expect(result.outcome).toBe('BLOCKED')
    expect(result.reason).toMatch(/PLANNED/i)
  })

  it('blocks a DISABLED agent', () => {
    const agent = findAgent('repo-steward')!
    const result = validateAgentForExecution({ ...agent, status: 'DISABLED' })
    expect(result.outcome).toBe('BLOCKED')
    expect(result.reason).toMatch(/DISABLED/i)
  })
})

describe('validateAgentForExecution — OBSERVE_ONLY mode', () => {
  it('allows reporting (no command)', () => {
    const agent = findAgent('repo-steward')!
    const result = validateAgentForExecution(agent)
    expect(result.outcome).toBe('ALLOWED')
  })

  it('allows an explicitly listed allowed command', () => {
    const agent = findAgent('repo-steward')!
    const result = validateAgentForExecution(agent, { command: 'git status' })
    expect(result.outcome).toBe('ALLOWED')
  })

  it('blocks a command not in allowed_commands', () => {
    const agent = findAgent('repo-steward')!
    const result = validateAgentForExecution(agent, { command: 'pnpm build' })
    expect(result.outcome).toBe('BLOCKED')
    expect(result.reason).toMatch(/OBSERVE_ONLY/i)
  })
})

describe('validateAgentForExecution — APPROVAL_REQUIRED mode', () => {
  it('blocks without explicit approval flag', () => {
    const agent = findAgent('skill-intake')!
    const result = validateAgentForExecution(agent)
    expect(result.outcome).toBe('BLOCKED')
    expect(result.reason).toMatch(/approval/i)
  })

  it('allows with explicit approval flag', () => {
    const agent = findAgent('skill-intake')!
    // skill-intake depends on repo-steward which is ACTIVE — no missing deps
    const result = validateAgentForExecution(agent, { approved: true })
    expect(result.outcome).toBe('ALLOWED')
  })
})

describe('validateAgentForExecution — blocked_commands', () => {
  it('blocks a command in blocked_commands even when approved', () => {
    const agent = findAgent('repo-steward')!
    const result = validateAgentForExecution(agent, { command: 'git push', approved: true })
    expect(result.outcome).toBe('BLOCKED')
    expect(result.reason).toMatch(/blocked_commands/i)
  })

  it('blocked_commands win over allowed_commands on an EXECUTION_ALLOWED agent', () => {
    // Use a synthetic EXECUTION_ALLOWED agent whose blocked list overlaps allowed
    const agent: CoordinatedAgent = {
      id: 'mc-coordinator', // must be a real registry id
      name: 'MC Coordinator',
      status: 'ACTIVE',
      mode: 'EXECUTION_ALLOWED',
      owner: 'platform',
      system_area: 'coordination',
      allowed_commands: ['rm -rf /tmp/cache'],
      blocked_commands: ['rm'],
      dependencies: [],
      last_run: null,
      risk_level: 1,
      handoff_summary: null,
    }
    const result = validateAgentForExecution(agent, { command: 'rm -rf /tmp/cache' })
    expect(result.outcome).toBe('BLOCKED')
  })
})

describe('validateAgentForExecution — missing dependencies', () => {
  function agentWithMissingDep(mode: CoordinatedAgent['mode']): CoordinatedAgent {
    return {
      id: 'mc-coordinator',
      name: 'MC Coordinator',
      status: 'ACTIVE',
      mode,
      owner: 'platform',
      system_area: 'coordination',
      allowed_commands: [],
      blocked_commands: [],
      dependencies: ['repo-steward', 'nonexistent-dep'],
      last_run: null,
      risk_level: 1,
      handoff_summary: null,
    }
  }

  it('OBSERVE_ONLY: surfaces missing dep as WARN, does not block', () => {
    const agent = agentWithMissingDep('OBSERVE_ONLY')
    const result = validateAgentForExecution(agent)
    expect(result.outcome).toBe('WARN')
    expect(result.missing_dependencies).toContain('nonexistent-dep')
  })

  it('APPROVAL_REQUIRED: blocks even with approval when dep is missing', () => {
    const agent = agentWithMissingDep('APPROVAL_REQUIRED')
    const result = validateAgentForExecution(agent, { approved: true })
    expect(result.outcome).toBe('BLOCKED')
    expect(result.missing_dependencies).toContain('nonexistent-dep')
  })

  it('EXECUTION_ALLOWED: blocks when dep is missing and force is not set', () => {
    const agent = agentWithMissingDep('EXECUTION_ALLOWED')
    const result = validateAgentForExecution(agent)
    expect(result.outcome).toBe('BLOCKED')
    expect(result.missing_dependencies).toContain('nonexistent-dep')
    expect(result.reason).toMatch(/force/i)
  })

  it('EXECUTION_ALLOWED: allows (WARN) when dep is missing and force is true', () => {
    const agent = agentWithMissingDep('EXECUTION_ALLOWED')
    const result = validateAgentForExecution(agent, { force: true })
    expect(result.outcome).toBe('WARN')
    expect(result.missing_dependencies).toContain('nonexistent-dep')
  })
})

describe('createAgentHandoff', () => {
  it('returns a structured compact handoff', () => {
    const agent = findAgent('repo-steward')!
    const handoff: HandoffSummary = createAgentHandoff(agent, {
      decisions_made: ['Adopted vault structure'],
      uncertainty: ['Unknown merge window'],
      next_action: 'Review inbox items',
      evidence: ['vault/README.md created'],
      risk: 0,
    })
    expect(handoff.decisions_made).toEqual(['Adopted vault structure'])
    expect(handoff.uncertainty).toEqual(['Unknown merge window'])
    expect(handoff.next_action).toBe('Review inbox items')
    expect(handoff.evidence).toEqual(['vault/README.md created'])
    expect(handoff.risk).toBe(0)
  })

  it('fills in defaults when partial result is given', () => {
    const agent = findAgent('repo-steward')!
    const handoff = createAgentHandoff(agent, {})
    expect(Array.isArray(handoff.decisions_made)).toBe(true)
    expect(Array.isArray(handoff.uncertainty)).toBe(true)
    expect(typeof handoff.next_action).toBe('string')
    expect(handoff.risk).toBe(agent.risk_level)
  })
})

describe('summarizeAgentState', () => {
  it('returns PASS when all agents are ACTIVE with low risk', () => {
    const agents: CoordinatedAgent[] = [
      makeAgent({ id: 'repo-steward', status: 'ACTIVE', mode: 'OBSERVE_ONLY', risk_level: 0 }),
      makeAgent({ id: 'systems-curator', status: 'ACTIVE', mode: 'OBSERVE_ONLY', risk_level: 0 }),
    ]
    const summary = summarizeAgentState(agents)
    expect(summary.overall).toBe('PASS')
    expect(summary.total).toBe(2)
    expect(summary.active).toBe(2)
  })

  it('returns WARN when there are PLANNED agents or risk_level >= 2', () => {
    const agents: CoordinatedAgent[] = [
      makeAgent({ id: 'repo-steward', status: 'ACTIVE', risk_level: 0 }),
      makeAgent({ id: 'passive-income-bot', status: 'PLANNED', risk_level: 2 }),
    ]
    const summary = summarizeAgentState(agents)
    expect(summary.overall).toBe('WARN')
    expect(summary.planned).toBe(1)
  })

  it('returns FAIL when there are DISABLED agents', () => {
    const agents: CoordinatedAgent[] = [
      makeAgent({ id: 'repo-steward', status: 'ACTIVE', risk_level: 0 }),
      makeAgent({ id: 'systems-curator', status: 'DISABLED', risk_level: 0 }),
    ]
    const summary = summarizeAgentState(agents)
    expect(summary.overall).toBe('FAIL')
    expect(summary.disabled).toBe(1)
  })

  it('returns FAIL when highest_risk is 3', () => {
    const agents: CoordinatedAgent[] = [
      makeAgent({ id: 'repo-steward', status: 'ACTIVE', risk_level: 3 }),
    ]
    const summary = summarizeAgentState(agents)
    expect(summary.overall).toBe('FAIL')
    expect(summary.highest_risk).toBe(3)
  })

  it('counts modes correctly', () => {
    const agents: CoordinatedAgent[] = [
      makeAgent({ id: 'repo-steward', mode: 'OBSERVE_ONLY' }),
      makeAgent({ id: 'systems-curator', mode: 'OBSERVE_ONLY' }),
      makeAgent({ id: 'skill-intake', mode: 'APPROVAL_REQUIRED' }),
      makeAgent({ id: 'mc-coordinator', mode: 'EXECUTION_ALLOWED' }),
    ]
    const summary = summarizeAgentState(agents)
    expect(summary.observe_only).toBe(2)
    expect(summary.approval_required).toBe(1)
    expect(summary.execution_allowed).toBe(1)
  })
})
