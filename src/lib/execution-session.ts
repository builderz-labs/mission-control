/**
 * INTERNAL MODULE
 * Do NOT import directly.
 * Use evaluateControl() from control-interface.ts instead.
 *
 * Execution Session v1 — in-memory session risk accumulation.
 *
 * Tracks cumulative risk across a sequence of gate verdicts and signals
 * when a session has accumulated enough risk to warrant escalation.
 * No persistence, no side effects, no networking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionRiskState = 'SAFE' | 'WARN' | 'ESCALATE'

export interface SessionState {
  total_risk: number
  recent_commands: string[]
  /** Count of consecutive commands with risk_profile 'high'. Resets on any non-high command. */
  consecutive_high_risk: number
}

/** Plain subset of a gate verdict — defined here to avoid a circular import. */
export interface SessionUpdateInput {
  effective_risk_level: number
  command_intent?: string
  command_risk_profile?: string
}

export interface SessionEvaluation {
  state: SessionRiskState
  total_risk: number
  reason: string
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const WARN_THRESHOLD = 3
const ESCALATE_THRESHOLD = 5

/** When consecutive_high_risk reaches this count, fast-escalation thresholds apply. */
const FAST_ESCALATE_STREAK = 2
const FAST_WARN_THRESHOLD = 2
const FAST_ESCALATE_THRESHOLD = 3

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function createSession(): SessionState {
  return { total_risk: 0, recent_commands: [], consecutive_high_risk: 0 }
}

/**
 * Returns a new SessionState updated with the results of one gate verdict.
 * Does not mutate the input session.
 */
export function updateSession(session: SessionState, input: SessionUpdateInput): SessionState {
  const label = input.command_intent ?? 'no-command'
  const isHigh = input.command_risk_profile === 'high'

  return {
    total_risk: session.total_risk + input.effective_risk_level,
    recent_commands: [...session.recent_commands, label].slice(-10),
    consecutive_high_risk: isHigh ? session.consecutive_high_risk + 1 : 0,
  }
}

/** Evaluates the accumulated session risk and returns a classification. */
export function evaluateSessionRisk(session: SessionState): SessionEvaluation {
  const { total_risk, consecutive_high_risk } = session

  const isFastMode = consecutive_high_risk >= FAST_ESCALATE_STREAK
  const warnAt = isFastMode ? FAST_WARN_THRESHOLD : WARN_THRESHOLD
  const escalateAt = isFastMode ? FAST_ESCALATE_THRESHOLD : ESCALATE_THRESHOLD

  if (total_risk >= escalateAt) {
    const fastNote = isFastMode
      ? ` (fast escalation: ${consecutive_high_risk} consecutive high-risk commands)`
      : ''
    return {
      state: 'ESCALATE',
      total_risk,
      reason: `Session risk escalated: total_risk=${total_risk} >= ${escalateAt}${fastNote}.`,
    }
  }

  if (total_risk >= warnAt) {
    return {
      state: 'WARN',
      total_risk,
      reason: `Session risk warning: total_risk=${total_risk} >= ${warnAt}.`,
    }
  }

  return {
    state: 'SAFE',
    total_risk,
    reason: `Session risk is safe: total_risk=${total_risk}.`,
  }
}
