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
  resolvedBy: 'direct' | 'default' | 'main_session' | 'fallback'
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

export function resolveCoordinatorDeliveryTarget(params: {
  to: string
  coordinatorAgent: string
  directAgent: CoordinatorAgentRecord | null
  allAgents: CoordinatorAgentRecord[]
  sessions: GatewaySession[]
  explicitSessionKey?: string | null
}): ResolvedCoordinatorTarget {
  const normalizedTo = normalizeName(params.to)
  const explicitSessionKey = params.explicitSessionKey?.trim() || null

  if (params.directAgent) {
    const openclawAgentId = getConfigOpenClawId(params.directAgent) || normalizeOpenClawId(params.directAgent.name)
    const sessionKey =
      explicitSessionKey ||
      params.directAgent.session_key?.trim() ||
      findSessionForAgent(params.directAgent, params.sessions)?.key ||
      null
    return {
      deliveryName: params.directAgent.name,
      sessionKey,
      openclawAgentId,
      resolvedBy: 'direct',
    }
  }

  if (normalizedTo === normalizeName(params.coordinatorAgent)) {
    const defaultAgent = params.allAgents.find(getConfigIsDefault)
    if (defaultAgent) {
      const openclawAgentId = getConfigOpenClawId(defaultAgent) || normalizeOpenClawId(defaultAgent.name)
      const sessionKey =
        explicitSessionKey ||
        defaultAgent.session_key?.trim() ||
        findSessionForAgent(defaultAgent, params.sessions)?.key ||
        null
      return {
        deliveryName: defaultAgent.name,
        sessionKey,
        openclawAgentId,
        resolvedBy: 'default',
      }
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
  }

  return {
    deliveryName: params.to,
    sessionKey: explicitSessionKey,
    openclawAgentId: normalizeOpenClawId(params.to),
    resolvedBy: 'fallback',
  }
}
