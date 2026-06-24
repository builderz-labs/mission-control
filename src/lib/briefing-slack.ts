/**
 * Slack posting for agent briefings.
 *
 * Reuses the same bot-token approach as Sofia (`SLACK_BOT_TOKEN`, an xoxb-…
 * token), but posts via a plain `fetch` to Slack's Web API rather than pulling
 * in the @slack/web-api SDK — MC has no Slack dependency and this keeps it that
 * way. Each agent's briefing is routed to its domain channel; the resulting
 * message ts + channel id + posted_at are written back onto the briefing row so
 * the dashboard can show "posted" state and avoid double-posting.
 *
 * Everything here is best-effort and non-fatal: a missing token, missing
 * channel, or Slack API error is logged and skipped — the scheduler tick must
 * never crash because Slack is unreachable.
 */

import type Database from 'better-sqlite3'
import { logger } from './logger'

/**
 * Agent → Slack channel routing. Channel can be a name (`#operations-briefing`)
 * or an ID (`C0…`); each is overridable via env so deployments can point at
 * their own channels / IDs without a code change.
 */
export const BRIEFING_CHANNELS: Record<string, string> = {
  Sofia: process.env.MC_BRIEFING_CHANNEL_OPERATIONS || '#operations-briefing',
  James: process.env.MC_BRIEFING_CHANNEL_FINANCE || '#finance-briefing',
  Victoria: process.env.MC_BRIEFING_CHANNEL_DIRECT_BOOKINGS || '#direct-bookings-briefing',
  Aria: process.env.MC_BRIEFING_CHANNEL_DIRECT_BOOKINGS || '#direct-bookings-briefing',
  Iris: process.env.MC_BRIEFING_CHANNEL_GUEST_EXPERIENCE || '#guest-experience-briefing',
}

/** The bills channel has no owning agent — utilities / council tax digest. */
export const BILLS_CHANNEL = process.env.MC_BRIEFING_CHANNEL_BILLS || '#bills-briefing'

export function channelForAgent(agentName: string): string | null {
  return BRIEFING_CHANNELS[agentName] || null
}

interface SlackPostResponse {
  ok: boolean
  ts?: string
  channel?: string
  error?: string
}

/** Post a message via Slack's chat.postMessage Web API using a bot token. */
async function slackPostMessage(
  token: string,
  body: Record<string, unknown>,
): Promise<SlackPostResponse> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  return (await res.json()) as SlackPostResponse
}

/**
 * Convert the briefing markdown into Slack mrkdwn.
 * Slack uses `*bold*` (single asterisk) and has no heading syntax, so headings
 * become bold lines. Kept deliberately small — the briefing markdown shape is
 * known (see buildBriefingContent).
 */
export function markdownToSlack(md: string): string {
  return md
    .split('\n')
    .map((line) => {
      const heading = line.match(/^#{1,6}\s+(.*)$/)
      if (heading) return `*${heading[1].trim()}*`
      return line
    })
    .join('\n')
    // **bold** → *bold* (do after headings so heading text isn't double-wrapped)
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .trim()
}

export interface PostResult {
  ok: boolean
  skipped?: string
  channel?: string
  ts?: string
}

/**
 * Post one briefing to its agent's channel and record ts/channel/posted_at.
 * `force` re-posts even if already posted (default: skip if posted_at set).
 */
export async function postBriefingToSlack(
  db: Database.Database,
  opts: { agentName: string; date: string; content: string; workspaceId: number; force?: boolean },
): Promise<PostResult> {
  const { agentName, date, content, workspaceId, force } = opts

  const channel = channelForAgent(agentName)
  if (!channel) return { ok: false, skipped: 'no channel mapping' }

  const token = process.env.SLACK_BOT_TOKEN
  if (!token) {
    logger.warn('SLACK_BOT_TOKEN not set — briefing Slack posting disabled')
    return { ok: false, skipped: 'no slack token' }
  }

  const row = db
    .prepare('SELECT id, posted_at FROM briefings WHERE agent_name = ? AND date = ? AND workspace_id = ?')
    .get(agentName, date, workspaceId) as { id: number; posted_at: number | null } | undefined
  if (!row) return { ok: false, skipped: 'briefing row not found' }
  if (row.posted_at && !force) return { ok: false, skipped: 'already posted' }

  try {
    const res = await slackPostMessage(token, {
      channel,
      text: `Morning briefing — ${agentName} — ${date}`,
      mrkdwn: true,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: markdownToSlack(content).slice(0, 2900) },
        },
      ],
    })

    if (!res.ok) {
      logger.warn({ agentName, channel, reason: res.error }, 'Briefing Slack post failed')
      return { ok: false, skipped: `slack error: ${res.error || 'unknown'}` }
    }

    const now = Math.floor(Date.now() / 1000)
    db.prepare(
      'UPDATE briefings SET slack_message_ts = ?, slack_channel_id = ?, posted_at = ?, updated_at = ? WHERE id = ?',
    ).run(String(res.ts || ''), String(res.channel || channel), now, now, row.id)

    return { ok: true, channel: String(res.channel || channel), ts: String(res.ts || '') }
  } catch (err: any) {
    const reason = err?.message || 'unknown error'
    logger.warn({ agentName, channel, reason }, 'Briefing Slack post failed')
    return { ok: false, skipped: `slack error: ${reason}` }
  }
}
