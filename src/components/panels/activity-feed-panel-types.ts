// Types, constants, and pure utilities for ActivityFeedPanel.
// Kept separate so sub-components can import without circular deps.
// Re-export the store's Activity type to avoid a duplicate definition —
// the store is the single source of truth for this shape.
import type { Activity } from '@/store/slices/task-slice'
export type { Activity } from '@/store/slices/task-slice'

export interface SessionInfo {
  id: string
  key: string
  kind: string
  age: string
  model: string
  tokens: string
  active: boolean
}

export interface FeedFilter {
  type: string
  limit: number
}

// Symbol representing each activity type in the UI
export const activityIcons: Readonly<Record<string, string>> = {
  task_created: '+',
  task_updated: '~',
  task_deleted: 'x',
  comment_added: '#',
  agent_created: '@',
  agent_status_change: '~',
  standup_generated: '!',
  mention: '>',
  assignment: '=',
}

// Tailwind colour class per activity type
export const activityColors: Readonly<Record<string, string>> = {
  task_created: 'text-green-400',
  task_updated: 'text-blue-400',
  task_deleted: 'text-red-400',
  comment_added: 'text-purple-400',
  agent_created: 'text-cyan-400',
  agent_status_change: 'text-yellow-400',
  standup_generated: 'text-orange-400',
  mention: 'text-pink-400',
  assignment: 'text-indigo-400',
}

/** Human-readable relative timestamp (e.g. "3m ago", "2d ago"). */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp * 1000
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

/** Group an activity list into a day-keyed map (immutable — creates new object). */
export function groupByDay(activities: Activity[]): Record<string, Activity[]> {
  return activities.reduce<Record<string, Activity[]>>((acc, act) => {
    const day = new Date(act.created_at * 1000).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
    return { ...acc, [day]: [...(acc[day] ?? []), act] }
  }, {})
}
