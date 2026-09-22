import { describe, expect, it } from 'vitest'
import {
  contextPercent,
  formatDuration,
  formatTokenLabel,
  parseSessionTokens,
  parseTokenCount,
  sessionDurationMs,
} from '../chat-session-metrics'

describe('parseTokenCount', () => {
  it('parses compact k/m counts and plain integers', () => {
    expect(parseTokenCount('28k')).toBe(28_000)
    expect(parseTokenCount('1.4m')).toBe(1_400_000)
    expect(parseTokenCount('201.7m')).toBe(201_700_000)
    expect(parseTokenCount('1234')).toBe(1234)
  })

  it('returns zero for empty or invalid input', () => {
    expect(parseTokenCount('')).toBe(0)
    expect(parseTokenCount('nope')).toBe(0)
  })
})

describe('parseSessionTokens', () => {
  it('reads used/window totals', () => {
    expect(parseSessionTokens('28k/200k')).toEqual({
      used: 28_000,
      window: 200_000,
      percent: 14,
      label: '28k',
    })
  })

  it('treats 201.7m/1.4m as in/out not a context window', () => {
    const parsed = parseSessionTokens('201.7m/1.4m')
    expect(parsed.used).toBe(203_100_000)
    expect(parsed.window).toBe(200_000)
    expect(parsed.label).toBe('201.7m/1.4m')
    expect(contextPercent('201.7m/1.4m')).toBeNull()
  })

  it('reads an explicit percent', () => {
    expect(parseSessionTokens('28k/200k (14%)')).toEqual({
      used: 28_000,
      window: 200_000,
      percent: 14,
      label: '28k',
    })
  })

  it('treats in/out pairs as a sum against the default window', () => {
    expect(parseSessionTokens('12k/3k')).toEqual({
      used: 15_000,
      window: 200_000,
      percent: 8,
      label: '12k/3k',
    })
  })

  it('returns zeros for empty tokens', () => {
    expect(parseSessionTokens(undefined)).toEqual({ used: 0, window: 0, percent: 0, label: '0' })
    expect(parseSessionTokens('')).toEqual({ used: 0, window: 0, percent: 0, label: '0' })
  })
})

describe('formatTokenLabel', () => {
  it('formats thousands and millions', () => {
    expect(formatTokenLabel(12_400)).toBe('12.4k')
    expect(formatTokenLabel(1_400_000)).toBe('1.4m')
    expect(formatTokenLabel(28_000)).toBe('28k')
  })
})

describe('sessionDurationMs', () => {
  it('uses last activity when present and now otherwise', () => {
    expect(sessionDurationMs(1_000, 5_000, 9_000)).toBe(4_000)
    expect(sessionDurationMs(1_000, undefined, 4_000)).toBe(3_000)
    expect(sessionDurationMs(undefined, 5_000, 9_000)).toBe(0)
  })

  it('normalizes second timestamps', () => {
    expect(sessionDurationMs(1_700_000_000, 1_700_000_010)).toBe(10_000)
  })
})

describe('formatDuration', () => {
  it('formats minutes, hours, and days', () => {
    expect(formatDuration(12 * 60_000)).toBe('12m')
    expect(formatDuration(72 * 60_000)).toBe('1h 12m')
    expect(formatDuration((2 * 24 + 4) * 3_600_000)).toBe('2d 4h')
  })
})

describe('contextPercent', () => {
  it('returns null when tokens are missing', () => {
    expect(contextPercent(undefined)).toBeNull()
    expect(contextPercent('')).toBeNull()
  })

  it('uses the parsed window or an explicit percent', () => {
    expect(contextPercent('28k/200k (14%)')).toBe(14)
    expect(contextPercent('12k/3k')).toBe(8)
  })

  it('uses a model context window for in/out totals', () => {
    expect(contextPercent('12k/3k', 'minimax/MiniMax-M3')).toBe(2)
  })
})
