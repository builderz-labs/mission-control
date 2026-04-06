// Shared type definitions for the Task Board panel and all sub-components.
// Centralised here to avoid circular imports and keep each component focused.
import type { JsonValue } from '@/store/shared-types'

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
  metadata?: JsonValue
  aegisApproved?: boolean
  project_id?: number
  project_ticket_no?: number
  project_name?: string
  project_prefix?: string
  ticket_ref?: string
  github_issue_number?: number
  github_repo?: string
  github_branch?: string
  github_pr_number?: number
  github_pr_state?: string
}

export interface Agent {
  id: number
  name: string
  role: string
  status: 'offline' | 'idle' | 'busy' | 'error'
  taskStats?: {
    total: number
    assigned: number
    in_progress: number
    completed: number
  }
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

export interface SpawnFormData {
  task: string
  model: string
  label: string
  timeoutSeconds: number
}

export interface StatusColumn {
  key: string
  title: string
  color: string
}
