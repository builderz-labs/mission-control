export type PolicyRouteAction = 'allow' | 'approval_required' | 'reject'
export type PolicyAuditSeverity = 'info' | 'warning' | 'error'

export interface PolicyRouteRequest {
  taskId: string
  title: string
  description?: string | null
  tags?: string[]
  metadata?: Record<string, unknown> | null
  budget?: {
    maxUsd?: number | null
    estimatedUsd?: number | null
  } | null
  tools?: string[]
  requestedAgent?: string | null
  workspaceId?: string | null
}

export interface PolicyRouteDecision {
  action: PolicyRouteAction
  target?: string
  reason: string
  audit: {
    eventType: 'policy_route_decision'
    severity: PolicyAuditSeverity
  }
}

function hasTool(request: PolicyRouteRequest, tool: string): boolean {
  return request.tools?.includes(tool) ?? false
}

function hasApprovedSecretScope(metadata: PolicyRouteRequest['metadata']): boolean {
  return metadata?.approvedSecretScope === true
}

function metadataString(metadata: PolicyRouteRequest['metadata'], key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function isCloudAgent(agent: string | null | undefined): boolean {
  return typeof agent === 'string' && agent.toLowerCase().includes('cloud')
}

function exceedsBudgetCap(request: PolicyRouteRequest): boolean {
  const maxUsd = request.budget?.maxUsd
  const estimatedUsd = request.budget?.estimatedUsd
  return typeof maxUsd === 'number' && typeof estimatedUsd === 'number' && estimatedUsd > maxUsd
}

function containsPii(request: PolicyRouteRequest): boolean {
  const text = `${request.title} ${request.description ?? ''}`
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
    || /\b(?:\+?\d[\d .-]{7,}\d)\b/.test(text)
}

function inferredPrivacyClass(request: PolicyRouteRequest): string | null {
  const explicit = metadataString(request.metadata, 'privacyClass')
  if (explicit) return explicit

  const text = `${request.title} ${request.description ?? ''} ${(request.tags ?? []).join(' ')}`.toLowerCase()
  const localOnlyKeywords = ['api token', 'secret', 'credential', 'password', 'private key', 'leaked']
  return localOnlyKeywords.some((keyword) => text.includes(keyword)) ? 'local_only' : null
}

function usesSideEffectingTool(request: PolicyRouteRequest): boolean {
  const sideEffectingTools = new Set([
    'repo.write',
    'shell.exec',
    'db.write',
    'git.push',
    'message.send',
  ])
  return request.tools?.some((tool) => sideEffectingTools.has(tool)) ?? false
}

export async function routePolicy(request: PolicyRouteRequest): Promise<PolicyRouteDecision> {
  const privacyClass = inferredPrivacyClass(request)

  if (privacyClass === 'local_only' && isCloudAgent(request.requestedAgent)) {
    return {
      action: 'reject',
      target: request.requestedAgent ?? undefined,
      reason: 'local_only tasks cannot be routed to cloud agents.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    }
  }

  if (exceedsBudgetCap(request)) {
    return {
      action: 'reject',
      target: request.requestedAgent ?? undefined,
      reason: 'Estimated task cost exceeds the configured budget cap.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    }
  }

  if (hasTool(request, 'secrets.read') && !hasApprovedSecretScope(request.metadata)) {
    return {
      action: 'reject',
      target: request.requestedAgent ?? undefined,
      reason: 'Secret access is blocked unless an approved secret scope is present.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    }
  }

  if (
    privacyClass === 'cloud_ok'
    && isCloudAgent(request.requestedAgent)
    && containsPii(request)
  ) {
    return {
      action: 'allow',
      target: metadataString(request.metadata, 'localPreferredAgent') ?? undefined,
      reason: 'PII detected in cloud-ok task; routing to local preferred agent.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    }
  }

  if (isCloudAgent(request.requestedAgent) && hasTool(request, 'repo.write')) {
    return {
      action: 'approval_required',
      target: request.requestedAgent ?? undefined,
      reason: 'Cloud write-capable delegation requires explicit approval.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    }
  }

  if (usesSideEffectingTool(request)) {
    return {
      action: 'approval_required',
      target: request.requestedAgent ?? undefined,
      reason: 'Side-effecting tools require explicit approval before dispatch.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    }
  }

  return {
    action: 'allow',
    target: request.requestedAgent ?? undefined,
    reason: 'Task stays within local execution policy.',
    audit: {
      eventType: 'policy_route_decision',
      severity: 'info',
    },
  }
}
