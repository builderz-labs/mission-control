import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
  logActivityMock: vi.fn(),
  broadcastMock: vi.fn(),
  loggerMock: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT id, name FROM agents')) {
        return { get: mocks.getMock }
      }
      return { run: mocks.runMock }
    },
  }),
  db_helpers: {
    logActivity: mocks.logActivityMock,
  },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: {
    broadcast: mocks.broadcastMock,
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: mocks.loggerMock,
}))

describe('POST /api/hermes/events', () => {
  beforeEach(() => {
    mocks.getMock.mockReset()
    mocks.runMock.mockReset()
    mocks.logActivityMock.mockReset()
    mocks.broadcastMock.mockReset()
    mocks.getMock.mockReturnValue(undefined)
    mocks.runMock.mockReturnValue({ lastInsertRowid: 42 })
  })

  it('upserts an agent and records activity for agent:start events', async () => {
    const { POST } = await import('@/app/api/hermes/events/route')
    const response = await POST(new Request('http://localhost/api/hermes/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'agent:start',
        payload: { agent_name: 'hermes', source: 'telegram' },
        timestamp: '2026-03-31T13:00:00.000Z',
      }),
    }) as any)
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.agentId).toBe(42)
    expect(mocks.logActivityMock).toHaveBeenCalledWith(
      'hermes_hook_event',
      'agent',
      42,
      'hermes',
      'Hermes hook reported agent:start',
      expect.objectContaining({ event: 'agent:start', source: 'telegram' }),
      1,
    )
    expect(mocks.broadcastMock).toHaveBeenCalled()
  })
})
