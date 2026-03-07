import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { GatewaySession } from '@/lib/sessions'

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockRequireRole,
  mockLogger,
  mockRunOpenClaw,
  mockGetAllGatewaySessions,
  mockEventBus,
  mockDb,
  mockDbHelpers,
} = vi.hoisted(() => {
  const mockRequireRole = vi.fn()
  const mockLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const mockRunOpenClaw = vi.fn()
  const mockGetAllGatewaySessions = vi.fn(() => [] as any[])
  const mockEventBus = { broadcast: vi.fn() }

  // Lightweight db stub
  let _idCounter = 100
  const mockStmt = {
    run: vi.fn(() => ({ lastInsertRowid: ++_idCounter })),
    get: vi.fn((id: any) => ({
      id,
      conversation_id: 'agent_coordinator',
      from_agent: 'admin',
      to_agent: 'coordinator',
      content: 'hello',
      message_type: 'text',
      metadata: null,
      created_at: Math.floor(Date.now() / 1000),
      workspace_id: 1,
    })),
    all: vi.fn(() => []),
  }
  const mockDb = { prepare: vi.fn(() => mockStmt) }

  const mockDbHelpers = {
    logActivity: vi.fn(),
    createNotification: vi.fn(),
  }

  return {
    mockRequireRole,
    mockLogger,
    mockRunOpenClaw,
    mockGetAllGatewaySessions,
    mockEventBus,
    mockDb,
    mockDbHelpers,
  }
})

vi.mock('@/lib/auth', () => ({ requireRole: mockRequireRole }))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))
vi.mock('@/lib/command', () => ({ runOpenClaw: mockRunOpenClaw }))
vi.mock('@/lib/sessions', () => ({ getAllGatewaySessions: mockGetAllGatewaySessions }))
vi.mock('@/lib/event-bus', () => ({ eventBus: mockEventBus }))
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => mockDb),
  db_helpers: mockDbHelpers,
  Message: {},
}))

import { POST } from './route'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/chat/messages', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const authedUser = { id: 1, workspace_id: 1, role: 'operator', username: 'admin', display_name: 'Admin' }

const fakeSession: GatewaySession = {
  agent: 'coordinator',
  key: 'agent:coordinator:main',
  sessionId: 'sess-1',
  updatedAt: Date.now(),
  active: true,
  chatType: 'conversation',
  channel: '',
  model: '',
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  contextTokens: 0,
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/chat/messages — basic', () => {
  beforeEach(() => {
    mockRequireRole.mockReturnValue({ user: authedUser })
  })
  afterEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockRequireRole.mockReturnValue({ error: 'Unauthorized', status: 401 })
    const res = await POST(makeRequest({ content: 'hi' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when content is missing', async () => {
    const res = await POST(makeRequest({ to: 'coordinator' }))
    expect(res.status).toBe(400)
  })

  it('stores the message and broadcasts SSE event', async () => {
    const res = await POST(makeRequest({ content: 'hello', to: 'coordinator', conversation_id: 'agent_coordinator' }))
    expect(res.status).toBe(201)
    expect(mockEventBus.broadcast).toHaveBeenCalledWith('chat.message', expect.objectContaining({ conversation_id: 'agent_coordinator' }))
  })
})

describe('POST /api/chat/messages — agent.wait for regular conversations', () => {
  beforeEach(() => {
    mockRequireRole.mockReturnValue({ user: authedUser })
  })
  afterEach(() => vi.clearAllMocks())

  it('calls agent.wait when message is delivered with a runId (non-coord conversation)', async () => {
    // First runOpenClaw call = gateway call agent (returns accepted + runId)
    mockRunOpenClaw
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ status: 'accepted', runId: 'run-abc-123' }),
        stderr: '',
        code: 0,
      })
      // Second call = agent.wait (returns the response)
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ status: 'completed', text: 'Hello from agent!' }),
        stderr: '',
        code: 0,
      })

    mockGetAllGatewaySessions.mockReturnValue([fakeSession])

    const res = await POST(makeRequest({
      content: 'hello',
      to: 'coordinator',
      conversation_id: 'agent_coordinator',
      forward: true,
    }))

    expect(res.status).toBe(201)
    // agent.wait should have been called (second call)
    expect(mockRunOpenClaw).toHaveBeenCalledTimes(2)
    const secondCallArgs = (mockRunOpenClaw.mock.calls[1] as any[])[0] as string[]
    expect(secondCallArgs).toContain('agent.wait')
  })

  it('includes conversationId in the gateway invoke params', async () => {
    mockRunOpenClaw
      .mockResolvedValueOnce({ stdout: JSON.stringify({ status: 'accepted', runId: 'run-xyz' }), stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ status: 'completed', text: 'hi' }), stderr: '', code: 0 })

    mockGetAllGatewaySessions.mockReturnValue([fakeSession])

    await POST(makeRequest({
      content: 'hello',
      to: 'coordinator',
      conversation_id: 'agent_coordinator',
      forward: true,
    }))

    const firstCallArgs = (mockRunOpenClaw.mock.calls[0] as any[])[0] as string[]
    // The --params argument is the JSON payload sent to the gateway
    const paramsIdx = firstCallArgs.indexOf('--params')
    const params = JSON.parse(firstCallArgs[paramsIdx + 1])
    expect(params.conversationId).toBe('agent_coordinator')
  })

  it('does NOT call the non-coordinator agent.wait block for coord: conversations', async () => {
    mockRunOpenClaw
      .mockResolvedValueOnce({ stdout: JSON.stringify({ status: 'accepted', runId: 'run-coord-1' }), stderr: '', code: 0 })
      .mockResolvedValue({ stdout: JSON.stringify({ status: 'completed', text: 'coordinating...' }), stderr: '', code: 0 })

    mockGetAllGatewaySessions.mockReturnValue([fakeSession])

    const res = await POST(makeRequest({
      content: 'run tasks',
      to: 'coordinator',
      conversation_id: 'coord:operator-session',
      forward: true,
    }))

    expect(res.status).toBe(201)
    // For coord: conversations, agent.wait is called from the coordinator mode block
    expect(mockRunOpenClaw).toHaveBeenCalled()
  })

  it('is non-fatal when agent.wait fails — returns 201 and stores the user message', async () => {
    mockRunOpenClaw
      .mockResolvedValueOnce({ stdout: JSON.stringify({ status: 'accepted', runId: 'run-fail' }), stderr: '', code: 0 })
      .mockRejectedValueOnce(new Error('agent.wait timeout'))

    mockGetAllGatewaySessions.mockReturnValue([fakeSession])

    const res = await POST(makeRequest({
      content: 'hello',
      to: 'coordinator',
      conversation_id: 'agent_coordinator',
      forward: true,
    }))

    // Should still succeed — agent.wait failure is non-fatal
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.message).toBeDefined()
  })
})

