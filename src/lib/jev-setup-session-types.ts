export type JevSetupSessionStatus = 'draft' | 'ready' | 'archived'

export interface JevSetupSession {
  id: string
  workspace_id: number
  project_id: number
  created_by_user_id: number
  created_by_principal: string | null
  title: string
  provider: string
  model: string
  status: JevSetupSessionStatus
  primary_policy_id: number | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

export interface JevSetupMessage {
  id: number
  workspace_id: number
  session_id: string
  ordinal: number
  role: 'user' | 'assistant'
  content: string
  provider: string | null
  model: string | null
  status: 'complete' | 'error'
  created_at: number
}

export interface JevSetupRevision {
  id: number
  workspace_id: number
  session_id: string
  revision_no: number
  draft: unknown
  configuration: unknown
  provider: string
  model: string
  status: 'validated' | 'applied'
  created_at: number
}
