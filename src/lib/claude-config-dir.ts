import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CLAUDE_FLEET_PLANS } from './claude-fleet-plans'
import { asFleetAgentName } from './fleet-agents'

/**
 * Pin headless Claude dispatch to a dedicated config dir only when that
 * directory already exists. Heal must never create it or rewrite oauthAccount.
 */
export function claudeConfigDirForAgent(name: string | null | undefined): string | undefined {
  if (!name) return undefined
  const identity = asFleetAgentName(name)
  const plan = CLAUDE_FLEET_PLANS.find((entry) => entry.identity === identity)
  if (!plan) return undefined
  const dir = join(homedir(), plan.homeName)
  return existsSync(dir) ? dir : undefined
}

export function claudeSessionHomes(primary?: string | null): string[] {
  const homes: string[] = []
  const add = (dir: string | null | undefined) => {
    if (!dir || homes.includes(dir) || !existsSync(join(dir, 'projects'))) return
    homes.push(dir)
  }
  add(primary)
  for (const plan of CLAUDE_FLEET_PLANS) add(join(homedir(), plan.homeName))
  return homes
}
