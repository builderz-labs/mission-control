/**
 * Natural Language Schedule Parser
 *
 * Converts human-readable scheduling expressions into cron expressions.
 * Zero dependencies — regex-based pattern matching.
 *
 * Supported patterns:
 *   "every N hours/minutes"    -> cron
 *   "daily" / "every day"      -> 0 9 * * *
 *   "every morning at Xam"     -> 0 X * * *
 *   "every evening at Xpm"     -> 0 (X+12) * * *
 *   "weekly on DAYNAME"        -> 0 9 * * DAY_NUM
 *   "every DAYNAME at TIME"    -> 0 H * * DAY_NUM
 *   "hourly"                   -> 0 * * * *
 *   fallback: treat as raw cron expression
 */

export interface ParsedSchedule {
  cronExpr: string
  humanReadable: string
}

const DAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

function parseDayName(input: string): number | null {
  return DAY_MAP[input.toLowerCase()] ?? null
}

function parseTimeExpr(input: string): { hour: number; minute: number } | null {
  // "9am", "9:30am", "9:30 pm", "14:00", "9", "21"
  const match = input.match(/^(\d{1,2})(?::(\d{2}))? ?(am|pm)?$/i)
  if (!match) return null
  let hour = parseInt(match[1], 10)
  const minute = match[2] ? parseInt(match[2], 10) : 0
  const ampm = match[3]?.toLowerCase()

  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

const CRON_REGEX = /^(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)\s+(\*|[\d,\-\/]+)$/

export function parseNaturalSchedule(input: string): ParsedSchedule | null {
  const trimmed = input.trim()
  if (trimmed.length > 256) return null
  const text = trimmed.replace(/\s+/g, ' ')
  if (!text) return null

  // Raw cron passthrough
  if (CRON_REGEX.test(text)) {
    return { cronExpr: text, humanReadable: `Custom schedule (${text})` }
  }

  const lower = text.toLowerCase()

  // "hourly"
  if (lower === 'hourly') {
    return { cronExpr: '0 * * * *', humanReadable: 'Every hour' }
  }

  // "daily" / "every day"
  if (lower === 'daily' || lower === 'every day') {
    return { cronExpr: '0 9 * * *', humanReadable: 'Daily at 9:00 AM' }
  }

  // "weekly" (no day specified)
  if (lower === 'weekly') {
    return { cronExpr: '0 9 * * 1', humanReadable: 'Weekly on Monday at 9:00 AM' }
  }

  // "every N minutes"
  const everyMinutes = lower.match(/^every (\d+) minutes?$/)
  if (everyMinutes) {
    const n = parseInt(everyMinutes[1], 10)
    if (n > 0 && n <= 59) {
      return { cronExpr: `*/${n} * * * *`, humanReadable: `Every ${n} minute${n > 1 ? 's' : ''}` }
    }
  }

  // "every N hours"
  const everyHours = lower.match(/^every (\d+) hours?$/)
  if (everyHours) {
    const n = parseInt(everyHours[1], 10)
    if (n > 0 && n <= 23) {
      return { cronExpr: `0 */${n} * * *`, humanReadable: `Every ${n} hour${n > 1 ? 's' : ''}` }
    }
  }

  // "every morning at TIME" / "every evening at TIME" / "every day at TIME" / "daily at TIME"
  const dailyAt = lower.match(/^(?:every (?:morning|evening|day)|daily) at (.+)$/)
  if (dailyAt) {
    const time = parseTimeExpr(dailyAt[1])
    if (time) {
      const label = time.hour < 12 ? 'AM' : 'PM'
      const displayHour = time.hour % 12 || 12
      const displayMin = time.minute > 0 ? `:${String(time.minute).padStart(2, '0')}` : ''
      return {
        cronExpr: `${time.minute} ${time.hour} * * *`,
        humanReadable: `Daily at ${displayHour}${displayMin} ${label}`,
      }
    }
  }

  // "at TIME every day"
  const atTimeDaily = lower.match(/^at (.+) every day$/)
  if (atTimeDaily) {
    const time = parseTimeExpr(atTimeDaily[1])
    if (time) {
      const label = time.hour < 12 ? 'AM' : 'PM'
      const displayHour = time.hour % 12 || 12
      const displayMin = time.minute > 0 ? `:${String(time.minute).padStart(2, '0')}` : ''
      return {
        cronExpr: `${time.minute} ${time.hour} * * *`,
        humanReadable: `Daily at ${displayHour}${displayMin} ${label}`,
      }
    }
  }

  // "weekly on DAYNAME" / "every DAYNAME"
  const weeklyOn = lower.match(/^(?:weekly on|every) (\w+)$/)
  if (weeklyOn) {
    const dayNum = parseDayName(weeklyOn[1])
    if (dayNum !== null) {
      const dayName = weeklyOn[1].charAt(0).toUpperCase() + weeklyOn[1].slice(1)
      return { cronExpr: `0 9 * * ${dayNum}`, humanReadable: `Weekly on ${dayName} at 9:00 AM` }
    }
  }

  // "every DAYNAME at TIME"
  const everyDayAt = lower.match(/^every (\w+) at (.+)$/)
  if (everyDayAt) {
    const dayNum = parseDayName(everyDayAt[1])
    if (dayNum !== null) {
      const time = parseTimeExpr(everyDayAt[2])
      if (time) {
        const dayName = everyDayAt[1].charAt(0).toUpperCase() + everyDayAt[1].slice(1)
        const label = time.hour < 12 ? 'AM' : 'PM'
        const displayHour = time.hour % 12 || 12
        const displayMin = time.minute > 0 ? `:${String(time.minute).padStart(2, '0')}` : ''
        return {
          cronExpr: `${time.minute} ${time.hour} * * ${dayNum}`,
          humanReadable: `Every ${dayName} at ${displayHour}${displayMin} ${label}`,
        }
      }
    }
  }

  return null
}

/** Check if a cron expression is due given a reference time and last spawn time */
export function isCronDue(cronExpr: string, nowMs: number, lastSpawnedAtMs: number): boolean {
  const now = new Date(nowMs)
  const parts = cronExpr.split(/\s+/)
  if (parts.length !== 5) return false

  const [minExpr, hourExpr, , , dowExpr] = parts

  // Check minute
  if (!matchesCronField(minExpr, now.getMinutes())) return false
  // Check hour
  if (!matchesCronField(hourExpr, now.getHours())) return false
  // Check day of week
  if (!matchesCronField(dowExpr, now.getDay())) return false

  // Prevent duplicate spawn within same minute
  if (lastSpawnedAtMs > 0) {
    const lastSpawn = new Date(lastSpawnedAtMs)
    if (
      lastSpawn.getFullYear() === now.getFullYear() &&
      lastSpawn.getMonth() === now.getMonth() &&
      lastSpawn.getDate() === now.getDate() &&
      lastSpawn.getHours() === now.getHours() &&
      lastSpawn.getMinutes() === now.getMinutes()
    ) {
      return false
    }
  }

  return true
}

function matchesCronField(expr: string, value: number): boolean {
  if (expr === '*') return true

  // Handle step values: */N
  if (expr.startsWith('*/')) {
    const step = parseInt(expr.slice(2), 10)
    return step > 0 && value % step === 0
  }

  // Handle comma-separated values
  const parts = expr.split(',')
  for (const part of parts) {
    // Handle ranges: N-M
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number)
      if (value >= start && value <= end) return true
    } else {
      if (parseInt(part, 10) === value) return true
    }
  }

  return false
}
