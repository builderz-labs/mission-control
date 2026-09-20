import type {
  JevEvaluation,
  JevPolicy,
  JevQuestions,
  JevRepositoryContext,
  JevState,
  JevStatus,
} from '@/lib/jev-types'

export type { JevEvaluation, JevPolicy, JevQuestions, JevRepositoryContext, JevState, JevStatus }

export interface JevPolicyInput {
  name: string
  description: string
  model: string
  mode: 'manual' | 'shadow'
  questions: JevQuestions
  enabled: boolean
}

export interface JevRunResult {
  id: string
  model: string
  answers: Record<string, unknown>
  usage: { input_tokens: number; output_tokens: number }
  requestId: string | null
  latencyMs: number
}
