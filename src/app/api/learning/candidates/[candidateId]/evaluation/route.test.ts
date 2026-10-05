import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { requireRole } from '@/lib/auth'
import { recordImprovementEvaluation } from '@/lib/factories/learning-store'

vi.mock('@/lib/auth', () => ({ requireRole: vi.fn() }))
vi.mock('@/lib/enforcement/workspace-scope', () => ({ requireWorkspaceId: vi.fn(() => ({ workspaceId: 1 })) }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/factories/learning-store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/factories/learning-store')>('@/lib/factories/learning-store')
  return { ...actual, recordImprovementEvaluation: vi.fn(() => ({ evidenceId: 'eval-1', passed: true, effect: 2 })) }
})

const context = { params: Promise.resolve({ candidateId: 'candidate-1' }) }
function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/learning/candidates/candidate-1/evaluation', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /api/learning/candidates/[candidateId]/evaluation', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects unauthenticated or malformed evaluation records', async () => {
    vi.mocked(requireRole).mockReturnValue({ error: 'Forbidden', status: 403 } as never)
    expect((await POST(request({ after: 8, source_ref: 'fixture' }) as never, context)).status).toBe(403)
    vi.mocked(requireRole).mockReturnValue({ user: { username: 'operator' } } as never)
    expect((await POST(request({ after: '8', source_ref: 'fixture' }) as never, context)).status).toBe(400)
    expect(recordImprovementEvaluation).not.toHaveBeenCalled()
  })
  it('records the authenticated evaluator identity', async () => {
    vi.mocked(requireRole).mockReturnValue({ user: { username: 'operator' } } as never)
    expect((await POST(request({ after: 8, source_ref: 'fixture:eval' }) as never, context)).status).toBe(201)
    expect(recordImprovementEvaluation).toHaveBeenCalledWith({
      workspaceId: 1, candidateId: 'candidate-1', after: 8, sourceRef: 'fixture:eval', actor: 'operator',
    })
  })
})
