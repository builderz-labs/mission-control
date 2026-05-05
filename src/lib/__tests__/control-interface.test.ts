import { describe, expect, it } from 'vitest'
import { evaluateControl } from '@/lib/control-interface'
import { checkExecutionGate } from '@/lib/execution-gate'
import { createSession, updateSession } from '@/lib/execution-session'

describe('evaluateControl', () => {
  it('returns the same verdict as checkExecutionGate', () => {
    const input = { agentId: 'repo-steward', command: 'git status' }

    expect(evaluateControl(input)).toEqual(checkExecutionGate(input))
  })

  it('supports session chaining through the interface', () => {
    let session = createSession()
    session = updateSession(session, { effective_risk_level: 1, command_risk_profile: 'medium' })
    session = updateSession(session, { effective_risk_level: 1, command_risk_profile: 'medium' })
    session = updateSession(session, { effective_risk_level: 1, command_risk_profile: 'medium' })

    const v1 = evaluateControl({ agentId: 'repo-steward', command: 'git status', session })
    expect(v1.session_risk_state).toBe('WARN')
    expect(v1.next_session_state?.total_risk).toBe(3)

    const v2 = evaluateControl({
      agentId: 'repo-steward',
      command: 'git diff',
      session: v1.next_session_state,
    })

    expect(v2.session_risk_state).toBe('WARN')
    expect(v2.next_session_state?.total_risk).toBe(3)
    expect(v2.next_session_state?.recent_commands).toContain('read')
  })
})
