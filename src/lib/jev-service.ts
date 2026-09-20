import { createHash, randomUUID } from 'node:crypto'
import { logAuditEvent } from '@/lib/db'
import { evaluateWithJev, JevClientError } from '@/lib/jev-client'
import { redactJevSetupText } from '@/lib/jev-setup-redaction'
import {
  finishJevEvaluation,
  getJevEvaluationByIdempotency,
  getJevPolicy,
  insertJevEvaluation,
} from '@/lib/jev-repository'
import type { JevQuestions, JevState } from '@/lib/jev-types'

interface RunInput {
  workspaceId: number
  projectId: number
  policyId?: number
  idempotencyKey?: string
  state: JevState
  questions?: JevQuestions
  model?: string
  retainStatePreview: boolean
  signal?: AbortSignal
  actor: { id: number; username: string }
}

function replayEvaluation(
  existing: ReturnType<typeof getJevEvaluationByIdempotency>,
  expected: { projectId: number; policyId?: number; stateHash: string },
) {
  if (!existing) return null
  if (existing.project_id !== expected.projectId || existing.policy_id !== (expected.policyId ?? null)
    || existing.state_sha256 !== expected.stateHash) {
    throw new JevClientError('JEV_IDEMPOTENCY_CONFLICT', 409)
  }
  if (existing.status === 'running') throw new JevClientError('JEV_EVALUATION_IN_PROGRESS', 409)
  if (existing.status === 'failed') {
    throw new JevClientError(existing.error_code || 'JEV_PREVIOUSLY_FAILED', 409, existing.request_id ?? undefined)
  }
  if (!existing.answers || !existing.model_resolved
    || existing.usage_input_tokens === null || existing.usage_output_tokens === null) {
    throw new JevClientError('JEV_UNEXPECTED_ERROR', 502)
  }
  return {
    id: existing.id, model: existing.model_resolved, answers: existing.answers,
    usage: { input_tokens: existing.usage_input_tokens, output_tokens: existing.usage_output_tokens },
    requestId: existing.request_id, latencyMs: existing.latency_ms ?? 0,
  }
}

function stateMetadata(state: JevState, retainPreview: boolean) {
  const serialized = typeof state === 'string' ? state : JSON.stringify(state)
  const preview = redactJevSetupText(serialized)
  return {
    hash: createHash('sha256').update(serialized).digest('hex'),
    length: serialized.length,
    preview: retainPreview ? preview.slice(0, 500) : null,
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
  const model = input.model ?? policy?.model ?? (process.env.TYPESAFE_DEFAULT_MODEL?.trim() || 'jev-latest')
  const retainPreview = policy?.configuration
    ? policy.configuration.retainPreview
    : input.retainStatePreview
  const metadata = stateMetadata(input.state, retainPreview)
  if (input.idempotencyKey) {
    const replay = replayEvaluation(
      getJevEvaluationByIdempotency(input.workspaceId, input.idempotencyKey),
      { projectId: input.projectId, policyId: policy?.id, stateHash: metadata.hash },
    )
    if (replay) return replay
  }
  const id = input.idempotencyKey ?? randomUUID()
  try {
    insertJevEvaluation({
      id, workspace_id: input.workspaceId, project_id: input.projectId,
      policy_id: policy?.id ?? null, model_requested: model,
      questions: JSON.stringify(questions), state_sha256: metadata.hash,
      state_length: metadata.length, state_preview: metadata.preview,
      created_by: input.actor.username, idempotency_key: input.idempotencyKey ?? null,
      policy_name_snapshot: policy?.name ?? null,
      policy_configuration_snapshot: policy?.configuration ? JSON.stringify(policy.configuration) : null,
    })
  } catch (error) {
    if (!input.idempotencyKey) throw error
    const replay = replayEvaluation(
      getJevEvaluationByIdempotency(input.workspaceId, input.idempotencyKey),
      { projectId: input.projectId, policyId: policy?.id, stateHash: metadata.hash },
    )
    if (replay) return replay
    throw error
  }
  const startedAt = Date.now()

  try {
    const result = await evaluateWithJev({ state: input.state, questions, model }, { signal: input.signal })
    const latencyMs = Date.now() - startedAt
    finishJevEvaluation(id, input.workspaceId, {
      status: 'succeeded', model_resolved: result.model, answers: JSON.stringify(result.answers),
      usage_input_tokens: result.usage.input_tokens, usage_output_tokens: result.usage.output_tokens,
      latency_ms: latencyMs, request_id: result.requestId, error_code: null,
    })
    audit(input, id, 'succeeded', { model: result.model, latency_ms: latencyMs })
    return { id, ...result, latencyMs }
  } catch (error) {
    const safe = error instanceof JevClientError ? error : new JevClientError('JEV_UNEXPECTED_ERROR', 502)
    finishJevEvaluation(id, input.workspaceId, {
      status: 'failed', model_resolved: null, answers: null, usage_input_tokens: null,
      usage_output_tokens: null, latency_ms: Date.now() - startedAt,
      request_id: safe.requestId ?? null, error_code: safe.code,
    })
    audit(input, id, 'failed', { error_code: safe.code })
    throw safe
  }
}
