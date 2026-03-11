import type { GatewaySession } from './sessions'

export interface CoordinatorAgentRecord {
  name: string
  session_key?: string | null
  config?: string | null
}

export interface ResolvedCoordinatorTarget {
  deliveryName: string
  sessionKey: string | null
  openclawAgentId: string | null
  resolvedBy: 'direct' | 'configured' | 'default' | 'main_session' | 'fallback'
}

function normalizeName(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeOpenClawId(value: string | null | undefined): string {
  return normalizeName(value).replace(/\s+/g, '-')
}

function parseConfig(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function getConfigOpenClawId(agent: CoordinatorAgentRecord): string | null {
  const parsed = parseConfig(agent.config)
  return typeof parsed.openclawId === 'string' && parsed.openclawId.trim()
    ? parsed.openclawId.trim()
    : null
}

function getConfigIsDefault(agent: CoordinatorAgentRecord): boolean {
  const parsed = parseConfig(agent.config)
  return parsed.isDefault === true
}

function findSessionForAgent(
  agent: CoordinatorAgentRecord,
  sessions: GatewaySession[],
): GatewaySession | undefined {
  const name = normalizeName(agent.name)
  const openclawId = normalizeOpenClawId(getConfigOpenClawId(agent) || agent.name)
  return sessions.find((session) => {
    const sessionAgent = normalizeName(session.agent)
    return sessionAgent === name || sessionAgent === openclawId
  })
}

function resolveConfiguredCoordinatorTarget(
  preferredTarget: string,
  allAgents: CoordinatorAgentRecord[],
  sessions: GatewaySession[],
): CoordinatorAgentRecord | null {
  const wanted = normalizeName(preferredTarget)
  if (!wanted) return null

  return allAgents.find((agent) => {
    const byName = normalizeName(agent.name) === wanted
    const byOpenClawId = normalizeOpenClawId(getConfigOpenClawId(agent) || agent.name) === wanted
    const session = findSessionForAgent(agent, sessions)
    const bySessionAgent = session ? normalizeName(session.agent) === wanted : false
    return byName || byOpenClawId || bySessionAgent
  }) || null
}

export function resolveCoordinatorDeliveryTarget(params: {
  to: string
  coordinatorAgent: string
  directAgent: CoordinatorAgentRecord | null
  allAgents: CoordinatorAgentRecord[]
  sessions: GatewaySession[]
  explicitSessionKey?: string | null
  configuredCoordinatorTarget?: string | null
}): ResolvedCoordinatorTarget {
  const normalizedTo = normalizeName(params.to)
  const normalizedCoordinatorAgent = normalizeName(params.coordinatorAgent)
  const explicitSessionKey = params.explicitSessionKey?.trim() || null

  const buildResult = (
    agent: CoordinatorAgentRecord,
    resolvedBy: ResolvedCoordinatorTarget['resolvedBy'],
  ): ResolvedCoordinatorTarget => {
    const openclawAgentId = getConfigOpenClawId(agent) || normalizeOpenClawId(agent.name)
    const sessionKey =
      explicitSessionKey ||
      agent.session_key?.trim() ||
      findSessionForAgent(agent, params.sessions)?.key ||
      null

    return {
      deliveryName: agent.name,
      sessionKey,
      openclawAgentId,
      resolvedBy,
    }
  }

  if (normalizedTo === normalizedCoordinatorAgent) {
    const configuredTarget = (params.configuredCoordinatorTarget || '').trim()
    if (configuredTarget) {
      const configuredAgent = resolveConfiguredCoordinatorTarget(configuredTarget, params.allAgents, params.sessions)
      if (configuredAgent) {
        return buildResult(configuredAgent, 'configured')
      }
    }

    const defaultAgent = params.allAgents.find(getConfigIsDefault)
    if (defaultAgent) {
      return buildResult(defaultAgent, 'default')
    }

    const mainSession = params.sessions.find((session) => /:main$/i.test(session.key))
    if (mainSession) {
      const matchingAgent = params.allAgents.find((agent) => {
        const openclawId = normalizeOpenClawId(getConfigOpenClawId(agent) || agent.name)
        const agentName = normalizeName(agent.name)
        const sessionAgent = normalizeName(mainSession.agent)
        return sessionAgent === agentName || sessionAgent === openclawId
      })

      return {
        deliveryName: matchingAgent?.name || mainSession.agent,
        sessionKey: explicitSessionKey || mainSession.key || null,
        openclawAgentId:
          getConfigOpenClawId(matchingAgent || { name: mainSession.agent }) ||
          normalizeOpenClawId(mainSession.agent),
        resolvedBy: 'main_session',
      }
    }

    if (params.directAgent) {
      return buildResult(params.directAgent, 'direct')
    }
  }

  if (params.directAgent) {
    return buildResult(params.directAgent, 'direct')
  }

  return {
    deliveryName: params.to,
    sessionKey: explicitSessionKey,
    openclawAgentId: normalizeOpenClawId(params.to),
    resolvedBy: 'fallback',
  }
}
