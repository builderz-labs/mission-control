/**
 * Execution Gate v1 — pure decision layer, no side effects.
 *
 * Centralises all execution eligibility decisions. Never runs commands,
 * never mutates state, never makes network calls. Always returns a
 * structured verdict that callers must act on themselves.
 */

import {
  findAgent,
  validateAgentForExecution,
  type RiskLevel,
  type ValidateOptions,
} from '@/lib/agent-coordination'
import { validateCommand, listRegisteredCommands, type CommandIntent, type CommandRiskProfile } from '@/lib/command-contract'
import { updateSession, evaluateSessionRisk, type SessionState, type SessionRiskState } from '@/lib/execution-session'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionTrace {
  /** Was the command found in the command registry? */
  contract: 'PASS' | 'FAIL' | 'N/A'
  /** Did the command's arguments pass all guards? */
  argument_guard: 'PASS' | 'FAIL' | 'N/A'
  /** What did the agent coordination layer decide? */
  coordination: 'ALLOW' | 'BLOCK' | 'WARN'
  /** What did the risk composition stage decide? */
  risk_composition: 'ALLOW' | 'BLOCK' | 'ESCALATE'
  /** What is the cumulative session risk state? */
  session: 'SAFE' | 'WARN' | 'ESCALATE' | 'N/A'
}

export interface GateInput {
  agentId: string
  command?: string
  options?: ValidateOptions
  /** Pass a session to receive cumulative session risk evaluation in the verdict. */
  session?: SessionState
}

export interface GateVerdict {
  allowed: boolean
  reason: string
  /** Structured per-stage decision trace. */
  decision_trace: DecisionTrace
  /** Agent's own risk_level from the coordination registry. */
  risk_level: RiskLevel
  /** max(agent.risk_level, command_risk_numeric) — the composed safety ceiling. */
  effective_risk_level: RiskLevel
  /** Semantic intent of the command, when a command was provided and passed contract validation. */
  command_intent?: CommandIntent
  /** Risk profile of the command from the contract registry. */
  command_risk_profile?: CommandRiskProfile
  /** Session risk state after including this verdict. Present only when a session was provided. */
  session_risk_state?: SessionRiskState
  /** Updated session state after this verdict — pass to the next gate call to chain sessions. */
  next_session_state?: SessionState
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export function checkExecutionGate(input: GateInput): GateVerdict {
  const hasCommand = input.command !== undefined

  // Trace stages — updated in place as each layer evaluates.
  let contractStage: DecisionTrace['contract'] = hasCommand ? 'PASS' : 'N/A'
  let argGuardStage: DecisionTrace['argument_guard'] = hasCommand ? 'PASS' : 'N/A'
  let coordinationStage: DecisionTrace['coordination'] = 'BLOCK'
  let riskCompositionStage: DecisionTrace['risk_composition'] = 'BLOCK'
  let sessionStage: DecisionTrace['session'] = 'N/A'

  const buildTrace = (): DecisionTrace => ({
    contract: contractStage,
    argument_guard: argGuardStage,
    coordination: coordinationStage,
    risk_composition: riskCompositionStage,
    session: sessionStage,
  })

  const agent = findAgent(input.agentId)
  if (!agent) {
    return {
      allowed: false,
      reason: `Unknown agent "${input.agentId}" — not in coordination registry.`,
      risk_level: 3,
      effective_risk_level: 3,
      decision_trace: buildTrace(),
    }
  }

  // --- Stage 1: Contract + argument guard ---
  let command_intent: CommandIntent | undefined
  let command_risk_profile: CommandRiskProfile | undefined
  if (hasCommand) {
    const command = input.command!
    const cmd = command.trim()
    const isKnown = listRegisteredCommands().some(
      base => cmd === base || cmd.startsWith(base + ' '),
    )
    const cmdValidation = validateCommand(command)
    if (!cmdValidation.valid) {
      contractStage = isKnown ? 'PASS' : 'FAIL'
      argGuardStage = 'FAIL'
      return {
        allowed: false,
        reason: cmdValidation.reason,
        risk_level: agent.risk_level,
        effective_risk_level: agent.risk_level,
        decision_trace: buildTrace(),
      }
    }
    command_intent = cmdValidation.command?.intent
    command_risk_profile = cmdValidation.command?.risk_profile
  }

  // --- Stage 2: Risk composition ---
  const cmdRiskNum: RiskLevel =
    command_risk_profile === 'high' ? 2 :
    command_risk_profile === 'medium' ? 1 : 0
  const effective_risk_level = Math.max(agent.risk_level, cmdRiskNum) as RiskLevel
  const cmdLabel = command_risk_profile ?? 'none'

  riskCompositionStage =
    effective_risk_level >= 3 ? 'BLOCK' :
    effective_risk_level === 2 ? 'ESCALATE' : 'ALLOW'

  if (effective_risk_level >= 3) {
    return {
      allowed: false,
      reason: `Blocked: effective_risk_level ${effective_risk_level} exceeds maximum threshold (agent: ${agent.risk_level}, command: ${cmdLabel}).`,
      risk_level: agent.risk_level,
      effective_risk_level,
      command_intent,
      command_risk_profile,
      decision_trace: buildTrace(),
    }
  }

  if (effective_risk_level === 2 && !input.options?.approved) {
    return {
      allowed: false,
      reason: `Blocked: effective_risk_level ${effective_risk_level} requires explicit approval (agent: ${agent.risk_level}, command: ${cmdLabel}).`,
      risk_level: agent.risk_level,
      effective_risk_level,
      command_intent,
      command_risk_profile,
      decision_trace: buildTrace(),
    }
  }

  // --- Stage 3: Coordination ---
  const result = validateAgentForExecution(agent, {
    ...input.options,
    command: input.command,
  })

  coordinationStage =
    result.outcome === 'ALLOWED' ? 'ALLOW' :
    result.outcome === 'WARN' ? 'WARN' : 'BLOCK'

  let allowed: boolean
  let reason = result.reason

  if (result.outcome === 'ALLOWED') {
    allowed = true
  } else if (result.outcome === 'BLOCKED') {
    allowed = false
  } else {
    // WARN: allow only when effective_risk is below the high-risk threshold.
    if (effective_risk_level >= 3) {
      allowed = false
      reason = `${result.reason} Blocked: effective_risk_level ${effective_risk_level} is too high to proceed on a WARN.`
    } else {
      allowed = true
    }
  }

  // --- Stage 4: Session ---
  let session_risk_state: SessionRiskState | undefined
  let next_session_state: SessionState | undefined
  if (input.session) {
    next_session_state = updateSession(input.session, { effective_risk_level, command_intent, command_risk_profile })
    session_risk_state = evaluateSessionRisk(next_session_state).state
    sessionStage = session_risk_state
  }

  return {
    allowed,
    reason,
    risk_level: agent.risk_level,
    effective_risk_level,
    command_intent,
    command_risk_profile,
    session_risk_state,
    next_session_state,
    decision_trace: buildTrace(),
  }
}
