/**
 * Execution Gate Enforcer
 *
 * Structural wrapper around evaluateControl() for use in API route handlers.
 * Callers get a ready-to-return NextResponse on denial so enforcement is
 * one line: `if (!gate.allowed) return gate.response`
 *
 * Fail-closed: any missing/malformed input returns denied, not allowed.
 * Never duplicates gate logic — delegates entirely to evaluateControl().
 */

import { NextResponse } from 'next/server'
import { evaluateControl } from '@/lib/control-interface'
import type { GateVerdict } from '@/lib/execution-gate'
import type { SessionState } from '@/lib/execution-session'
import type { ValidateOptions } from '@/lib/agent-coordination'

export interface GateEnforcerInput {
  agentId: string
  command?: string
  options?: ValidateOptions
  session?: SessionState
}

export type GateEnforcerResult =
  | { allowed: true; verdict: GateVerdict }
  | { allowed: false; verdict: GateVerdict; response: NextResponse }

const CLOSED_TRACE: GateVerdict['decision_trace'] = {
  contract: 'N/A',
  argument_guard: 'N/A',
  coordination: 'BLOCK',
  risk_composition: 'BLOCK',
  session: 'N/A',
}

function denyWith(reason: string, verdict: GateVerdict): GateEnforcerResult {
  return {
    allowed: false,
    verdict,
    response: NextResponse.json(
      { error: 'Execution denied by execution gate.', reason, gate: verdict },
      { status: 403 },
    ),
  }
}

/**
 * Enforce the execution gate for a known agent.
 *
 * Returns `{ allowed: true, verdict }` when the gate passes.
 * Returns `{ allowed: false, verdict, response }` on denial — return `gate.response` directly.
 *
 * Fail-closed: missing or invalid agentId always returns denied.
 * Unexpected gate errors also fail closed.
 */
export function enforceExecutionGate(input: GateEnforcerInput): GateEnforcerResult {
  if (!input.agentId || typeof input.agentId !== 'string' || !input.agentId.trim()) {
    const verdict: GateVerdict = {
      allowed: false,
      reason: 'Execution gate: missing or invalid agentId — fail closed.',
      risk_level: 3,
      effective_risk_level: 3,
      decision_trace: CLOSED_TRACE,
    }
    return denyWith(verdict.reason, verdict)
  }

  let verdict: GateVerdict
  try {
    verdict = evaluateControl({
      agentId: input.agentId,
      command: input.command,
      options: input.options,
      session: input.session,
    })
  } catch {
    const errVerdict: GateVerdict = {
      allowed: false,
      reason: 'Execution gate: internal error during evaluation — fail closed.',
      risk_level: 3,
      effective_risk_level: 3,
      decision_trace: CLOSED_TRACE,
    }
    return denyWith(errVerdict.reason, errVerdict)
  }

  if (!verdict.allowed) {
    return denyWith(verdict.reason, verdict)
  }

  return { allowed: true, verdict }
}
