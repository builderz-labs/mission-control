// Pure utility functions for Cron Management — no React, no side effects

import { CronJob } from '@/store'
import {
  NewJobForm,
  FormErrors,
  ScheduleKindFilter,
  SortField,
  SortDir,
} from './cron-management-types'

// ── Time formatting ────────────────────────────────────────────────────────────

export function formatRelativeTime(timestamp: string | number, future = false): string {
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

// ── Form validation ────────────────────────────────────────────────────────────

const CRON_FIELD_PATTERN = /^(\*|(\*\/\d+)|(\d+(-\d+)?(,\d+(-\d+)?)*))(\/\d+)?$/

export function validateForm(form: NewJobForm, availableModels: string[]): FormErrors {
  const errors: FormErrors = {}

  if (!form.name.trim()) errors.name = 'Job name is required'
  if (!form.command.trim()) errors.command = 'Command is required'

  const cronParts = form.schedule.trim().split(/\s+/)
  if (cronParts.length !== 5) {
    errors.schedule = 'Must be 5 fields: minute hour day month weekday'
  } else {
    for (const part of cronParts) {
      if (!CRON_FIELD_PATTERN.test(part)) {
        errors.schedule = `Invalid cron field: "${part}"`
        break
      }
    }
  }

  if (form.model.trim() && availableModels.length > 0) {
    if (!availableModels.includes(form.model.trim())) {
      const preview = availableModels.slice(0, 3).join(', ')
      const suffix = availableModels.length > 3 ? '...' : ''
      errors.model = `Unknown model. Available: ${preview}${suffix}`
    }
  }

  if (form.staggerSeconds.trim()) {
    const val = Number(form.staggerSeconds)
    if (!Number.isFinite(val) || val <= 0) {
      errors.staggerSeconds = 'Must be a positive number'
    }
  }

  return errors
}

// ── Job filtering and sorting ──────────────────────────────────────────────────

interface FilterOptions {
  searchQuery: string
  agentFilter: string
  stateFilter: 'all' | 'enabled' | 'disabled'
  scheduleKindFilter: ScheduleKindFilter
  sortField: SortField
  sortDir: SortDir
}

export function filterAndSortJobs(jobs: CronJob[], opts: FilterOptions): CronJob[] {
  const { searchQuery, agentFilter, stateFilter, scheduleKindFilter, sortField, sortDir } = opts

  return jobs
    .filter((job) => typeof job.schedule === 'string' && job.schedule.length > 0)
    .filter((job) => {
      const query = searchQuery.trim().toLowerCase()
      const matchesQuery =
        !query ||
        job.name.toLowerCase().includes(query) ||
        job.command.toLowerCase().includes(query) ||
        (job.agentId || '').toLowerCase().includes(query) ||
        (job.model || '').toLowerCase().includes(query)

      const matchesAgent = agentFilter === 'all' || (job.agentId || '') === agentFilter

      const matchesState =
        stateFilter === 'all' ||
        (stateFilter === 'enabled' && job.enabled) ||
        (stateFilter === 'disabled' && !job.enabled)

      let matchesKind = true
      if (scheduleKindFilter !== 'all') {
        const sched = job.schedule.toLowerCase()
        if (scheduleKindFilter === 'cron') {
          matchesKind = sched.replace(/\s*\([^)]+\)$/, '').trim().split(/\s+/).length === 5
        } else if (scheduleKindFilter === 'every') {
          matchesKind = sched.startsWith('every') || sched.includes('*/')
        } else if (scheduleKindFilter === 'at') {
          matchesKind = sched.startsWith('at ') || /^\d{4}-/.test(sched)
        }
      }

      return matchesQuery && matchesAgent && matchesState && matchesKind
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortField) {
        case 'name': return dir * a.name.localeCompare(b.name)
        case 'schedule': return dir * (a.schedule || '').localeCompare(b.schedule || '')
        case 'lastRun': return dir * ((a.lastRun || 0) - (b.lastRun || 0))
        case 'nextRun': return dir * ((a.nextRun || 0) - (b.nextRun || 0))
        default: return 0
      }
    })
}
