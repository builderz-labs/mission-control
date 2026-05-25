export interface CronOccurrence {
  atMs: number
  dayKey: string
}

interface ParsedField {
  any: boolean
  matches: (value: number) => boolean
}

interface ParsedCron {
  minute: ParsedField
  hour: ParsedField
  dayOfMonth: ParsedField
  month: ParsedField
  dayOfWeek: ParsedField
}

function normalizeCronExpression(raw: string): string {
  const trimmed = raw.trim()
  const tzSuffixMatch = trimmed.match(/^(.*)\s+\([^)]+\)$/)
  return (tzSuffixMatch?.[1] || trimmed).trim()
}

function parseToken(token: string, min: number, max: number): { any: boolean; values: Set<number> } {
  const valueSet = new Set<number>()
  const trimmed = token.trim()
  if (trimmed === '*') {
    for (let i = min; i <= max; i += 1) valueSet.add(i)
    return { any: true, values: valueSet }
  }

  for (const part of trimmed.split(',')) {
    const section = part.trim()
    if (!section) continue

    const [rangePart, stepPart] = section.split('/')
    const step = stepPart ? Number(stepPart) : 1
    if (!Number.isFinite(step) || step <= 0) continue

    if (rangePart === '*') {
      for (let i = min; i <= max; i += step) valueSet.add(i)
      continue
    }

    if (/-/.test(rangePart)) {
      const [fromRaw, toRaw] = rangePart.split('-')
      const from = Number(fromRaw)
      const to = Number(toRaw)
      if (!Number.isFinite(from) || !Number.isFinite(to)) continue
      const start = Math.max(min, Math.min(max, from))
      const end = Math.max(min, Math.min(max, to))
      for (let i = start; i <= end; i += step) valueSet.add(i)
      continue
    }

    const single = Number(rangePart)
    if (!Number.isFinite(single)) continue
    if (single >= min && single <= max) valueSet.add(single)
  }

  return { any: false, values: valueSet }
}

function parseField(token: string, min: number, max: number): ParsedField {
  const parsed = parseToken(token, min, max)
  return {
    any: parsed.any,
    matches: (value: number) => parsed.values.has(value),
  }
}

function parseCron(raw: string): ParsedCron | null {
  const normalized = normalizeCronExpression(raw)
  const parts = normalized.split(/\s+/).filter(Boolean)
  if (parts.length !== 5) return null

  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  }
}

function matchesDay(parsed: ParsedCron, date: Date): boolean {
  const dayOfMonthMatches = parsed.dayOfMonth.matches(date.getDate())
  const dayOfWeekMatches = parsed.dayOfWeek.matches(date.getDay())

  if (parsed.dayOfMonth.any && parsed.dayOfWeek.any) return true
  if (parsed.dayOfMonth.any) return dayOfWeekMatches
  if (parsed.dayOfWeek.any) return dayOfMonthMatches
  return dayOfMonthMatches || dayOfWeekMatches
}

export function buildDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getCronOccurrences(
  schedule: string,
  rangeStartMs: number,
  rangeEndMs: number,
  max = 1000
): CronOccurrence[] {
  if (!schedule || !Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs)) return []
  if (rangeEndMs <= rangeStartMs || max <= 0) return []

  const parsed = parseCron(schedule)
  if (!parsed) return []

  const occurrences: CronOccurrence[] = []
  const cursor = new Date(rangeStartMs)
  cursor.setSeconds(0, 0)
  if (cursor.getTime() < rangeStartMs) {
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
  }

  while (cursor.getTime() < rangeEndMs && occurrences.length < max) {
    if (
      parsed.month.matches(cursor.getMonth() + 1) &&
      matchesDay(parsed, cursor) &&
      parsed.hour.matches(cursor.getHours()) &&
      parsed.minute.matches(cursor.getMinutes())
    ) {
      occurrences.push({
        atMs: cursor.getTime(),
        dayKey: buildDayKey(cursor),
      })
    }
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
  }

  return occurrences
}
