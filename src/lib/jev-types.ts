import type { EntryType, Question } from '@typesafe-ai/sdk'

export type JevPolicyMode = 'manual' | 'shadow'
export type JevQuestion = Question
export type JevQuestions = Record<string, JevQuestion>
export type JevState = Exclude<EntryType, null>

export interface JevPolicy {
  id: number
  workspace_id: number
  project_id: number
  name: string
  description: string | null
  model: string
  mode: JevPolicyMode
  questions: JevQuestions
  enabled: boolean
  created_by: string
  created_at: number
  updated_at: number
}

export interface JevEvaluation {
  id: string
  project_id: number
  project_name?: string
  policy_id: number | null
  policy_name?: string | null
  status: 'running' | 'succeeded' | 'failed'
  model_requested: string
  model_resolved: string | null
  answers: Record<string, unknown> | null
  questions: JevQuestions
  usage_input_tokens: number | null
  usage_output_tokens: number | null
  latency_ms: number | null
  request_id: string | null
  state_length: number
  state_preview: string | null
  error_code: string | null
  created_by: string
  created_at: number
  completed_at: number | null
}

export interface JevStatus {
  configured: boolean
  defaultModel: string
  sdkVersion: string
  policyCount: number
  evaluationCount: number
  successfulCount: number
  lastEvaluationAt: number | null
}

export interface JevRepositoryContext {
  state: Record<string, unknown>
  source: 'local' | 'project-metadata'
  localAvailable: boolean
  includedFiles: string[]
  trackedFileCount: number
  warnings: string[]
}
