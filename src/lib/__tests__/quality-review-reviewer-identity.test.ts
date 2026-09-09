import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const requireRoleMock = vi.fn()
const validateBodyMock = vi.fn()
const prepareMock = vi.fn()
const runMock = vi.fn<(...args: unknown[]) => { lastInsertRowid: number }>(
  () => ({ lastInsertRowid: 9 }),
)

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ mutationLimiter: vi.fn(() => null) }))
vi.mock('@/lib/validation', () => ({
  validateBody: (...args: unknown[]) => validateBodyMock(...args),
  qualityReviewSchema: {},
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => ({ prepare: prepareMock })),
  db_helpers: { logActivity: vi.fn() },
}))

describe('POST /api/quality-review reviewer identity', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    validateBodyMock.mockResolvedValue({
      data: { taskId: 42, reviewer: 'aegis', status: 'approved', notes: 'ok' },
    })
    prepareMock.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, title FROM tasks')) {
        return { get: vi.fn(() => ({ id: 42, title: 'Task' })) }
      }
      return { run: runMock }
    })
  })

  it('stores the caller agent_name and does not mark done when spoofing aegis', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'agent-a', role: 'operator', workspace_id: 7, agent_name: 'agent-a' },
    })

    const { POST } = await import('@/app/api/quality-review/route')
    const response = await POST(
      new NextRequest('http://localhost/api/quality-review', {
        method: 'POST',
        body: JSON.stringify({
          taskId: 42, reviewer: 'aegis', status: 'approved', notes: 'ok',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(200)
    const insert = runMock.mock.calls.find((call) => call[0] === 42 && call[1] === 'agent-a')
    expect(insert).toBeTruthy()
    const doneUpdate = runMock.mock.calls.find((call) => call[0] === 'done')
    expect(doneUpdate).toBeUndefined()
  })

  it('marks the task done when the Aegis agent approves', async () => {
    requireRoleMock.mockReturnValue({
      user: { username: 'aegis', role: 'operator', workspace_id: 7, agent_name: 'aegis' },
    })

    const { POST } = await import('@/app/api/quality-review/route')
    const response = await POST(
      new NextRequest('http://localhost/api/quality-review', {
        method: 'POST',
        body: JSON.stringify({
          taskId: 42, reviewer: 'aegis', status: 'approved', notes: 'ok',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    )

    expect(response.status).toBe(200)
    expect(runMock.mock.calls.some((call) => call[0] === 'done')).toBe(true)
  })
})
