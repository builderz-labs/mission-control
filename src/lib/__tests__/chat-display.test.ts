import { describe, expect, it } from 'vitest'
import {
  firstName,
  modelPickerLabel,
  parsePins,
  pullStatusLabel,
  relativeTime,
  sessionStatusPill,
  toActivityMs,
  togglePin,
  workingDirLeaf,
} from '../chat-display'

describe('firstName', () => {
  it('returns the first token', () => {
    expect(firstName('Ty DeVries')).toBe('Ty')
  })

  it('falls back when empty', () => {
    expect(firstName('')).toBe('there')
    expect(firstName(null, 'operator')).toBe('operator')
  })
})

describe('workingDirLeaf', () => {
  it('returns the last path segment', () => {
    expect(workingDirLeaf('/Users/tylerdevries/Dev/stillpoint-builders')).toBe('stillpoint-builders')
  })

  it('returns empty for missing paths', () => {
    expect(workingDirLeaf(null)).toBe('')
    expect(workingDirLeaf('')).toBe('')
  })
})

describe('toActivityMs', () => {
  it('normalizes seconds and milliseconds', () => {
    expect(toActivityMs(undefined)).toBe(0)
    expect(toActivityMs(0)).toBe(0)
    expect(toActivityMs(100)).toBe(100_000)
    expect(toActivityMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-09-02T12:00:00Z')

  it('returns now for recent timestamps', () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe('now')
  })

  it('formats hours and days', () => {
    expect(relativeTime(now / 1000 - 3 * 3600, now)).toBe('3h ago')
    expect(relativeTime(now / 1000 - 3 * 86400, now)).toBe('3d ago')
  })

  it('returns empty for missing timestamps', () => {
    expect(relativeTime(0, now)).toBe('')
  })
})

describe('sessionStatusPill', () => {
  it('prefers review when a PR is present', () => {
    expect(sessionStatusPill({ active: true, hasPr: true })).toBe('ready_for_review')
  })

  it('marks active sessions without a PR', () => {
    expect(sessionStatusPill({ active: true })).toBe('active')
  })

  it('marks idle sessions', () => {
    expect(sessionStatusPill({ active: false })).toBe('idle')
  })
})

describe('pullStatusLabel', () => {
  it('labels open as ready for review', () => {
    expect(pullStatusLabel('open')).toBe('Ready for review')
  })
})

describe('modelPickerLabel', () => {
  it('humanizes Claude catalog ids', () => {
    expect(modelPickerLabel('opus', 'anthropic/claude-opus-4-6')).toBe('Opus 4.6')
    expect(modelPickerLabel('haiku', 'anthropic/claude-haiku-4-5')).toBe('Haiku 4.5')
  })

  it('falls back to alias', () => {
    expect(modelPickerLabel('groq', 'groq/llama-3.3-70b-versatile')).toBe('groq')
  })
})

describe('pins', () => {
  it('parses and toggles slugs', () => {
    expect(parsePins('["actz-may"]')).toEqual(['actz-may'])
    expect(parsePins('nope')).toEqual([])
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b'])
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b'])
  })
})
