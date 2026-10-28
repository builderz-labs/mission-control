import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { requireRole } from '@/lib/auth'
import { transitionImprovementCandidate } from '@/lib/factories/learning-store'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(),
}))

vi.mock('@/lib/enforcement/workspace-scope', () => ({
  requireWorkspaceId: vi.fn(() => ({ workspaceId: 1 })),
}))

vi.mock('@/lib/rate-limit', () => ({
  mutationLimiter: vi.fn(() => null),
}))

vi.mock('@/lib/factories/learning-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/factories/learning-store')>('@/lib/factories/learning-store')
  return {
    ...actual,
    transitionImprovementCandidate: vi.fn((input) => ({
      candidate_id: input.candidateId,
      status: input.toStatus,
      promotion_state: input.toStatus,
    })),
  }
})

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/learning/candidates/candidate-1/transition', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ candidateId: 'candidate-1' }) }

describe('POST /api/learning/candidates/[candidateId]/transition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows an operator to advance a normal evaluation transition', async () => {
    vi.mocked(requireRole).mockReturnValue({
      user: { username: 'operator-user' },
    } as never)

    const response = await POST(request({
      expected_status: 'PROPOSED',
      to_status: 'EVAL_READY',
      reason: 'ready for eval',
    }) as never, context)

    expect(response.status).toBe(200)
    expect(transitionImprovementCandidate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 1,
      candidateId: 'candidate-1',
      expectedStatus: 'PROPOSED',
      toStatus: 'EVAL_READY',
      actor: 'operator-user',
    }))
  })

  it('requires admin for promotion', async () => {
    vi.mocked(requireRole).mockImplementation((_request, role) => {
      if (role === 'admin') return { error: 'Forbidden', status: 403 } as never
      return { user: { username: 'operator-user' } } as never
    })

    const response = await POST(request({
      expected_status: 'APPROVAL_REQUIRED',
      to_status: 'PROMOTED',
      reason: 'approve after eval',
      change_ref: 'change:v2',
      rollback_target: 'change:v1',
    }) as never, context)

    expect(response.status).toBe(403)
    expect(transitionImprovementCandidate).not.toHaveBeenCalled()
  })

  it('uses the authenticated admin identity for promotion', async () => {
    vi.mocked(requireRole).mockReturnValue({
      user: { username: 'admin-user' },
    } as never)

    const response = await POST(request({
      expected_status: 'APPROVAL_REQUIRED',
      to_status: 'PROMOTED',
      reason: 'approve after eval',
      change_ref: 'change:v2',
      rollback_target: 'change:v1',
    }) as never, context)

    expect(response.status).toBe(200)
    expect(requireRole).toHaveBeenCalledWith(expect.anything(), 'admin')
    expect(transitionImprovementCandidate).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'PROMOTED',
      actor: 'admin-user',
      changeRef: 'change:v2',
      rollbackTarget: 'change:v1',
    }))
  })
})
