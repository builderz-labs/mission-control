export const CLAUDE_FLEET_PLANS = [
  {
    identity: 'claude-1',
    integrationId: 'claude-max-20x',
    type: 'max_20x',
    label: 'Max 20x',
    priceUsd: 200,
    account: 'personal',
    homeName: '.claude-account1',
  },
  {
    identity: 'claude-2',
    integrationId: 'claude-max-5x',
    type: 'max_5x',
    label: 'Max 5x',
    priceUsd: 100,
    account: 'stillpoint',
    homeName: '.claude-account2',
  },
] as const

export type ClaudeFleetPlanDef = (typeof CLAUDE_FLEET_PLANS)[number]
export type ClaudeFleetPlanIdentity = ClaudeFleetPlanDef['identity']
export type ClaudeFleetAuthStatus = 'isolated' | 'needs_login'

export type ClaudeFleetPlanStatus = ClaudeFleetPlanDef & {
  provider: 'anthropic'
  isolatedHome: string
  isolatedHomeExists: boolean
  authStatus: ClaudeFleetAuthStatus
}

export function claudeFleetPlanTotalUsd(): number {
  return CLAUDE_FLEET_PLANS.reduce((sum, plan) => sum + plan.priceUsd, 0)
}

export function formatClaudeFleetLabels(): string {
  return CLAUDE_FLEET_PLANS.map((plan) => plan.label).join(' + ')
}

export function claudeFleetPlanByIntegrationId(id: string): ClaudeFleetPlanDef | undefined {
  return CLAUDE_FLEET_PLANS.find((plan) => plan.integrationId === id)
}
