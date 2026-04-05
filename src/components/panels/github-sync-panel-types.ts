// Shared types for GitHub Sync Panel and its sub-components

export interface GitHubLabel {
  name: string
  color?: string
}

export interface GitHubIssue {
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: GitHubLabel[]
  assignee: { login: string } | null
  html_url: string
  created_at: string
  updated_at: string
}

export interface SyncRecord {
  id: number
  repo: string
  last_synced_at: number
  issue_count: number
  sync_direction: string
  status: string
  error: string | null
  created_at: number
}

export interface LinkedTask {
  id: number
  title: string
  status: string
  priority: string
  metadata: {
    github_repo?: string
    github_issue_number?: number
    github_issue_url?: string
    github_synced_at?: string
    github_state?: string
  }
}

export interface Project {
  id: number
  name: string
  github_repo?: string
  github_sync_enabled?: boolean
  github_labels_initialized?: boolean
}

export interface SyncResult {
  imported: number
  skipped: number
  errors: number
}

export interface TokenStatus {
  connected: boolean
  user?: string
}

export interface FeedbackState {
  ok: boolean
  text: string
}
