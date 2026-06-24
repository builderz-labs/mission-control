/**
 * Scheduler entrypoints for the briefing system: daily generation + Slack
 * posting (08:00 UTC) and weekly landlord reports (Friday). Both return the
 * `{ ok, message }` shape the scheduler tick expects and never throw.
 */

import { getDatabase } from './db'
import { logger } from './logger'
import { generateAgentBriefing } from './briefings'
import { channelForAgent, postBriefingToSlack } from './briefing-slack'
import { generateWeeklyLandlordReports } from './briefing-weekly-report'

/**
 * Generate a briefing for every agent in the DB, then post the ones with a
 * domain-channel mapping (Sofia, James, Victoria, Aria, Iris) to Slack.
 */
export async function runDailyBriefings(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const date = new Date().toISOString().split('T')[0]

    const agents = db
      .prepare('SELECT name, workspace_id FROM agents')
      .all() as Array<{ name: string; workspace_id: number }>

    if (agents.length === 0) return { ok: true, message: 'No agents to brief' }

    let generated = 0
    let posted = 0
    const postSkips: string[] = []

    for (const agent of agents) {
      const workspaceId = agent.workspace_id ?? 1
      let briefing
      try {
        briefing = generateAgentBriefing(db, { agentName: agent.name, date, workspaceId, actor: 'scheduler' })
      } catch (err: any) {
        logger.warn({ err, agent: agent.name }, 'Briefing generation failed for agent')
        continue
      }
      if (!briefing) continue
      generated++

      // Only post agents with a domain channel mapping.
      if (!channelForAgent(agent.name)) continue
      const res = await postBriefingToSlack(db, {
        agentName: agent.name,
        date,
        content: briefing.content,
        workspaceId,
      })
      if (res.ok) posted++
      else if (res.skipped) postSkips.push(`${agent.name}: ${res.skipped}`)
    }

    let message = `Generated ${generated} briefing(s), posted ${posted} to Slack`
    if (postSkips.length > 0) message += ` (skipped: ${postSkips.join('; ')})`
    return { ok: true, message }
  } catch (err: any) {
    logger.error({ err }, 'runDailyBriefings failed')
    return { ok: false, message: `Daily briefings failed: ${err.message}` }
  }
}

/** Weekly landlord reports (Friday). */
export async function runWeeklyLandlordReports(): Promise<{ ok: boolean; message: string }> {
  try {
    const db = getDatabase()
    const result = generateWeeklyLandlordReports(db, { workspaceId: 1 })
    return { ok: result.ok, message: result.message }
  } catch (err: any) {
    logger.error({ err }, 'runWeeklyLandlordReports failed')
    return { ok: false, message: `Weekly reports failed: ${err.message}` }
  }
}
