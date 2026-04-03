import type { GatewaySession } from '@/lib/sessions'
import { resolveCoordinatorDeliveryTarget, type CoordinatorAgentRecord } from '@/lib/coordinator-routing'

export interface Setting {
  key: string
  value: string
  description: string
  category: string
  updated_by: string | null
  updated_at: number | null
  is_default: boolean
}

export interface ApiKeyInfo {
  masked_key: string | null
  source: string
  last_rotated_at: number | null
  last_rotated_by: string | null
}

export interface CoordinatorTargetAgent {
  name: string
  openclawId: string
  isDefault: boolean
  sessionKey: string | null
  configRaw: string
}

export type CoordinatorSession = GatewaySession & { source?: string }

export const COORDINATOR_AGENT = (process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').toLowerCase()

export function parseCoordinatorTargetAgents(rawAgents: any[]): CoordinatorTargetAgent[] {
  const out: CoordinatorTargetAgent[] = []
  for (const raw of rawAgents || []) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    if (!name) continue
    const config = raw?.config && typeof raw.config === 'object' ? raw.config : {}
    const openclawIdRaw = typeof config.openclawId === 'string' && config.openclawId.trim()
      ? config.openclawId.trim()
      : name
    const openclawId = openclawIdRaw.toLowerCase().replace(/\s+/g, '-')
    out.push({
      name,
      openclawId,
      isDefault: config.isDefault === true,
      sessionKey: typeof raw?.session_key === 'string' && raw.session_key.trim() ? raw.session_key.trim() : null,
      configRaw: JSON.stringify(config),
    })
  }

  const unique = new Map<string, CoordinatorTargetAgent>()
  for (const agent of out) {
    const key = agent.openclawId || agent.name.toLowerCase()
    if (!unique.has(key)) unique.set(key, agent)
  }

  return Array.from(unique.values()).sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export const categoryLabels: Record<string, { label: string; icon: string; description: string }> = {
  general: { label: 'General', icon: '⚙', description: 'Core Ultron settings' },
  security: { label: 'Security', icon: '🔑', description: 'API key management and security settings' },
  retention: { label: 'Data Retention', icon: '🗄', description: 'How long data is kept before cleanup' },
  chat: { label: 'Chat', icon: '💬', description: 'Coordinator routing and chat behavior settings' },
  gateway: { label: 'Gateway', icon: '🔌', description: 'OpenClaw gateway connection settings' },
  profiles: { label: 'Security Profiles', icon: 'shield', description: 'Hook profile controls security scanning strictness' },
  custom: { label: 'Custom', icon: '🔧', description: 'User-defined settings' },
}

export const categoryOrder = ['general', 'security', 'profiles', 'retention', 'chat', 'gateway', 'custom']

// Dropdown options for subscription plan settings
export const subscriptionDropdowns: Record<string, { label: string; value: string }[]> = {
  'subscription.plan_override': [
    { label: 'Auto-detect', value: '' },
    { label: 'Pro ($20/mo)', value: 'pro' },
    { label: 'Max ($100/mo)', value: 'max' },
    { label: 'Max 5x ($200/mo)', value: 'max_5x' },
    { label: 'Team ($30/mo)', value: 'team' },
    { label: 'Enterprise', value: 'enterprise' },
  ],
  'subscription.codex_plan': [
    { label: 'None', value: '' },
    { label: 'ChatGPT Free ($0/mo)', value: 'chatgpt' },
    { label: 'Plus ($20/mo)', value: 'plus' },
    { label: 'Pro ($200/mo)', value: 'pro' },
    { label: 'Team ($30/mo)', value: 'team' },
  ],
}

/** Convert snake_case key to Title Case label */
export function formatLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function getCoordinatorResolutionPreview(
  configuredTarget: string,
  coordinatorTargetAgents: CoordinatorTargetAgent[],
  coordinatorSessions: CoordinatorSession[],
): string {
  const allAgents: CoordinatorAgentRecord[] = coordinatorTargetAgents.map(agent => ({
    name: agent.name,
    session_key: agent.sessionKey,
    config: agent.configRaw,
  }))
  const directAgent = allAgents.find(agent => agent.name.toLowerCase() === COORDINATOR_AGENT) || null
  const gatewaySessions = coordinatorSessions.filter(session => (session.source || 'gateway') === 'gateway')

  const resolved = resolveCoordinatorDeliveryTarget({
    to: COORDINATOR_AGENT,
    coordinatorAgent: COORDINATOR_AGENT,
    directAgent,
    allAgents,
    sessions: gatewaySessions,
    configuredCoordinatorTarget: configuredTarget || null,
  })

  const viaLabel: Record<string, string> = {
    configured: 'configured target',
    default: 'default agent',
    main_session: 'live :main session',
    direct: 'coordinator record',
    fallback: 'fallback',
  }

  const targetLabel = `${resolved.deliveryName}${resolved.openclawAgentId ? ` (${resolved.openclawAgentId})` : ''}`
  return `Resolves now to ${targetLabel} via ${viaLabel[resolved.resolvedBy] || resolved.resolvedBy}.`
}
