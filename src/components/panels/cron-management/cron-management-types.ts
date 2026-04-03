import { CronJob } from '@/store'

export type { CronJob }

export interface DayJobSummary {
  job: CronJob
  runCount: number
  firstRunMs: number
}

export interface NewJobForm {
  name: string
  schedule: string
  command: string
  description: string
  model: string
  staggerSeconds: string
}

export interface FormErrors {
  name?: string
  schedule?: string
  command?: string
  model?: string
  staggerSeconds?: string
}

export interface RunHistoryEntry {
  jobId: string
  status: string
  deliveryStatus?: string
  timestamp?: number
  startedAtMs?: number
  durationMs?: number
  error?: string
}

export type ScheduleKindFilter = 'all' | 'at' | 'every' | 'cron'
export type SortField = 'name' | 'schedule' | 'lastRun' | 'nextRun'
export type SortDir = 'asc' | 'desc'
export type CalendarViewMode = 'agenda' | 'day' | 'week' | 'month'

export const AGENT_COLORS = [
  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
]

export function getAgentColorClass(agentId: string, allAgents: string[]): string {
  const idx = allAgents.indexOf(agentId)
  return AGENT_COLORS[idx >= 0 ? idx % AGENT_COLORS.length : 0]
}

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

export function getStatusColor(status?: string): string {
  switch (status) {
    case 'success': return 'text-green-400'
    case 'error': return 'text-red-400'
    case 'running': return 'text-blue-400'
    default: return 'text-muted-foreground'
  }
}

export function getStatusBg(status?: string): string {
  switch (status) {
    case 'success': return 'bg-green-500/20'
    case 'error': return 'bg-red-500/20'
    case 'running': return 'bg-blue-500/20'
    default: return 'bg-gray-500/20'
  }
}
