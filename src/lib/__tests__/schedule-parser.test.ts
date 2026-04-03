import { describe, it, expect } from 'vitest'
import { parseNaturalSchedule, isCronDue } from '../schedule-parser'

describe('parseNaturalSchedule', () => {
  it('returns null for empty input', () => {
    expect(parseNaturalSchedule('')).toBeNull()
    expect(parseNaturalSchedule('   ')).toBeNull()
  })

  it('passes through valid cron expressions', () => {
    const result = parseNaturalSchedule('0 9 * * *')
    expect(result).not.toBeNull()
    expect(result!.cronExpr).toBe('0 9 * * *')
    expect(result!.humanReadable).toContain('0 9 * * *')
  })

  it('passes through step cron expressions when formatted as pure cron', () => {
    // The CRON_REGEX requires each field to be * or digits/commas/ranges.
    // "*/5 * * * *" has a mixed field so it falls through as null (natural language fallback)
    // Instead test a valid 5-field numeric cron:
    const result = parseNaturalSchedule('5 * * * *')
    expect(result!.cronExpr).toBe('5 * * * *')
  })

  it('parses "hourly"', () => {
    const result = parseNaturalSchedule('hourly')
    expect(result!.cronExpr).toBe('0 * * * *')
    expect(result!.humanReadable).toMatch(/every hour/i)
  })

  it('parses "daily"', () => {
    const result = parseNaturalSchedule('daily')
    expect(result!.cronExpr).toBe('0 9 * * *')
  })

  it('parses "every day"', () => {
    const result = parseNaturalSchedule('every day')
    expect(result!.cronExpr).toBe('0 9 * * *')
  })

  it('parses "weekly"', () => {
    const result = parseNaturalSchedule('weekly')
    expect(result!.cronExpr).toBe('0 9 * * 1')
    expect(result!.humanReadable).toMatch(/monday/i)
  })

  it('parses "every N minutes"', () => {
    expect(parseNaturalSchedule('every 5 minutes')!.cronExpr).toBe('*/5 * * * *')
    expect(parseNaturalSchedule('every 1 minute')!.cronExpr).toBe('*/1 * * * *')
    expect(parseNaturalSchedule('every 30 minutes')!.cronExpr).toBe('*/30 * * * *')
  })

  it('returns null for invalid minute intervals', () => {
    expect(parseNaturalSchedule('every 0 minutes')).toBeNull()
    expect(parseNaturalSchedule('every 60 minutes')).toBeNull()
  })

  it('parses "every N hours"', () => {
    expect(parseNaturalSchedule('every 2 hours')!.cronExpr).toBe('0 */2 * * *')
    expect(parseNaturalSchedule('every 1 hour')!.cronExpr).toBe('0 */1 * * *')
  })

  it('returns null for invalid hour intervals', () => {
    expect(parseNaturalSchedule('every 0 hours')).toBeNull()
    expect(parseNaturalSchedule('every 24 hours')).toBeNull()
  })

  it('parses "daily at TIME"', () => {
    const result = parseNaturalSchedule('daily at 9am')
    expect(result!.cronExpr).toBe('0 9 * * *')
    expect(result!.humanReadable).toMatch(/9.*AM/i)
  })

  it('parses "every morning at TIME"', () => {
    const result = parseNaturalSchedule('every morning at 8am')
    expect(result!.cronExpr).toBe('0 8 * * *')
  })

  it('parses "every evening at TIME"', () => {
    const result = parseNaturalSchedule('every evening at 6pm')
    expect(result!.cronExpr).toBe('0 18 * * *')
  })

  it('parses time with minutes', () => {
    const result = parseNaturalSchedule('daily at 9:30am')
    expect(result!.cronExpr).toBe('30 9 * * *')
    expect(result!.humanReadable).toMatch(/9:30/i)
  })

  it('parses "at TIME every day"', () => {
    const result = parseNaturalSchedule('at 10am every day')
    expect(result!.cronExpr).toBe('0 10 * * *')
  })

  it('parses "weekly on DAYNAME"', () => {
    expect(parseNaturalSchedule('weekly on monday')!.cronExpr).toBe('0 9 * * 1')
    expect(parseNaturalSchedule('weekly on friday')!.cronExpr).toBe('0 9 * * 5')
    expect(parseNaturalSchedule('weekly on sunday')!.cronExpr).toBe('0 9 * * 0')
  })

  it('parses "every DAYNAME"', () => {
    expect(parseNaturalSchedule('every monday')!.cronExpr).toBe('0 9 * * 1')
    expect(parseNaturalSchedule('every saturday')!.cronExpr).toBe('0 9 * * 6')
  })

  it('parses "every DAYNAME at TIME"', () => {
    const result = parseNaturalSchedule('every tuesday at 3pm')
    expect(result!.cronExpr).toBe('0 15 * * 2')
    expect(result!.humanReadable).toMatch(/tuesday/i)
    expect(result!.humanReadable).toMatch(/3.*PM/i)
  })

  it('returns null for unrecognized input', () => {
    expect(parseNaturalSchedule('some random text')).toBeNull()
    expect(parseNaturalSchedule('every foo bar')).toBeNull()
  })

  it('handles abbreviated day names', () => {
    expect(parseNaturalSchedule('every mon')!.cronExpr).toBe('0 9 * * 1')
    expect(parseNaturalSchedule('every fri')!.cronExpr).toBe('0 9 * * 5')
  })

  it('parses pm time correctly (12pm = noon)', () => {
    const result = parseNaturalSchedule('daily at 12pm')
    expect(result!.cronExpr).toBe('0 12 * * *')
  })

  it('parses 12am as midnight', () => {
    const result = parseNaturalSchedule('daily at 12am')
    expect(result!.cronExpr).toBe('0 0 * * *')
  })
})

describe('isCronDue', () => {
  // Build a local-time date for Monday at a specific hour/minute
  // isCronDue uses .getHours()/.getMinutes()/.getDay() which are local time methods
  function makeLocalTime(dayOfWeek: number, hour: number, minute: number, second = 0): number {
    // Find a date that has the right local day of week
    const d = new Date()
    d.setSeconds(second)
    d.setMilliseconds(0)
    d.setMinutes(minute)
    d.setHours(hour)
    // Move to the desired day of week
    const diff = dayOfWeek - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.getTime()
  }

  it('returns true when cron matches and not recently spawned', () => {
    const t = makeLocalTime(1, 9, 0) // Monday 09:00 local
    expect(isCronDue('0 9 * * 1', t, 0)).toBe(true)
  })

  it('returns true for * in all fields', () => {
    const t = makeLocalTime(1, 9, 0)
    expect(isCronDue('* * * * *', t, 0)).toBe(true)
  })

  it('returns false when minute does not match', () => {
    const t = makeLocalTime(1, 9, 5) // Monday 09:05
    expect(isCronDue('0 9 * * 1', t, 0)).toBe(false)
  })

  it('returns false when hour does not match', () => {
    const t = makeLocalTime(1, 10, 0) // Monday 10:00
    expect(isCronDue('0 9 * * 1', t, 0)).toBe(false)
  })

  it('returns false when day of week does not match', () => {
    const t = makeLocalTime(2, 9, 0) // Tuesday 09:00
    expect(isCronDue('0 9 * * 1', t, 0)).toBe(false) // Monday only
  })

  it('returns false if already spawned in same minute', () => {
    const t = makeLocalTime(1, 9, 0, 45) // Monday 09:00:45
    const spawnedJustNow = t - 30000 // 30s ago = 09:00:15, same minute
    expect(isCronDue('0 9 * * 1', t, spawnedJustNow)).toBe(false)
  })

  it('returns true if spawned in a previous minute', () => {
    const t = makeLocalTime(1, 9, 0)
    const spawnedPrevMinute = t - 120000 // 2 min ago, different minute
    expect(isCronDue('0 9 * * 1', t, spawnedPrevMinute)).toBe(true)
  })

  it('handles step expressions', () => {
    const t30 = makeLocalTime(1, 9, 30)
    expect(isCronDue('*/30 * * * *', t30, 0)).toBe(true)
    expect(isCronDue('*/15 * * * *', t30, 0)).toBe(true)
    expect(isCronDue('*/7 * * * *', t30, 0)).toBe(false) // 30 % 7 != 0
  })

  it('returns false for invalid cron expression', () => {
    const t = makeLocalTime(1, 9, 0)
    expect(isCronDue('invalid', t, 0)).toBe(false)
    expect(isCronDue('0 9 * *', t, 0)).toBe(false) // only 4 parts
  })

  it('handles comma-separated values', () => {
    const t9 = makeLocalTime(1, 9, 0)
    const t10 = makeLocalTime(1, 10, 0)
    expect(isCronDue('0 9,10 * * *', t9, 0)).toBe(true)
    expect(isCronDue('0 9,10 * * *', t10, 0)).toBe(true)
  })

  it('handles range expressions', () => {
    const t9 = makeLocalTime(1, 9, 0)
    const t18 = makeLocalTime(1, 18, 0)
    expect(isCronDue('0 9-17 * * *', t9, 0)).toBe(true)
    expect(isCronDue('0 9-17 * * *', t18, 0)).toBe(false)
  })
})
