import { asFleetAgentName, type FleetAgentName } from '@/lib/fleet-agents'
import type { HandoffKind } from '@/lib/session-handoff'

const KIND_AGENT: Record<HandoffKind, FleetAgentName> = {
  'claude-code': 'claude-1',
  'codex-cli': 'codex',
  grok: 'grok',
  kimi: 'kimi',
}

export function fleetAgentFromHandoff(kind: HandoffKind, agent?: string): FleetAgentName {
  return asFleetAgentName((agent || '').trim()) || KIND_AGENT[kind]
}

export function handoffKindFromAgent(agent: FleetAgentName): HandoffKind {
  if (agent === 'claude-1' || agent === 'claude-2') return 'claude-code'
  if (agent === 'codex') return 'codex-cli'
  return agent
}

export function sameHandoffSeat(
  sourceKind: HandoffKind,
  targetKind: HandoffKind,
  sourceAgent: string,
  targetAgent: string,
): boolean {
  return sourceKind === targetKind && sourceAgent === targetAgent
}
