import { describe, it, expect } from 'vitest'
import { isSubDailyCron, formatDateSuffix } from '@/lib/recurring-tasks'

describe('isSubDailyCron', () => {
  it('flags hourly crons (`0 * * * *`)', () => {
    expect(isSubDailyCron('0 * * * *')).toBe(true)
  })

  it('flags every-5-min crons (`*/5 * * * *`)', () => {
    expect(isSubDailyCron('*/5 * * * *')).toBe(true)
  })

  it('flags every-minute crons (`* * * * *`)', () => {
    expect(isSubDailyCron('* * * * *')).toBe(true)
  })

  it('flags ranged-minute crons (`0,30 * * * *`)', () => {
    expect(isSubDailyCron('0,30 * * * *')).toBe(true)
  })

  it('treats daily-at-09:00 as not sub-daily', () => {
    expect(isSubDailyCron('0 9 * * *')).toBe(false)
  })

  it('treats weekly Mon-09:00 as not sub-daily', () => {
    expect(isSubDailyCron('0 9 * * 1')).toBe(false)
  })

  it('returns false for malformed expressions (defensive)', () => {
    expect(isSubDailyCron('not-a-cron')).toBe(false)
    expect(isSubDailyCron('')).toBe(false)
    expect(isSubDailyCron('0 9 *')).toBe(false)
  })
})

describe('formatDateSuffix', () => {
  // Pin a known date so test output is deterministic across machines/timezones
  // we run the test in. We use a Date constructed via individual setters so
  // local-time interpretation matches what the suffix uses.
  const fixedDate = new Date(2026, 3, 24, 13, 35) // 2026-04-24 13:35 local

  it('returns MMM DD for daily/weekly/monthly crons', () => {
    expect(formatDateSuffix(fixedDate, false)).toBe('Apr 24')
  })

  it('returns MMM DD, HH:MM for sub-daily crons', () => {
    expect(formatDateSuffix(fixedDate, true)).toBe('Apr 24, 13:35')
  })

  it('zero-pads day-of-month', () => {
    const earlyMonth = new Date(2026, 0, 3, 9, 5) // Jan 3, 09:05
    expect(formatDateSuffix(earlyMonth, false)).toBe('Jan 03')
    expect(formatDateSuffix(earlyMonth, true)).toBe('Jan 03, 09:05')
  })

  it('regression #616: two hourly spawns on the same day produce different titles', () => {
    const at13 = new Date(2026, 3, 24, 13, 0)
    const at14 = new Date(2026, 3, 24, 14, 0)
    const t13 = `Memory Consolidation - ${formatDateSuffix(at13, true)}`
    const t14 = `Memory Consolidation - ${formatDateSuffix(at14, true)}`
    // Before the fix both would have been "Memory Consolidation - Apr 24"
    // and the second spawn would have been silently skipped.
    expect(t13).not.toBe(t14)
  })

  it('regression #616: every-5-min spawns within an hour produce different titles', () => {
    const at1300 = new Date(2026, 3, 24, 13, 0)
    const at1305 = new Date(2026, 3, 24, 13, 5)
    expect(formatDateSuffix(at1300, true)).not.toBe(formatDateSuffix(at1305, true))
  })

  it('daily cron preserves historical "MMM DD" shape (no churn for existing operators)', () => {
    const morningSpawn = new Date(2026, 3, 24, 9, 0)
    const lateAfternoonSpawn = new Date(2026, 3, 24, 17, 0)
    // Both spawns produce the same suffix when the cron is daily — that's
    // intentional because a daily cron only fires once per calendar day, so
    // the dedup correctly skips a duplicate within the same day.
    expect(formatDateSuffix(morningSpawn, false)).toBe(formatDateSuffix(lateAfternoonSpawn, false))
  })
})
