import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted() so mock variables are available inside vi.mock() factories
const { mockBroadcast, mockRun, mockGet, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
  const mockGet = vi.fn((): any => ({ count: 1 }))
  const mockPrepare = vi.fn(() => ({
    run: mockRun,
    get: mockGet,
    all: vi.fn(() => []),
  }))
  const mockBroadcast = vi.fn()
  return { mockBroadcast, mockRun, mockGet, mockPrepare }
})

// Mock better-sqlite3 native module to avoid needing compiled bindings
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => ({
      prepare: mockPrepare,
      pragma: vi.fn(),
      exec: vi.fn(),
      close: vi.fn(),
    })),
  }
})

vi.mock('@/lib/config', () => ({
  config: { dbPath: ':memory:' },
  ensureDirExists: vi.fn(),
}))

vi.mock('@/lib/migrations', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: mockBroadcast, on: vi.fn(), emit: vi.fn(), setMaxListeners: vi.fn() },
}))

// Import after mocks — the real db_helpers will use our mocked getDatabase
import { db_helpers } from '@/lib/db'

describe('parseMentions', () => {
  it('extracts multiple mentions', () => {
    expect(db_helpers.parseMentions('@alice hello @bob')).toEqual(['alice', 'bob'])
  })

  it('returns empty array when no mentions', () => {
    expect(db_helpers.parseMentions('no mentions here')).toEqual([])
  })

  it('extracts single mention', () => {
    expect(db_helpers.parseMentions('hey @alice')).toEqual(['alice'])
  })

  it('handles @@double — captures word chars after @', () => {
    const result = db_helpers.parseMentions('@@double')
    expect(result).toContain('double')
  })

  it('handles mentions at start and end of string', () => {
    expect(db_helpers.parseMentions('@start and @end')).toEqual(['start', 'end'])
  })

  it('returns empty array for empty string', () => {
    expect(db_helpers.parseMentions('')).toEqual([])
  })
})

describe('logActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts activity into database and broadcasts event', () => {
    db_helpers.logActivity('task_created', 'task', 1, 'alice', 'Created task')

    expect(mockPrepare).toHaveBeenCalled()
    expect(mockRun).toHaveBeenCalledWith(
      'task_created', 'task', 1, 'alice', 'Created task', null,
    )
    expect(mockBroadcast).toHaveBeenCalledWith(
      'activity.created',
      expect.objectContaining({
        type: 'task_created',
        entity_type: 'task',
        entity_id: 1,
        actor: 'alice',
      }),
    )
  })

  it('stringifies data when provided', () => {
    const data = { key: 'value' }
    db_helpers.logActivity('update', 'agent', 2, 'bob', 'Updated agent', data)

    expect(mockRun).toHaveBeenCalledWith(
      'update', 'agent', 2, 'bob', 'Updated agent', JSON.stringify(data),
    )
  })
})

describe('createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts notification and broadcasts event', () => {
    db_helpers.createNotification('alice', 'mention', 'Mentioned', 'You were mentioned')

    expect(mockRun).toHaveBeenCalledWith(
      'alice', 'mention', 'Mentioned', 'You were mentioned', undefined, undefined,
    )
    expect(mockBroadcast).toHaveBeenCalledWith(
      'notification.created',
      expect.objectContaining({
        recipient: 'alice',
        type: 'mention',
        title: 'Mentioned',
      }),
    )
  })

  it('passes source_type and source_id when provided', () => {
    db_helpers.createNotification('bob', 'alert', 'Alert', 'CPU high', 'agent', 5)

    expect(mockRun).toHaveBeenCalledWith(
      'bob', 'alert', 'Alert', 'CPU high', 'agent', 5,
    )
  })
})

describe('updateAgentStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockReturnValue({ id: 42 })
  })

  it('updates agent status in database and broadcasts', () => {
    db_helpers.updateAgentStatus('worker-1', 'busy', 'Processing task')

    expect(mockPrepare).toHaveBeenCalled()
    expect(mockBroadcast).toHaveBeenCalledWith(
      'agent.status_changed',
      expect.objectContaining({
        id: 42,
        name: 'worker-1',
        status: 'busy',
      }),
    )
  })
})
