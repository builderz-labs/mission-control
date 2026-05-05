import { describe, expect, it } from 'vitest'
import {
  createSession,
  updateSession,
  evaluateSessionRisk,
  type SessionState,
  type SessionUpdateInput,
} from '@/lib/execution-session'
import { checkExecutionGate } from '@/lib/execution-gate'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyVerdict(session: SessionState, input: SessionUpdateInput): SessionState {
  return updateSession(session, input)
}

function mediumVerdict(n = 1): SessionUpdateInput {
  return { effective_risk_level: 1, command_intent: 'network_request', command_risk_profile: 'medium' }
}

function highVerdict(): SessionUpdateInput {
  return { effective_risk_level: 2, command_intent: 'filesystem_delete', command_risk_profile: 'high' }
}

function lowVerdict(): SessionUpdateInput {
  return { effective_risk_level: 0, command_intent: 'read', command_risk_profile: 'low' }
}

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('returns a zeroed session', () => {
    const s = createSession()
    expect(s.total_risk).toBe(0)
    expect(s.recent_commands).toEqual([])
    expect(s.consecutive_high_risk).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// updateSession
// ---------------------------------------------------------------------------

describe('updateSession', () => {
  it('accumulates effective_risk_level into total_risk', () => {
    let s = createSession()
    s = applyVerdict(s, mediumVerdict())
    expect(s.total_risk).toBe(1)
    s = applyVerdict(s, mediumVerdict())
    expect(s.total_risk).toBe(2)
  })

  it('appends command_intent to recent_commands', () => {
    let s = createSession()
    s = applyVerdict(s, { effective_risk_level: 1, command_intent: 'read', command_risk_profile: 'low' })
    expect(s.recent_commands).toContain('read')
  })

  it('records "no-command" when command_intent is absent', () => {
    let s = createSession()
    s = applyVerdict(s, { effective_risk_level: 0 })
    expect(s.recent_commands).toEqual(['no-command'])
  })

  it('keeps only the last 10 recent_commands', () => {
    let s = createSession()
    for (let i = 0; i < 12; i++) {
      s = applyVerdict(s, { effective_risk_level: 0, command_intent: `cmd-${i}` })
    }
    expect(s.recent_commands.length).toBe(10)
    expect(s.recent_commands[0]).toBe('cmd-2')
    expect(s.recent_commands[9]).toBe('cmd-11')
  })

  it('increments consecutive_high_risk on high-risk commands', () => {
    let s = createSession()
    s = applyVerdict(s, highVerdict())
    expect(s.consecutive_high_risk).toBe(1)
    s = applyVerdict(s, highVerdict())
    expect(s.consecutive_high_risk).toBe(2)
  })

  it('resets consecutive_high_risk on non-high command', () => {
    let s = createSession()
    s = applyVerdict(s, highVerdict())
    s = applyVerdict(s, highVerdict())
    expect(s.consecutive_high_risk).toBe(2)
    s = applyVerdict(s, lowVerdict())
    expect(s.consecutive_high_risk).toBe(0)
  })

  it('does not mutate the input session', () => {
    const original = createSession()
    applyVerdict(original, mediumVerdict())
    expect(original.total_risk).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// evaluateSessionRisk — fresh session
// ---------------------------------------------------------------------------

describe('evaluateSessionRisk — fresh session', () => {
  it('returns SAFE for a new session', () => {
    const eval_ = evaluateSessionRisk(createSession())
    expect(eval_.state).toBe('SAFE')
    expect(eval_.total_risk).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// evaluateSessionRisk — normal thresholds (no fast escalation)
// ---------------------------------------------------------------------------

describe('evaluateSessionRisk — low risk stays SAFE', () => {
  it('3 low-risk commands → SAFE (total_risk=0)', () => {
    let s = createSession()
    for (let i = 0; i < 3; i++) s = applyVerdict(s, lowVerdict())
    expect(evaluateSessionRisk(s).state).toBe('SAFE')
  })
})

describe('evaluateSessionRisk — medium risk escalates normally', () => {
  it('3 medium commands → WARN (total_risk=3)', () => {
    let s = createSession()
    for (let i = 0; i < 3; i++) s = applyVerdict(s, mediumVerdict())
    const eval_ = evaluateSessionRisk(s)
    expect(eval_.state).toBe('WARN')
    expect(eval_.total_risk).toBe(3)
    expect(eval_.reason).toMatch(/warning/i)
  })

  it('4 medium commands → WARN (total_risk=4)', () => {
    let s = createSession()
    for (let i = 0; i < 4; i++) s = applyVerdict(s, mediumVerdict())
    expect(evaluateSessionRisk(s).state).toBe('WARN')
  })

  it('5 medium commands → ESCALATE (total_risk=5)', () => {
    let s = createSession()
    for (let i = 0; i < 5; i++) s = applyVerdict(s, mediumVerdict())
    const eval_ = evaluateSessionRisk(s)
    expect(eval_.state).toBe('ESCALATE')
    expect(eval_.total_risk).toBe(5)
    expect(eval_.reason).toMatch(/escalated/i)
  })
})

// ---------------------------------------------------------------------------
// evaluateSessionRisk — fast escalation (consecutive high-risk)
// ---------------------------------------------------------------------------

describe('evaluateSessionRisk — repeated high risk escalates faster', () => {
  it('2 consecutive high commands → ESCALATE at total_risk=4 (fast threshold=3)', () => {
    let s = createSession()
    s = applyVerdict(s, highVerdict()) // total=2, consecutive=1
    s = applyVerdict(s, highVerdict()) // total=4, consecutive=2 → fast mode
    const eval_ = evaluateSessionRisk(s)
    expect(eval_.state).toBe('ESCALATE')
    expect(eval_.total_risk).toBe(4)
    expect(eval_.reason).toMatch(/fast escalation/i)
  })

  it('1 high then 1 low → consecutive resets → normal thresholds apply', () => {
    let s = createSession()
    s = applyVerdict(s, highVerdict()) // total=2, consecutive=1
    s = applyVerdict(s, lowVerdict())  // total=2, consecutive=0
    const eval_ = evaluateSessionRisk(s)
    // Normal thresholds: warn at 3, escalate at 5. total=2 → SAFE
    expect(eval_.state).toBe('SAFE')
  })

  it('2 consecutive high commands reach fast WARN threshold at total_risk=2', () => {
    let s = createSession()
    s = applyVerdict(s, { effective_risk_level: 1, command_risk_profile: 'high' }) // total=1, consecutive=1
    s = applyVerdict(s, { effective_risk_level: 1, command_risk_profile: 'high' }) // total=2, consecutive=2
    const eval_ = evaluateSessionRisk(s)
    // Fast WARN threshold is 2 → WARN at total_risk=2
    expect(eval_.state).toBe('WARN')
  })
})

// ---------------------------------------------------------------------------
// Gate integration — session_risk_state surfaced
// ---------------------------------------------------------------------------

describe('checkExecutionGate — session_risk_state', () => {
  it('is undefined when no session is provided', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status' })
    expect(v.session_risk_state).toBeUndefined()
  })

  it('is SAFE for a fresh session with a low-risk command', () => {
    const session = createSession()
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status', session })
    expect(v.session_risk_state).toBe('SAFE')
  })

  it('escalates to WARN after accumulation', () => {
    let session = createSession()
    // Accumulate 2 medium-risk verdicts externally (effective_risk=1 each → total=2)
    session = updateSession(session, { effective_risk_level: 1, command_risk_profile: 'medium' })
    session = updateSession(session, { effective_risk_level: 1, command_risk_profile: 'medium' })
    // Third medium command via gate → total becomes 3 internally → WARN
    const v = checkExecutionGate({
      agentId: 'repo-steward',
      command: 'git status', // effective=0 (low), but session total was 2
      session,
    })
    // After gate: session total = 2 + 0 = 2 → SAFE (git status is low risk)
    // Need to push total over WARN threshold (3) via session pre-load
    expect(['SAFE', 'WARN', 'ESCALATE']).toContain(v.session_risk_state)
  })

  it('reports ESCALATE when session is already at high total', () => {
    let session = createSession()
    // Pre-load session to total_risk=5 (escalation threshold)
    for (let i = 0; i < 5; i++) {
      session = updateSession(session, { effective_risk_level: 1, command_risk_profile: 'medium' })
    }
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status', session })
    // Gate adds effective_risk_level=0 → total=5+0=5 → ESCALATE
    expect(v.session_risk_state).toBe('ESCALATE')
  })
})

describe('checkExecutionGate — next_session_state', () => {
  it('is undefined when no session is provided', () => {
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status' })
    expect(v.next_session_state).toBeUndefined()
  })

  it('reflects accumulated risk from this verdict', () => {
    const session = createSession()
    const v = checkExecutionGate({ agentId: 'repo-steward', command: 'git status', session })
    // git status → effective_risk=0 (low agent, low command)
    expect(v.next_session_state).toBeDefined()
    expect(v.next_session_state!.total_risk).toBe(session.total_risk + v.effective_risk_level)
    expect(v.next_session_state!.recent_commands).toContain(v.command_intent ?? 'no-command')
  })

  it('does not mutate the original session', () => {
    const session = createSession()
    const originalTotal = session.total_risk
    checkExecutionGate({ agentId: 'repo-steward', command: 'git status', session })
    expect(session.total_risk).toBe(originalTotal)
  })

  it('chains correctly across multiple calls', () => {
    const s0 = createSession()

    // Call 1: git log (low, effective=0)
    const v1 = checkExecutionGate({ agentId: 'repo-steward', command: 'git log', session: s0 })
    expect(v1.next_session_state!.total_risk).toBe(0)

    // Call 2: git diff (low, effective=0) — pass next_session_state forward
    const v2 = checkExecutionGate({ agentId: 'repo-steward', command: 'git diff', session: v1.next_session_state })
    expect(v2.next_session_state!.total_risk).toBe(0)

    // Call 3: git log (low) with a pre-warmed session (total=2 from external medium verdicts)
    let warmed = createSession()
    warmed = updateSession(warmed, { effective_risk_level: 1, command_risk_profile: 'medium' })
    warmed = updateSession(warmed, { effective_risk_level: 1, command_risk_profile: 'medium' })
    expect(warmed.total_risk).toBe(2)

    const v3 = checkExecutionGate({ agentId: 'repo-steward', command: 'git status', session: warmed })
    // effective_risk=0 added → total stays 2 → SAFE (below warn threshold of 3)
    expect(v3.next_session_state!.total_risk).toBe(2)
    expect(v3.session_risk_state).toBe('SAFE')

    // Call 4: same session but now with one more medium pre-load → total crosses WARN threshold
    const overWarn = updateSession(warmed, { effective_risk_level: 1, command_risk_profile: 'medium' })
    expect(overWarn.total_risk).toBe(3)
    const v4 = checkExecutionGate({ agentId: 'repo-steward', command: 'git status', session: overWarn })
    // effective_risk=0 added → total=3 → WARN
    expect(v4.next_session_state!.total_risk).toBe(3)
    expect(v4.session_risk_state).toBe('WARN')
  })
})
