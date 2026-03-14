export function describeCronFrequency(schedule: string): string {
  if (!schedule) return 'no schedule'
  const parts = schedule.replace(/\s*\([^)]+\)$/, '').trim().split(/\s+/)
  if (parts.length !== 5) return schedule

  const [minute, hour, dom, mon, dow] = parts

  // Every minute
  if (minute === '*' && hour === '*') return 'every minute'
  // Every N minutes
  if (minute.startsWith('*/') && hour === '*') return `every ${minute.slice(2)}m`
  // Every hour at :MM
  if (/^\d+$/.test(minute) && hour === '*') return `hourly at :${minute.padStart(2, '0')}`
  // Every N hours
  if (/^\d+$/.test(minute) && hour.startsWith('*/')) return `every ${hour.slice(2)}h`
  // Specific hour(s) daily
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
    const h = Number(hour)
    const m = Number(minute)
    const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
    if (dow !== '*') return `${time} (select days)`
    return `daily at ${time}`
  }
  // Weekly
  if (dom === '*' && mon === '*' && dow !== '*') return 'weekly'
  // Monthly
  if (dom !== '*' && mon === '*' && dow === '*') return 'monthly'

  return schedule
}

export function validateCronExpression(expr: string): string | null {
  if (!expr || !expr.trim()) return 'Cron expression is required'

  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return `Expected 5 fields, got ${parts.length}`

  const fieldNames = ['minute', 'hour', 'day of month', 'month', 'day of week']
  const maxValues = [59, 23, 31, 12, 7]
  const minValues = [0, 0, 1, 1, 0]

  for (let i = 0; i < 5; i++) {
    const field = parts[i]
    if (field === '*') continue

    // Step values: */N
    if (field.startsWith('*/')) {
      const step = Number(field.slice(2))
      if (isNaN(step) || step < 1) return `Invalid step value in ${fieldNames[i]}: ${field}`
      continue
    }

    // Comma-separated values and ranges
    const segments = field.split(',')
    for (const segment of segments) {
      // Range: N-M
      const rangeParts = segment.split('-')
      for (const part of rangeParts) {
        const num = Number(part)
        if (isNaN(num)) return `Invalid value in ${fieldNames[i]}: ${part}`
        if (num < minValues[i] || num > maxValues[i]) {
          return `${fieldNames[i]} value ${num} out of range (${minValues[i]}-${maxValues[i]})`
        }
      }
    }
  }

  return null
}

export function generateCloneName(name: string, existingNames: string[]): string {
  const existing = new Set(existingNames.map(n => n.toLowerCase()))
  let cloneName = `${name} (copy)`
  let counter = 2
  while (existing.has(cloneName.toLowerCase())) {
    cloneName = `${name} (copy ${counter})`
    counter++
  }
  return cloneName
}
