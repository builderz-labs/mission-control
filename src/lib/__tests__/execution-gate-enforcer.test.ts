import { describe, it, expect, vi, afterEach } from 'vitest'
import { enforceExecutionGate } from '@/lib/enforcement/execution-gate-enforcer'
import * as controlInterface from '@/lib/control-interface'
import type { GateVerdict } from '@/lib/execution-gate'

const ALLOW_VERDICT: GateVerdict = {
  allowed: true,
  reason: 'All checks passed.',
  risk_level: 0,
  effective_risk_level: 0,
  decision_trace: {
    contract: 'N/A',
    argument_guard: 'N/A',
    coordination: 'ALLOW',
    risk_composition: 'ALLOW',
    session: 'N/A',
  },
}

const DENY_VERDICT: GateVerdict = {
  allowed: false,
  reason: 'Agent is in OBSERVE_ONLY mode.',
  risk_level: 1,
  effective_risk_level: 1,
  decision_trace: {
    contract: 'N/A',
    argument_guard: 'N/A',
    coordination: 'BLOCK',
    risk_composition: 'ALLOW',
    session: 'N/A',
  },
}

afterEach(() => { vi.restoreAllMocks() })

describe('enforceExecutionGate — fail-closed on malformed input', () => {
  it('fails closed when agentId is an empty string', () => {
    const result = enforceExecutionGate({ agentId: '' })
    expect(result.allowed).toBe(false)
    expect(result.verdict.allowed).toBe(false)
    expect(result.verdict.risk_level).toBe(3)
    expect(result.verdict.reason).toMatch(/missing or invalid/i)
  })

  it('fails closed when agentId is whitespace-only', () => {
    const result = enforceExecutionGate({ agentId: '   ' })
    expect(result.allowed).toBe(false)
    expect(result.verdict.risk_level).toBe(3)
  })

  it('returns a 403 NextResponse when agentId is invalid', () => {
    const result = enforceExecutionGate({ agentId: '' })
    if (result.allowed) throw new Error('expected denied')
    expect(result.response.status).toBe(403)
  })
})

describe('enforceExecutionGate — gate denial passes through', () => {
  it('returns allowed: false with a 403 response when gate denies', () => {
    vi.spyOn(controlInterface, 'evaluateControl').mockReturnValue(DENY_VERDICT)

    const result = enforceExecutionGate({ agentId: 'some-agent' })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.response.status).toBe(403)
    expect(result.verdict.allowed).toBe(false)
    expect(result.verdict.reason).toBe(DENY_VERDICT.reason)
  })

  it('blocked request cannot bypass gate — response is returned, not swallowed', async () => {
    vi.spyOn(controlInterface, 'evaluateControl').mockReturnValue(DENY_VERDICT)

    const result = enforceExecutionGate({ agentId: 'some-agent' })
    if (result.allowed) throw new Error('expected denied')

    const body = await result.response.json()
    expect(body.error).toMatch(/execution denied/i)
    expect(body.reason).toBe(DENY_VERDICT.reason)
    expect(body.gate).toBeDefined()
  })
})

describe('enforceExecutionGate — allowed request passes through', () => {
  it('returns allowed: true with verdict when gate passes', () => {
    vi.spyOn(controlInterface, 'evaluateControl').mockReturnValue(ALLOW_VERDICT)

    const result = enforceExecutionGate({ agentId: 'repo-steward' })
    expect(result.allowed).toBe(true)
    expect(result.verdict.allowed).toBe(true)
  })

  it('allowed result has no response property', () => {
    vi.spyOn(controlInterface, 'evaluateControl').mockReturnValue(ALLOW_VERDICT)

    const result = enforceExecutionGate({ agentId: 'repo-steward' })
    expect(result.allowed).toBe(true)
    if (!result.allowed) throw new Error('expected allowed')
    // TypeScript: 'response' should not exist on the allowed branch
    expect((result as any).response).toBeUndefined()
  })
})

describe('enforceExecutionGate — fail-closed on gate errors', () => {
  it('fails closed when evaluateControl throws', () => {
    vi.spyOn(controlInterface, 'evaluateControl').mockImplementation(() => {
      throw new Error('unexpected internal error')
    })

    const result = enforceExecutionGate({ agentId: 'repo-steward' })
    expect(result.allowed).toBe(false)
    expect(result.verdict.risk_level).toBe(3)
    expect(result.verdict.reason).toMatch(/internal error/i)
  })

  it('error result returns a 403 response', () => {
    vi.spyOn(controlInterface, 'evaluateControl').mockImplementation(() => {
      throw new Error('unexpected internal error')
    })

    const result = enforceExecutionGate({ agentId: 'repo-steward' })
    if (result.allowed) throw new Error('expected denied')
    expect(result.response.status).toBe(403)
  })
})

describe('enforceExecutionGate — real agent registry integration', () => {
  it('allows repo-steward (ACTIVE, OBSERVE_ONLY, no command)', () => {
    const result = enforceExecutionGate({ agentId: 'repo-steward' })
    expect(result.allowed).toBe(true)
  })

  it('blocks unknown agent — fail closed with risk_level 3', () => {
    const result = enforceExecutionGate({ agentId: 'nonexistent-agent-xyz' })
    expect(result.allowed).toBe(false)
    expect(result.verdict.risk_level).toBe(3)
  })

  it('blocks skill-intake without approval', () => {
    const result = enforceExecutionGate({ agentId: 'skill-intake' })
    expect(result.allowed).toBe(false)
    if (result.allowed) throw new Error('expected denied')
    expect(result.response.status).toBe(403)
  })

  it('allows skill-intake with explicit approval', () => {
    const result = enforceExecutionGate({ agentId: 'skill-intake', options: { approved: true } })
    expect(result.allowed).toBe(true)
  })
})
