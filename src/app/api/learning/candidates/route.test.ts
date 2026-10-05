import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { requireRole } from '@/lib/auth'
import { proposeReadyImprovementCandidate } from '@/lib/factories/learning-store'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/enforcement/workspace-scope', () => ({ requireWorkspaceId: vi.fn(() => ({ workspaceId: 1 })) }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/factories/learning-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/factories/learning-store')>('@/lib/factories/learning-store')
  return { ...actual, proposeReadyImprovementCandidate: vi.fn(() => ({ candidate_id: 'candidate-1' })) }
})

const request = () => new Request('http://localhost/api/learning/candidates', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scope: 'workflow', target: 'subject', hypothesis: 'Improve outcome', eval_plan: {
    metric: 'failure_count', baseline: 5, direction: 'decrease', minimum_effect: 1, method: 'fixture comparison',
  } }),
})

describe('POST /api/learning/candidates', () => {
  beforeEach(() => vi.clearAllMocks())
  it('requires operator access', async () => {
    vi.mocked(requireRole).mockReturnValue({ error: 'Forbidden', status: 403 } as never)
    expect((await POST(request() as never)).status).toBe(403)
    expect(proposeReadyImprovementCandidate).not.toHaveBeenCalled()
  })
  it('sends a typed proposal to the threshold-gated store', async () => {
    vi.mocked(requireRole).mockReturnValue({ user: { username: 'operator' } } as never)
    expect((await POST(request() as never)).status).toBe(201)
    expect(proposeReadyImprovementCandidate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 1, scope: 'workflow', target: 'subject',
      evalPlan: expect.objectContaining({ baseline: 5 }),
    }))
  })
})
