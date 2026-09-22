export type UsageTone = 'ok' | 'warn' | 'critical'

export type UsageLimitRow = {
  id: 'five_hour' | 'weekly_all' | 'weekly_extra'
  title: string
  percent: number
  resetsLabel: string
  tone: UsageTone
}

export type UsageTracker = {
  contextPercent: number
  contextLabel: string
  planLabel: string
  sessionLimitReached: boolean
  sessionLimitResetsAt: string | null
  indicator: UsageTone
  limits: [UsageLimitRow, UsageLimitRow, UsageLimitRow]
}

export type UsageInput = {
  kind: string
  tokens?: string
  model?: string
  plan?: string
  contextPercent?: number | null
  fiveHourPercent: number
  weeklyPercent: number
  extraPercent: number
  extraLabel: string
  fiveHourResetsAt: number
  weeklyResetsAt: number
  now?: number
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function extraUsageLabel(model?: string): string {
  const hay = (model || '').toLowerCase()
  if (hay.includes('fable')) return 'Weekly · Fable'
  if (hay.includes('opus')) return 'Weekly · Opus'
  if (hay.includes('sonnet')) return 'Weekly · Sonnet'
  if (hay.includes('haiku')) return 'Weekly · Haiku'
  if (hay.includes('gpt') || hay.includes('codex')) return 'Weekly · GPT'
  if (hay.includes('grok')) return 'Weekly · Grok'
  if (hay.includes('kimi')) return 'Weekly · Kimi'
  return 'Weekly · extra'
}

export function planDisplayName(kind: string, plan?: string): string {
  const value = (plan || '').toLowerCase()
  if (value.includes('team')) return 'Team'
  if (value.includes('pro')) return 'Pro'
  if (value.includes('max')) return 'Max'
  if (kind === 'codex-cli') return 'ChatGPT'
  if (kind === 'grok') return 'Grok'
  if (kind === 'kimi') return 'Kimi'
  return 'Team'
}

export function formatResetsIn(targetMs: number, now = Date.now()): string {
  const delta = Math.max(0, targetMs - now)
  const mins = Math.round(delta / 60_000)
  if (mins < 1) return 'Resets now'
  if (mins < 60) return `Resets in ${mins} min`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  if (hours < 24) return rem ? `Resets in ${hours} hr ${rem} min` : `Resets in ${hours} hr`
  return `Resets ${new Date(targetMs).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}

export function nextSundaySeven(now = Date.now()): number {
  const date = new Date(now)
  const day = date.getDay()
  const add = day === 0 && (date.getHours() < 7) ? 0 : 7 - day || 7
  const next = new Date(date)
  next.setDate(date.getDate() + add)
  next.setHours(7, 0, 0, 0)
  if (next.getTime() <= now) next.setDate(next.getDate() + 7)
  return next.getTime()
}

function toneFor(percent: number): UsageTone {
  if (percent >= 100) return 'critical'
  if (percent >= 80) return 'warn'
  return 'ok'
}

export function buildUsageTracker(input: UsageInput): UsageTracker {
  const now = input.now ?? Date.now()
  const five = clampPercent(input.fiveHourPercent)
  const weekly = clampPercent(input.weeklyPercent)
  const extra = clampPercent(input.extraPercent)
  const context = clampPercent(input.contextPercent ?? 0)
  const fiveRow: UsageLimitRow = {
    id: 'five_hour',
    title: '5-hour limit',
    percent: five,
    resetsLabel: formatResetsIn(input.fiveHourResetsAt, now),
    tone: toneFor(five),
  }
  const weeklyRow: UsageLimitRow = {
    id: 'weekly_all',
    title: 'Weekly · all models',
    percent: weekly,
    resetsLabel: formatResetsIn(input.weeklyResetsAt, now),
    tone: toneFor(weekly),
  }
  const extraRow: UsageLimitRow = {
    id: 'weekly_extra',
    title: input.extraLabel || extraUsageLabel(input.model),
    percent: extra,
    resetsLabel: formatResetsIn(input.weeklyResetsAt, now),
    tone: toneFor(extra),
  }
  const sessionLimitReached = five >= 100
  return {
    contextPercent: context,
    contextLabel: 'Context window',
    planLabel: planDisplayName(input.kind, input.plan),
    sessionLimitReached,
    sessionLimitResetsAt: sessionLimitReached ? formatClock(input.fiveHourResetsAt) : null,
    indicator: toneFor(five),
    limits: [fiveRow, weeklyRow, extraRow],
  }
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
