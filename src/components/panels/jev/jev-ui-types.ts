import type {
  JevEvaluation,
  JevPolicy,
  JevQuestions,
  JevRepositoryContext,
  JevState,
  JevStatus,
} from '@/lib/jev-types'
import type { JevAssistantDraft } from '@/lib/jev-assistant-schema'
import type { JevPolicyConfiguration } from '@/lib/jev-policy-configuration'

export type { JevEvaluation, JevPolicy, JevQuestions, JevRepositoryContext, JevState, JevStatus }

export interface JevPolicyInput {
  name: string
  description: string
  model: string
  mode: 'manual' | 'shadow'
  questions: JevQuestions
  configuration?: JevPolicyConfiguration | null
  enabled: boolean
}

export interface JevAssistantResponse {
  draft: JevAssistantDraft
  configuration: JevPolicyConfiguration
  provider: { kind: import('@/lib/jev-assistant-config').JevAssistantProviderKind; model: string }
  warnings: string[]
  session?: { id: string; revisionNo: number } | null
}

export interface JevRunResult {
  id: string
  model: string
  answers: Record<string, unknown>
  usage: { input_tokens: number; output_tokens: number }
  requestId: string | null
  latencyMs: number
}
