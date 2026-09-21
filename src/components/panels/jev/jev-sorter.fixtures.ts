import type { JevEvaluation, JevPolicy } from './jev-ui-types'

export const sorterPolicy: JevPolicy = {
  id: 7, workspace_id: 1, project_id: 2, name: 'Release review', description: 'Review supplied evidence.',
  model: 'jev-latest', mode: 'shadow', enabled: true, created_by: 'tester', created_at: 1, updated_at: 1,
  questions: {
    ready: { type: 'noul', instructions: 'Is it ready?' },
    kind: { type: 'choice', instructions: 'What kind?', criteria: { bug: 'Bug', feature: 'Feature' } },
    quality: { type: 'score', instructions: 'How complete?', criteria: ['Weak', 'Adequate', 'Strong'] },
  },
}
export function sorterEvaluation(overrides: Partial<JevEvaluation> = {}): JevEvaluation {
  return {
    id: 'eval-1', workspace_id: 1, project_id: 2, policy_id: 7, status: 'succeeded',
    model_requested: 'jev-latest', model_resolved: 'jev-1.13.0', questions: sorterPolicy.questions,
    answers: { ready: { type: 'noul', noul: .8 }, kind: { type: 'choice', choice: 'bug' }, quality: { type: 'score', score: 1.6 } },
    usage_input_tokens: 10, usage_output_tokens: 3, latency_ms: 42, request_id: null,
    state_sha256: 'one', state_length: 4, state_preview: null, error_code: null, created_by: 'tester', created_at: 1, completed_at: 2,
    ...overrides,
  }
}
