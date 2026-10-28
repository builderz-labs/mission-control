#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: injects the latest unconsumed handoff
 * brief addressed to this agent, then marks it consumed so it isn't
 * re-injected next session.
 *
 * Wire it up in Claude Code settings.json:
 *
 *   {
 *     "hooks": {
 *       "SessionStart": [
 *         {
 *           "hooks": [
 *             {
 *               "type": "command",
 *               "command": "node /path/to/mission-control/scripts/hooks/handoff-session-start.mjs"
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   }
 *
 * Anything this script prints to stdout is injected into the session's
 * context. Requires MC_URL and MC_API_KEY (or MC_AGENT_API_KEY) in the
 * environment; agent name comes from MC_AGENT_NAME, falling back to the
 * current git branch owner convention if unset.
 *
 * See docs/handoff-briefs.md for the full pattern this implements.
 */

const MC_URL = process.env.MC_URL || 'http://127.0.0.1:3000'
const MC_API_KEY = process.env.MC_API_KEY || process.env.MC_AGENT_API_KEY
const AGENT_NAME = process.env.MC_AGENT_NAME

if (!MC_API_KEY || !AGENT_NAME) {
  // Not configured for this agent — exit quietly, no context to inject.
  process.exit(0)
}

async function main() {
  const res = await fetch(`${MC_URL}/api/handoffs?to_agent=${encodeURIComponent(AGENT_NAME)}`, {
    headers: { Authorization: `Bearer ${MC_API_KEY}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return

  const { brief } = await res.json()
  if (!brief) return

  const lines = [
    `## Handoff from ${brief.from_agent}`,
    '',
    brief.task_summary,
  ]
  if (brief.key_context) lines.push('', '**Context:**', brief.key_context)
  if (brief.decisions_made?.length) {
    lines.push('', '**Decisions made:**', ...brief.decisions_made.map((d) => `- ${d}`))
  }
  if (brief.next_steps?.length) {
    lines.push('', '**Next steps:**', ...brief.next_steps.map((s) => `- ${s}`))
  }
  if (brief.open_questions?.length) {
    lines.push('', '**Open questions:**', ...brief.open_questions.map((q) => `- ${q}`))
  }
  if (brief.refs?.length) {
    lines.push('', '**References:**', ...brief.refs.map((r) => `- ${r}`))
  }

  process.stdout.write(lines.join('\n') + '\n')

  // Best-effort: don't fail the hook if the consume call errors.
  fetch(`${MC_URL}/api/handoffs/${brief.id}/consume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MC_API_KEY}` },
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}

main().catch(() => process.exit(0))
