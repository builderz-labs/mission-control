import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_FLEET_PLANS,
  claudeFleetPlanByIntegrationId,
  claudeFleetPlanTotalUsd,
  formatClaudeFleetLabels,
} from '@/lib/claude-fleet-plans'
import { detectClaudeFleetPlans } from '@/lib/claude-fleet-plan-status'

describe('claude fleet plans', () => {
  it('splits Max 20x and Max 5x with fleet prices', () => {
    expect(CLAUDE_FLEET_PLANS.map((plan) => plan.label)).toEqual(['Max 20x', 'Max 5x'])
    expect(CLAUDE_FLEET_PLANS.map((plan) => plan.type)).toEqual(['max_20x', 'max_5x'])
    expect(claudeFleetPlanTotalUsd()).toBe(300)
    expect(formatClaudeFleetLabels()).toBe('Max 20x + Max 5x')
    expect(claudeFleetPlanByIntegrationId('claude-max-20x')?.identity).toBe('claude-1')
    expect(claudeFleetPlanByIntegrationId('anthropic')).toBeUndefined()
  })

  it('detects isolated homes without creating them or touching oauth', () => {
    const twenty = join(homedir(), '.claude-account1')
    const five = join(homedir(), '.claude-account2')
    const beforeTwenty = existsSync(twenty)
    const beforeFive = existsSync(five)
    const plans = detectClaudeFleetPlans()
    expect(plans).toHaveLength(2)
    expect(plans[0]?.identity).toBe('claude-1')
    expect(plans[1]?.identity).toBe('claude-2')
    expect(plans[0]?.isolatedHome).toBe(twenty)
    expect(plans[1]?.isolatedHome).toBe(five)
    expect(existsSync(twenty)).toBe(beforeTwenty)
    expect(existsSync(five)).toBe(beforeFive)
    for (const plan of plans) {
      expect(plan.authStatus).toBe(plan.isolatedHomeExists ? 'isolated' : 'needs_login')
    }
  })
})
