import type { CronJob } from '@/store'

export interface NewJobForm {
  name: string
  schedule: string
  command: string
  description: string
  model: string
}

export type CalendarViewMode = 'agenda' | 'day' | 'week' | 'month'

export interface CalendarOccurrence {
  job: CronJob
  atMs: number
  dayKey: string
}

export interface DayJobEntry {
  job: CronJob
  atMs: number
}

export interface DayWithJobs {
  date: Date
  jobs: DayJobEntry[]
}

export const predefinedSchedules = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Daily at 6 AM', value: '0 6 * * *' },
  { label: 'Weekly (Sunday)', value: '0 0 * * 0' },
  { label: 'Monthly (1st)', value: '0 0 1 * *' },
]

// Date utility functions
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function getWeekStart(date: Date): Date {
  const day = date.getDay()
  const diffToMonday = (day + 6) % 7
  return addDays(startOfDay(date), -diffToMonday)
}

export function getMonthStartGrid(date: Date): Date {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const day = firstOfMonth.getDay()
  return addDays(firstOfMonth, -day)
}

export function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatRelativeTime(timestamp: string | number, future = false) {
  const now = new Date().getTime()
  const time = new Date(timestamp).getTime()
  const diff = future ? time - now : now - time

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ${future ? 'from now' : 'ago'}`
  return future ? 'soon' : 'just now'
}

export function getStatusColor(status?: string) {
  switch (status) {
    case 'success': return 'text-green-400'
    case 'error': return 'text-red-400'
    case 'running': return 'text-blue-400'
    default: return 'text-muted-foreground'
  }
}

export function getStatusBg(status?: string) {
  switch (status) {
    case 'success': return 'bg-green-500/20'
    case 'error': return 'bg-red-500/20'
    case 'running': return 'bg-blue-500/20'
    default: return 'bg-gray-500/20'
  }
}
