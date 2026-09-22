import { getDatabase } from '@/lib/db'
import { contextPercent } from '@/lib/chat-session-metrics'
import { buildUsageTracker, extraUsageLabel, nextSundaySeven, type UsageTracker } from '@/lib/chat-usage-tracker'

const FIVE_HOURS = 5 * 60 * 60
const WEEK = 7 * 24 * 60 * 60

const CAPS: Record<string, { fiveHour: number; weekly: number; extra: number }> = {
  'claude-code': { fiveHour: 40_000_000, weekly: 200_000_000, extra: 80_000_000 },
  'codex-cli': { fiveHour: 40_000_000, weekly: 200_000_000, extra: 80_000_000 },
  grok: { fiveHour: 40_000_000, weekly: 200_000_000, extra: 80_000_000 },
  kimi: { fiveHour: 40_000_000, weekly: 200_000_000, extra: 80_000_000 },
  opencode: { fiveHour: 40_000_000, weekly: 200_000_000, extra: 80_000_000 },
  gateway: { fiveHour: 40_000_000, weekly: 200_000_000, extra: 80_000_000 },
}

function modelNeedle(kind: string): string {
  if (kind === 'claude-code') return '%claude%'
  if (kind === 'codex-cli') return '%gpt%'
  if (kind === 'grok') return '%grok%'
  if (kind === 'kimi') return '%kimi%'
  return '%'
}

function extraNeedle(model?: string): string {
  const hay = (model || '').toLowerCase()
  if (hay.includes('fable')) return '%fable%'
  if (hay.includes('opus')) return '%opus%'
  if (hay.includes('sonnet')) return '%sonnet%'
  if (hay.includes('gpt')) return '%gpt%'
  if (hay.includes('grok')) return '%grok%'
  if (hay.includes('kimi')) return '%kimi%'
  return modelNeedle('')
}

function sumTokens(since: number, like: string, workspaceId: number): number {
  const row = getDatabase().prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS total
    FROM token_usage
    WHERE created_at >= ? AND workspace_id = ? AND lower(model) LIKE lower(?)
  `).get(since, workspaceId, like) as { total: number }
  return Number(row?.total) || 0
}

function oldestSince(since: number, like: string, workspaceId: number): number | null {
  const row = getDatabase().prepare(`
    SELECT MIN(created_at) AS first
    FROM token_usage
    WHERE created_at >= ? AND workspace_id = ? AND lower(model) LIKE lower(?)
  `).get(since, workspaceId, like) as { first: number | null }
  return row?.first ?? null
}

export function liveUsageTracker(input: {
  kind: string
  tokens?: string
  model?: string
  plan?: string
  workspaceId: number
  now?: number
}): UsageTracker {
  const nowSec = Math.floor((input.now ?? Date.now()) / 1000)
  const caps = CAPS[input.kind] || CAPS['claude-code']
  const needle = modelNeedle(input.kind)
  const extra = extraNeedle(input.model)
  const fiveUsed = sumTokens(nowSec - FIVE_HOURS, needle, input.workspaceId)
  const weeklyUsed = sumTokens(nowSec - WEEK, needle, input.workspaceId)
  const extraUsed = sumTokens(nowSec - WEEK, extra, input.workspaceId)
  const oldest = oldestSince(nowSec - FIVE_HOURS, needle, input.workspaceId)
  const fiveReset = ((oldest ?? nowSec) + FIVE_HOURS) * 1000
  return buildUsageTracker({
    kind: input.kind,
    model: input.model,
    plan: input.plan,
    contextPercent: contextPercent(input.tokens, input.model) ?? 0,
    fiveHourPercent: (fiveUsed / caps.fiveHour) * 100,
    weeklyPercent: (weeklyUsed / caps.weekly) * 100,
    extraPercent: (extraUsed / caps.extra) * 100,
    extraLabel: extraUsageLabel(input.model),
    fiveHourResetsAt: fiveReset,
    weeklyResetsAt: nextSundaySeven((input.now ?? Date.now())),
    now: input.now,
  })
}
