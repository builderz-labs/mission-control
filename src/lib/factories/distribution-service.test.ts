import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adapter: null as any,
  approval: null as any,
  experience: vi.fn(),
  updateApproval: vi.fn(),
}))

vi.mock('./registry', () => ({ getFactoryAdapter: vi.fn(() => mocks.adapter), listFactoryAdapters: vi.fn(() => []) }))
vi.mock('./learning-store', () => ({ recordExperience: mocks.experience, recordFactorySnapshotExperience: vi.fn() }))
vi.mock('./store', () => ({
  claimFactoryApproval: vi.fn(() => true),
  completeFactoryCommandRun: vi.fn(),
  createFactoryCommandRun: vi.fn(),
  getFactoryApproval: vi.fn(() => mocks.approval),
  getFactoryInstance: vi.fn(() => ({ instance_id: 'marketing:shufuro', adapter_id: 'shufuro-marketing-content-os-v1', config_json: {}, root_path: '/fixture', latest_snapshot: { available_commands: [] } })),
  listFactoryApprovals: vi.fn(() => []), listFactoryInstances: vi.fn(() => []),
  saveFactorySnapshot: vi.fn(), saveFactorySnapshotError: vi.fn(), syncOpenApprovalRequests: vi.fn(),
  updateFactoryApprovalState: mocks.updateApproval,
  upsertFactoryInstance: vi.fn(),
}))

import { processFactoryApproval } from './service'

describe('distribution approval experience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.approval = {
      request_id: 'approval:publish:EP002', instance_id: 'marketing:shufuro', gate_id: 'publish:EP002',
      state: 'DECISION_RECORDED', decision: 'approve', decision_note: null, decision_by: 'owner',
      expected_revision: 'revision-1', native_result: JSON.stringify({ publish_evidence: {
        provider: 'manual', channel: 'x', post_id: 'x-42', published_at: '2026-10-05T00:00:00.000Z',
        verification_state: 'verified', evidence_ref: 'human:x-42',
      } }),
    }
    const snapshot = { lifecycle: { process_stage_id: 'M11', native_stage: 'EP002:POSTED' }, checks: [], metrics: [] }
    mocks.adapter = {
      getDefinition: () => ({ gates: [{ id: 'publish', apply_command: 'publish-content' }], commands: [{ id: 'publish-content', mode: 'mutating', risk: 'high' }] }),
      canExecute: () => ({ command_id: 'publish-content', available: true }),
      execute: vi.fn(async (_instance, request) => {
        expect(request.arguments.human_approved).toBe(true)
        return { state: 'APPLIED', before_revision: 'revision-1', after_revision: 'revision-2', stdout_excerpt: 'verified manual evidence', stderr_excerpt: '', error: null, snapshot }
      }),
    }
    mocks.updateApproval.mockImplementation((input) => ({ ...mocks.approval, state: input.state, native_result: JSON.stringify(input.nativeResult) }))
  })

  it('records verified publish evidence as a zero-cost auditable experience after human approval', async () => {
    const result = await processFactoryApproval(1, 'approval:publish:EP002')
    expect(result.processed).toBe(true)
    expect(mocks.experience).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'distribution_publish', outcome: 'success', cost: { paid_usd: 0, local_compute: true },
      evidenceRefs: ['approval:approval:publish:EP002', 'human:x-42'],
      inputs: [expect.objectContaining({ command_id: 'publish-content', gate: 'publish:EP002', publish_evidence: expect.objectContaining({ post_id: 'x-42' }) })],
    }))
  })
})
