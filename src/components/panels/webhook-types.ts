// Types and constants shared across webhook panel sub-components

export interface Webhook {
  id: number
  name: string
  url: string
  secret: string | null
  events: string[]
  enabled: boolean
  last_fired_at: number | null
  last_status: number | null
  total_deliveries: number
  successful_deliveries: number
  failed_deliveries: number
  created_at: number
  updated_at: number
}

export interface Delivery {
  id: number
  webhook_id: number
  webhook_name: string
  webhook_url: string
  event_type: string
  payload: string
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  created_at: number
}

export interface SchedulerTask {
  id: string
  name: string
  enabled: boolean
  lastRun: number | null
  nextRun: number | null
  running: boolean
  lastResult?: { ok: boolean; message: string; timestamp: number }
}

export interface TestResult {
  success?: boolean
  error?: string
  duration_ms?: number
  status_code?: number
}

export interface WebhookCreateForm {
  name: string
  url: string
  events: string[]
}

// WHY: Event catalogue is configuration-level data; keeping it here avoids
//      re-declaring it in multiple component files.
export const AVAILABLE_EVENTS: ReadonlyArray<{ value: string; label: string; description: string }> = [
  { value: '*', label: 'All events', description: 'Receive all event types' },
  { value: 'agent.error', label: 'Agent error', description: 'Agent enters error state' },
  { value: 'agent.status_change', label: 'Agent status change', description: 'Any agent status transition' },
  { value: 'security.login_failed', label: 'Login failed', description: 'Failed login attempt' },
  { value: 'security.user_created', label: 'User created', description: 'New user account created' },
  { value: 'security.user_deleted', label: 'User deleted', description: 'User account deleted' },
  { value: 'security.password_change', label: 'Password changed', description: 'User password modified' },
  { value: 'notification.mention', label: 'Mention', description: 'Agent was @mentioned' },
  { value: 'notification.assignment', label: 'Assignment', description: 'Task assigned to agent' },
  { value: 'activity.task_created', label: 'Task created', description: 'New task added' },
  { value: 'activity.task_updated', label: 'Task updated', description: 'Task status changed' },
] as const

export function formatWebhookTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
