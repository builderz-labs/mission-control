import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CLAUDE_FLEET_PLANS,
  type ClaudeFleetPlanStatus,
} from '@/lib/claude-fleet-plans'

/**
 * Report isolated Claude Max homes. Never create them or read oauthAccount.
 */
export function detectClaudeFleetPlans(): ClaudeFleetPlanStatus[] {
  const home = homedir()
  return CLAUDE_FLEET_PLANS.map((plan) => {
    const isolatedHome = join(home, plan.homeName)
    const isolatedHomeExists = existsSync(isolatedHome)
    return {
      ...plan,
      provider: 'anthropic',
      isolatedHome,
      isolatedHomeExists,
      authStatus: isolatedHomeExists ? 'isolated' : 'needs_login',
    }
  })
}
