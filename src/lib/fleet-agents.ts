export const FLEET_AGENT_NAMES = ['claude-1', 'claude-2', 'codex', 'grok', 'kimi'] as const

export type FleetAgentName = (typeof FLEET_AGENT_NAMES)[number]

export const FLEET_AGENT_ALIASES = {
  'claude-20x': 'claude-1',
  'claude-5x': 'claude-2',
} as const satisfies Record<string, FleetAgentName>

export function isFleetAgentName(value: string): value is FleetAgentName {
  return (FLEET_AGENT_NAMES as readonly string[]).includes(value)
}

export function canonicalFleetAgentName(value: string): string {
  if (isFleetAgentName(value)) return value
  const aliased = FLEET_AGENT_ALIASES[value as keyof typeof FLEET_AGENT_ALIASES]
  return aliased ?? value
}

export function asFleetAgentName(value: string): FleetAgentName | null {
  const canonical = canonicalFleetAgentName(value)
  return isFleetAgentName(canonical) ? canonical : null
}

export function fleetAgentsShareIdentity(left: string, right: string): boolean {
  const a = asFleetAgentName(left)
  const b = asFleetAgentName(right)
  return Boolean(a && b && a === b)
}

export function fleetAgentFromWorkspace(projectPath: string | null | undefined): FleetAgentName {
  const dir = projectPath || ''
  if (
    dir.includes('workspace-claude-20x')
    || dir.includes('.claude-account1')
    || dir.includes('workspace-claude-1')
  ) {
    return 'claude-1'
  }
  if (
    dir.includes('workspace-claude-5x')
    || dir.includes('.claude-account2')
    || dir.includes('workspace-claude-2')
  ) {
    return 'claude-2'
  }
  return 'claude-1'
}
