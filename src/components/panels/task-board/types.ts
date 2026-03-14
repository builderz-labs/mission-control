export interface Task {
  id: number
  title: string
  description?: string
  status: 'inbox' | 'assigned' | 'in_progress' | 'review' | 'quality_review' | 'done'
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent'
  assigned_to?: string
  created_by: string
  created_at: number
  updated_at: number
  due_date?: number
  estimated_hours?: number
  actual_hours?: number
  tags?: string[]
  metadata?: any
  aegisApproved?: boolean
  project_id?: number
  project_ticket_no?: number
  project_name?: string
  project_prefix?: string
  ticket_ref?: string
}

export interface Comment {
  id: number
  task_id: number
  author: string
  content: string
  created_at: number
  parent_id?: number
  mentions?: string[]
  replies?: Comment[]
}

export interface Project {
  id: number
  name: string
  slug: string
  ticket_prefix: string
  status: 'active' | 'archived'
}

export interface MentionOption {
  handle: string
  recipient: string
  type: 'user' | 'agent'
  display: string
  role?: string
}

export const statusColumns = [
  { key: 'inbox', title: 'Inbox', color: 'bg-secondary text-foreground' },
  { key: 'assigned', title: 'Assigned', color: 'bg-blue-500/20 text-blue-400' },
  { key: 'in_progress', title: 'In Progress', color: 'bg-yellow-500/20 text-yellow-400' },
  { key: 'review', title: 'Review', color: 'bg-purple-500/20 text-purple-400' },
  { key: 'quality_review', title: 'Quality Review', color: 'bg-indigo-500/20 text-indigo-400' },
  { key: 'done', title: 'Done', color: 'bg-green-500/20 text-green-400' },
]

export const priorityColors: Record<string, string> = {
  low: 'border-green-500',
  medium: 'border-yellow-500',
  high: 'border-orange-500',
  critical: 'border-red-500',
}

export function formatTaskTimestamp(timestamp: number) {
  const now = new Date().getTime()
  const time = new Date(timestamp * 1000).getTime()
  const diff = now - time

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'just now'
}

export function getTagColor(tag: string) {
  const lowerTag = tag.toLowerCase()
  if (lowerTag.includes('urgent') || lowerTag.includes('critical')) {
    return 'bg-red-500/20 text-red-400 border-red-500/30'
  }
  if (lowerTag.includes('bug') || lowerTag.includes('fix')) {
    return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
  }
  if (lowerTag.includes('feature') || lowerTag.includes('enhancement')) {
    return 'bg-green-500/20 text-green-400 border-green-500/30'
  }
  if (lowerTag.includes('research') || lowerTag.includes('analysis')) {
    return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
  }
  if (lowerTag.includes('deploy') || lowerTag.includes('release')) {
    return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  }
  return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
}
