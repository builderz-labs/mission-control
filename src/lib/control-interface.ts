import type { ValidateOptions } from '@/lib/agent-coordination'
import { checkExecutionGate, type GateVerdict } from '@/lib/execution-gate'
import type { SessionState } from '@/lib/execution-session'

export interface ControlInput {
  agentId: string
  command?: string
  session?: SessionState
  options?: ValidateOptions
}

export function evaluateControl(input: ControlInput): GateVerdict {
  return checkExecutionGate(input)
}
