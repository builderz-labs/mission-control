import type { EntryType, Question } from '@typesafe-ai/sdk'
import type { JevPolicyConfiguration } from '@/lib/jev-policy-configuration'

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
  configuration?: JevPolicyConfiguration | null
  enabled: boolean
  created_by: string
  created_at: number
  updated_at: number
}

export interface JevEvaluation {
  id: string
  workspace_id: number
  project_id: number
  project_name?: string
  policy_id: number | null
  policy_name?: string | null
  policy_name_snapshot?: string | null
  policy_configuration_snapshot?: string | null
  idempotency_key?: string | null
  status: 'running' | 'succeeded' | 'failed'
  model_requested: string
  model_resolved: string | null
  answers: Record<string, unknown> | null
  questions: JevQuestions
  usage_input_tokens: number | null
  usage_output_tokens: number | null
  latency_ms: number | null
  request_id: string | null
  state_sha256: string
  state_length: number
  state_preview: string | null
  error_code: string | null
  created_by: string
  created_at: number
  completed_at: number | null
}

export interface JevStatus {
  configured: boolean
  healthy: boolean
  healthError: string | null
  lastCheckedAt: number | null
  assistantAvailable: boolean
  assistantProvider: string
  assistantDefault?: import('@/lib/jev-assistant-config').JevAssistantProviderKind
  assistantOptions?: import('@/lib/jev-assistant-config').JevAssistantOption[]
  defaultModel: string
  sdkVersion: string
  policyCount: number
  evaluationCount: number
  successfulCount: number
  lastEvaluationAt: number | null
  cloud: {
    configured: boolean
    project: string
    state: 'local_only' | 'configuration_error' | 'retrying' | 'pending' | 'synced' | 'ready'
    pending: number
    synced: number
    lastSyncedAt: number | null
    errorCode: string | null
  }
}

export interface JevRepositoryContext {
  state: Record<string, unknown>
  source: 'local' | 'project-metadata'
  localAvailable: boolean
  includedFiles: string[]
  trackedFileCount: number
  warnings: string[]
}
