import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  mockRunOpenClaw,
  mockGetAllGatewaySessions,
  mockLogActivity,
  mockBroadcast,
} = vi.hoisted(() => ({
  mockRunOpenClaw: vi.fn(),
  mockGetAllGatewaySessions: vi.fn(() => [] as any[]),
  mockLogActivity: vi.fn(),
  mockBroadcast: vi.fn(),
}))

vi.mock('@/lib/command', () => ({ runOpenClaw: mockRunOpenClaw }))
vi.mock('@/lib/sessions', () => ({ getAllGatewaySessions: mockGetAllGatewaySessions }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/db', () => ({ db_helpers: { logActivity: mockLogActivity } }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: mockBroadcast } }))

import { dispatchTaskToAgent } from '../task-dispatch'

function makeMockDb(agentRow: any = null, updateChanges = 1) {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('SELECT * FROM agents')) {
        return { get: vi.fn(() => agentRow) }
      }
      if (sql.includes('UPDATE tasks')) {
        return { run: vi.fn(() => ({ changes: updateChanges })) }
      }
      return { get: vi.fn(), run: vi.fn(() => ({ changes: 0 })) }
    }),
  } as any
}

const baseTask = {
  id: 42,
  title: 'Implement feature X',
  description: 'Build out feature X',
  status: 'assigned',
  priority: 'high',
  assigned_to: 'Rocket',
  project_ticket_no: 7,
  project_prefix: 'MC',
}

describe('dispatchTaskToAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunOpenClaw.mockResolvedValue(undefined)
    delete process.env.MC_BASE_URL
    delete process.env.API_KEY
  })

  it('does not include API_KEY in the dispatch message', async () => {
    process.env.API_KEY = 'super-secret-key-12345'
    const db = makeMockDb()

    await dispatchTaskToAgent(db, 1, baseTask)

    expect(mockRunOpenClaw).toHaveBeenCalledTimes(1)
    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.message).not.toContain('super-secret-key-12345')
    expect(params.message).not.toContain('x-api-key')
    expect(params.message).not.toContain('API_KEY')
  })

  it('includes x-agent-name identification in the dispatch message', async () => {
    const db = makeMockDb()

    await dispatchTaskToAgent(db, 1, baseTask)

    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.message).toContain('x-agent-name: Rocket')
  })

  it('includes ticket reference in the dispatch message', async () => {
    const db = makeMockDb()

    await dispatchTaskToAgent(db, 1, baseTask)

    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.message).toContain('MC-007')
  })

  it('falls back to task id when no project prefix', async () => {
    const db = makeMockDb()
    const task = { ...baseTask, project_prefix: null, project_ticket_no: null }

    await dispatchTaskToAgent(db, 1, task)

    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.message).toContain('#42')
  })

  it('uses sessionKey from agent record when available', async () => {
    const db = makeMockDb({ session_key: 'sess-abc', config: null })

    await dispatchTaskToAgent(db, 1, baseTask)

    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.sessionKey).toBe('sess-abc')
    expect(params.agentId).toBeUndefined()
  })

  it('falls back to agentId derived from name when no session', async () => {
    const db = makeMockDb()

    await dispatchTaskToAgent(db, 1, { ...baseTask, assigned_to: 'The Orchestrator' })

    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.agentId).toBe('the-orchestrator')
    expect(params.sessionKey).toBeUndefined()
  })

  it('uses gateway session fallback when agent record has no session_key', async () => {
    mockGetAllGatewaySessions.mockReturnValue([
      { agent: 'rocket', key: 'gw-sess-123', sessionId: '', updatedAt: 0, chatType: '', channel: '', model: '', totalTokens: 0, inputTokens: 0, outputTokens: 0, contextTokens: 0, active: true },
    ])
    const db = makeMockDb()

    await dispatchTaskToAgent(db, 1, baseTask)

    const params = JSON.parse(mockRunOpenClaw.mock.calls[0][0][6])
    expect(params.sessionKey).toBe('gw-sess-123')
  })

  it('calls markTaskInProgress after successful dispatch', async () => {
    const db = makeMockDb(null, 1)

    await dispatchTaskToAgent(db, 1, baseTask)

    const prepareCalls = db.prepare.mock.calls.map((c: any) => c[0])
    expect(prepareCalls.some((sql: string) => sql.includes('UPDATE tasks'))).toBe(true)
    expect(mockBroadcast).toHaveBeenCalledWith('task.status_changed', expect.objectContaining({
      id: 42,
      status: 'in_progress',
    }))
  })

  it('handles accepted-with-warnings (stderr noise) gracefully', async () => {
    mockRunOpenClaw.mockRejectedValue({ stdout: '{"status": "accepted"}', stderr: 'some warning' })
    const db = makeMockDb(null, 1)

    await dispatchTaskToAgent(db, 1, baseTask)

    const prepareCalls = db.prepare.mock.calls.map((c: any) => c[0])
    expect(prepareCalls.some((sql: string) => sql.includes('UPDATE tasks'))).toBe(true)
  })

  it('re-throws errors that are not accepted-with-warnings', async () => {
    mockRunOpenClaw.mockRejectedValue(new Error('gateway timeout'))
    const db = makeMockDb()

    await expect(dispatchTaskToAgent(db, 1, baseTask)).rejects.toThrow('gateway timeout')
  })
})
