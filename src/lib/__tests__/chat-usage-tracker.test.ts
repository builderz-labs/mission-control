import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  buildUsageTracker,
  clampPercent,
  extraUsageLabel,
  formatResetsIn,
  nextSundaySeven,
  planDisplayName,
} from '../chat-usage-tracker'

const KINDS = ['claude-code', 'codex-cli', 'grok', 'kimi', 'opencode', 'gateway'] as const

describe('usage tracker', () => {
  it('matches the Claude desktop usage popup fields', () => {
    const now = Date.parse('2026-09-03T16:56:00Z')
    const tracker = buildUsageTracker({
      kind: 'claude-code',
      plan: 'team',
      model: 'claude-fable',
      contextPercent: 0,
      fiveHourPercent: 100,
      weeklyPercent: 69,
      extraPercent: 29,
      extraLabel: extraUsageLabel('claude-fable'),
      fiveHourResetsAt: now + (1 * 60 + 54) * 60_000,
      weeklyResetsAt: Date.parse('2026-09-06T07:00:00'),
      now,
    })
    expect(tracker.contextLabel).toBe('Context window')
    expect(tracker.contextPercent).toBe(0)
    expect(tracker.planLabel).toBe('Team')
    expect(tracker.sessionLimitReached).toBe(true)
    expect(tracker.indicator).toBe('critical')
    expect(buildUsageTracker({
      kind: 'claude-code',
      fiveHourPercent: 0,
      weeklyPercent: 100,
      extraPercent: 100,
      extraLabel: 'Weekly · Fable',
      fiveHourResetsAt: now + 3_600_000,
      weeklyResetsAt: now + 86_400_000,
      now,
    }).indicator).toBe('ok')
    expect(tracker.limits.map((row) => row.title)).toEqual([
      '5-hour limit',
      'Weekly · all models',
      'Weekly · Fable',
    ])
    expect(tracker.limits[0].percent).toBe(100)
    expect(tracker.limits[1].percent).toBe(69)
    expect(tracker.limits[2].percent).toBe(29)
    expect(tracker.limits[0].resetsLabel).toBe('Resets in 1 hr 54 min')
    expect(tracker.limits[0].tone).toBe('critical')
  })

  it('exposes the same three limit rows for every agent', () => {
    fc.assert(fc.property(
      fc.constantFrom(...KINDS),
      fc.integer({ min: 0, max: 150 }),
      fc.integer({ min: 0, max: 150 }),
      fc.integer({ min: 0, max: 150 }),
      fc.integer({ min: 0, max: 100 }),
      (kind, five, weekly, extra, context) => {
        const tracker = buildUsageTracker({
          kind,
          plan: 'team',
          fiveHourPercent: five,
          weeklyPercent: weekly,
          extraPercent: extra,
          extraLabel: extraUsageLabel('opus'),
          fiveHourResetsAt: Date.now() + 3_600_000,
          weeklyResetsAt: nextSundaySeven(),
          contextPercent: context,
        })
        expect(tracker.limits).toHaveLength(3)
        expect(tracker.limits[0].id).toBe('five_hour')
        expect(tracker.limits[1].id).toBe('weekly_all')
        expect(tracker.limits[2].id).toBe('weekly_extra')
        expect(tracker.contextLabel).toBe('Context window')
        expect(tracker.limits[0].title).toBe('5-hour limit')
        expect(tracker.limits[1].title).toBe('Weekly · all models')
        expect(tracker.contextPercent).toBe(clampPercent(context))
        expect(tracker.sessionLimitReached).toBe(clampPercent(five) >= 100)
      },
    ))
  })

  it('names plans and extra models the way the desktop apps do', () => {
    expect(planDisplayName('claude-code', 'team')).toBe('Team')
    expect(planDisplayName('codex-cli', 'chatgpt')).toBe('ChatGPT')
    expect(extraUsageLabel('claude-fable-2026')).toBe('Weekly · Fable')
    expect(formatResetsIn(Date.now() + 90_000, Date.now())).toBe('Resets in 2 min')
  })
})
