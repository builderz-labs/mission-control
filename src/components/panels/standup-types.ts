// Types shared across standup panel sub-components

export interface StandupSummary {
  totalAgents: number
  totalCompleted: number
  totalInProgress: number
  totalAssigned: number
  totalReview: number
  totalBlocked: number
  totalActivity: number
  overdue: number
}

export interface StandupTask {
  id: number
  title: string
  status: string
}

export interface StandupTaskWithUpdated extends StandupTask {
  updated_at: number
}

export interface StandupTaskWithDue extends StandupTask {
  created_at: number
  due_date?: number
}

export interface StandupAssignedTask extends StandupTaskWithDue {
  priority: string
}

export interface StandupBlockedTask extends StandupTask {
  priority: string
  created_at: number
  metadata?: unknown
}

export interface AgentInfo {
  name: string
  role: string
  status: string
  last_seen?: number
  last_activity?: string
}

export interface AgentReport {
  agent: AgentInfo
  completedToday: StandupTaskWithUpdated[]
  inProgress: StandupTaskWithDue[]
  assigned: StandupAssignedTask[]
  review: StandupTaskWithUpdated[]
  blocked: StandupBlockedTask[]
  activity: {
    actionCount: number
    commentsCount: number
  }
}

export interface TeamAccomplishment {
  id: number
  title: string
  agent: string
  updated_at: number
}

export interface TeamBlocker {
  id: number
  title: string
  priority: string
  agent: string
  created_at: number
}

export interface OverdueTask {
  id: number
  title: string
  due_date: number
  status: string
  agent_name?: string
}

export interface StandupReport {
  date: string
  generatedAt: string
  summary: StandupSummary
  agentReports: AgentReport[]
  teamAccomplishments: TeamAccomplishment[]
  teamBlockers: TeamBlocker[]
  overdueTasks: OverdueTask[]
}

export interface StandupHistory {
  id: number
  date: string
  generatedAt: string
  summary: {
    completed?: number
    inProgress?: number
    blocked?: number
  }
  agentCount: number
}

// WHY: Centralised colour map avoids duplicated priority→colour logic across components
export const PRIORITY_COLORS: Readonly<Record<string, string>> = {
  low: 'text-green-400',
  medium: 'text-yellow-400',
  high: 'text-orange-400',
  urgent: 'text-red-400',
} as const

export function getPriorityColor(priority: string): string {
  return PRIORITY_COLORS[priority] ?? 'text-muted-foreground'
}

export function formatDisplayDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}
