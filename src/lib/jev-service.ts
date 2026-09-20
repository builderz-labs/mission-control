import { createHash, randomUUID } from 'node:crypto'
import { logAuditEvent } from '@/lib/db'
import { evaluateWithJev, JevClientError } from '@/lib/jev-client'
import {
  finishJevEvaluation,
  getJevPolicy,
  insertJevEvaluation,
} from '@/lib/jev-repository'
import type { JevQuestions, JevState } from '@/lib/jev-types'

interface RunInput {
  workspaceId: number
  projectId: number
  policyId?: number
  state: JevState
  questions?: JevQuestions
  model?: string
  retainStatePreview: boolean
  actor: { id: number; username: string }
}

function stateMetadata(state: JevState, retainPreview: boolean) {
  const serialized = typeof state === 'string' ? state : JSON.stringify(state)
  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    length: serialized.length,
    preview: retainPreview ? serialized.slice(0, 500) : null,
  }
}

function audit(input: RunInput, evaluationId: string, status: string, detail: Record<string, unknown>) {
  logAuditEvent({
    action: `jev_evaluation_${status}`,
    actor: input.actor.username,
    actor_id: input.actor.id,
    target_type: 'jev_evaluation',
    detail: { evaluation_id: evaluationId, project_id: input.projectId, policy_id: input.policyId ?? null, ...detail },
    workspace_id: input.workspaceId,
  })
}

export async function runJevEvaluation(input: RunInput) {
  const policy = input.policyId
    ? getJevPolicy(input.workspaceId, input.projectId, input.policyId)
    : null
  if (policy && !policy.enabled) throw new JevClientError('JEV_POLICY_DISABLED', 409)

  const questions = policy?.questions ?? input.questions
  if (!questions) throw new JevClientError('JEV_QUESTIONS_REQUIRED', 400)
  const model = input.model ?? policy?.model ?? 'jev-latest'
  const metadata = stateMetadata(input.state, input.retainStatePreview)
  const id = randomUUID()
  insertJevEvaluation({
    id,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    policy_id: policy?.id ?? null,
    model_requested: model,
    questions: JSON.stringify(questions),
    state_sha256: metadata.hash,
    state_length: metadata.length,
    state_preview: metadata.preview,
    created_by: input.actor.username,
  })
  const startedAt = Date.now()

  try {
    const result = await evaluateWithJev({ state: input.state, questions, model })
    const latencyMs = Date.now() - startedAt
    finishJevEvaluation(id, {
      status: 'succeeded', model_resolved: result.model, answers: JSON.stringify(result.answers),
      usage_input_tokens: result.usage.input_tokens, usage_output_tokens: result.usage.output_tokens,
      latency_ms: latencyMs, request_id: result.requestId, error_code: null,
    })
    audit(input, id, 'succeeded', { model: result.model, latency_ms: latencyMs })
    return { id, ...result, latencyMs }
  } catch (error) {
    const safe = error instanceof JevClientError ? error : new JevClientError('JEV_UNEXPECTED_ERROR', 502)
    finishJevEvaluation(id, {
      status: 'failed', model_resolved: null, answers: null, usage_input_tokens: null,
      usage_output_tokens: null, latency_ms: Date.now() - startedAt,
      request_id: safe.requestId ?? null, error_code: safe.code,
    })
    audit(input, id, 'failed', { error_code: safe.code })
    throw safe
  }
}
