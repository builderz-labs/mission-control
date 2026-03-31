export type OfficeAgentStatus = 'offline' | 'idle' | 'busy' | 'error'
export type OfficeLocalSessionFilter = 'running' | 'not-running'

export interface OfficeAgentLike {
  status: OfficeAgentStatus
  config?: unknown
}

export interface OfficeRosterLabel {
  key: 'activeStatus' | 'idleMinutes' | 'noRecentActivity' | 'offlineStatus' | 'notRunningStatus'
  values?: Record<string, number>
}

export interface OfficeAttentionParams {
  agent: OfficeAgentLike
  hasRecentPresence: boolean
  minutesIdle: number
  isLocalMode: boolean
}

function getLocalSessionMeta(agent: OfficeAgentLike) {
  return (agent.config as { localSession?: { active?: boolean } } | null | undefined)?.localSession
}

export function isRunningOfficeAgent(agent: OfficeAgentLike): boolean {
  const localSession = getLocalSessionMeta(agent)
  if (typeof localSession?.active === 'boolean') {
    return localSession.active
  }
  return agent.status !== 'offline'
}

export function getOfficeDisplayStatus(agent: OfficeAgentLike): OfficeAgentStatus {
  if (!isRunningOfficeAgent(agent)) {
    return agent.status === 'error' ? 'error' : 'offline'
  }
  return agent.status
}

export function countOfficeAgents<T extends OfficeAgentLike>(
  agents: T[],
): Record<OfficeAgentStatus, number> {
  const counts: Record<OfficeAgentStatus, number> = {
    idle: 0,
    busy: 0,
    error: 0,
    offline: 0,
  }

  for (const agent of agents) {
    counts[getOfficeDisplayStatus(agent)] += 1
  }

  return counts
}

export function getOfficeNeedsAttention(params: OfficeAttentionParams): boolean {
  const { agent, hasRecentPresence, minutesIdle, isLocalMode } = params
  return Boolean(
    isLocalMode &&
    hasRecentPresence &&
    getOfficeDisplayStatus(agent) === 'idle' &&
    minutesIdle >= 15,
  )
}

export function filterOfficeAgents<T extends OfficeAgentLike>(
  agents: T[],
  isLocalMode: boolean,
  filter: OfficeLocalSessionFilter,
): T[] {
  if (!isLocalMode) return agents
  return agents.filter((agent) => {
    const running = isRunningOfficeAgent(agent)
    return filter === 'not-running' ? !running : running
  })
}

export function getOfficeRosterLabel(params: {
  agent: OfficeAgentLike
  hasRecentPresence: boolean
  minutesIdle: number
}): OfficeRosterLabel {
  const { agent, hasRecentPresence, minutesIdle } = params
  const displayStatus = getOfficeDisplayStatus(agent)
  if (displayStatus === 'busy') {
    return { key: 'activeStatus' }
  }
  if (!isRunningOfficeAgent(agent)) {
    return agent.status === 'offline'
      ? { key: 'offlineStatus' }
      : { key: 'notRunningStatus' }
  }
  if (hasRecentPresence) {
    return { key: 'idleMinutes', values: { minutes: minutesIdle } }
  }
  return { key: 'noRecentActivity' }
}
