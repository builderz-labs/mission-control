import {
  asFleetAgentName,
  fleetAgentFromWorkspace,
  fleetAgentsShareIdentity,
  type FleetAgentName,
} from '@/lib/fleet-agents'
import { matchFleetProject } from '@/lib/fleet-cwd'

export type SessionEnvironment = 'local' | 'gateway' | 'desktop'

export interface NormalizedSession {
  id: string
  key: string
  agent: FleetAgentName | string
  kind: string
  project: string | null
  projectSlug: string | null
  environment: SessionEnvironment
  age: string
  model: string
  tokens: string
  channel: string
  flags: string[]
  active: boolean
  startTime: number
  lastActivity: number
  source: 'local' | 'gateway'
  workingDir: string | null
  lastUserPrompt: string | null
  userMessages?: number
  assistantMessages?: number
  toolUses?: number
  estimatedCost?: number
  totalTokens?: number
}

export function fleetAgentForSession(input: {
  kind?: string
  source?: string
  sessionId?: string
  workingDir?: string | null
  gatewayAgent?: string | null
}): FleetAgentName {
  const id = input.sessionId || ''
  if (id.startsWith('grok:') || input.kind === 'grok') return 'grok'
  if (id.startsWith('kimi:') || input.kind === 'kimi') return 'kimi'
  if (id.startsWith('codex:') || input.kind === 'codex-cli') return 'codex'
  const gateway = input.gatewayAgent ? asFleetAgentName(input.gatewayAgent) : null
  if (gateway) return gateway
  return fleetAgentFromWorkspace(input.workingDir)
}

export function sessionEnvironment(input: {
  source?: string
  workingDir?: string | null
}): SessionEnvironment {
  const dir = input.workingDir || ''
  if (dir.includes('Application Support/Claude')) return 'desktop'
  if (input.source === 'gateway') return 'gateway'
  return 'local'
}

export function attachProject(workingDir: string | null | undefined): {
  project: string | null
  projectSlug: string | null
} {
  const match = matchFleetProject(workingDir)
  return { project: match?.name ?? null, projectSlug: match?.slug ?? null }
}

export function claudeSeatsShareHistory(left: string, right: string): boolean {
  return fleetAgentsShareIdentity(left, right)
}

export function matchesSessionFilters(
  session: NormalizedSession,
  filters: { agent?: string; project?: string; active?: string; environment?: string },
): boolean {
  if (filters.agent && session.agent !== filters.agent && !claudeSeatsShareHistory(filters.agent, session.agent)) {
    return false
  }
  if (filters.project && session.projectSlug !== filters.project && session.project !== filters.project) return false
  if (filters.active === '1' && !session.active) return false
  if (filters.active === '0' && session.active) return false
  if (filters.environment && session.environment !== filters.environment) return false
  return true
}
