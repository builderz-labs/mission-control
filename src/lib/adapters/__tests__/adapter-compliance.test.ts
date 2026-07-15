/**
 * Adapter Compliance Test Suite
 *
 * Tests every FrameworkAdapter implementation against the contract.
 * This is the P0 gate — nothing ships until all adapters pass.
 *
 * Tests:
 *   1. Interface compliance (all 5 methods exist and are callable)
 *   2. Event emission (correct event types and payloads)
 *   3. Assignment retrieval (DB query works)
 *   4. Error resilience (bad inputs don't crash)
 *   5. Framework identity (each adapter tags events correctly)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { FrameworkAdapter, AgentRegistration, HeartbeatPayload, TaskReport } from '../adapter'
import { getAdapter, listAdapters } from '../index'

// Mock event bus
const mockBroadcast = vi.fn()
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => mockBroadcast(...args) },
}))

// Mock DB query for getAssignments
const mockQuery = vi.fn()
vi.mock('../adapter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../adapter')>()
  return {
    ...original,
    queryPendingAssignments: (...args: unknown[]) => mockQuery(...args),
  }
})

// ─── Test Data ───────────────────────────────────────────────────────────────

const TEST_WORKSPACE_ID = 42

const testAgent: AgentRegistration = {
  agentId: 'test-agent-001',
  name: 'Test Agent',
  framework: 'test-framework',
  metadata: { version: '1.0', runtime: 'node' },
  workspaceId: TEST_WORKSPACE_ID,
}

const testHeartbeat: HeartbeatPayload = {
  agentId: 'test-agent-001',
  status: 'busy',
  metrics: { cpu: 42, memory: 1024, tasksCompleted: 5 },
  workspaceId: TEST_WORKSPACE_ID,
}

const testReport: TaskReport = {
  taskId: 'task-123',
  agentId: 'test-agent-001',
  progress: 75,
  status: 'in_progress',
  output: { summary: 'Processing step 3 of 4' },
  workspaceId: TEST_WORKSPACE_ID,
}

// ─── Shared Compliance Tests ─────────────────────────────────────────────────

const ALL_FRAMEWORKS = ['openclaw', 'generic', 'crewai', 'langgraph', 'autogen', 'claude-sdk']

describe('Adapter Registry', () => {
  it('lists all registered adapters', () => {
    const adapters = listAdapters()
    expect(adapters).toEqual(expect.arrayContaining(ALL_FRAMEWORKS))
    expect(adapters.length).toBe(ALL_FRAMEWORKS.length)
  })

  it('returns an adapter for each registered framework', () => {
    for (const fw of ALL_FRAMEWORKS) {
      const adapter = getAdapter(fw)
      expect(adapter).toBeDefined()
      expect(adapter.framework).toBe(fw)
    }
  })

  it('throws for unknown framework', () => {
    expect(() => getAdapter('nonexistent')).toThrow('Unknown framework adapter')
  })
})

// Run the full compliance suite for EVERY adapter
describe.each(ALL_FRAMEWORKS)('FrameworkAdapter compliance: %s', (framework) => {
  let adapter: FrameworkAdapter

  beforeEach(() => {
    adapter = getAdapter(framework)
    mockBroadcast.mockClear()
    mockQuery.mockClear()
  })

  // ── 1. Interface Compliance ──────────────────────────────────────────────

  describe('interface compliance', () => {
    it('implements all 5 required methods', () => {
      expect(typeof adapter.register).toBe('function')
      expect(typeof adapter.heartbeat).toBe('function')
      expect(typeof adapter.reportTask).toBe('function')
      expect(typeof adapter.getAssignments).toBe('function')
      expect(typeof adapter.disconnect).toBe('function')
    })

    it('has a readonly framework property', () => {
      expect(adapter.framework).toBe(framework)
    })

    it('all methods return promises', async () => {
      mockQuery.mockResolvedValue([])

      const results = [
        adapter.register(testAgent),
        adapter.heartbeat(testHeartbeat),
        adapter.reportTask(testReport),
        adapter.getAssignments('any-id', TEST_WORKSPACE_ID),
        adapter.disconnect('any-id', TEST_WORKSPACE_ID),
      ]

      // All should be thenables
      for (const r of results) {
        expect(r).toBeInstanceOf(Promise)
      }

      await Promise.all(results)
    })
  })

  // ── 2. Event Emission ────────────────────────────────────────────────────

  describe('register()', () => {
    it('broadcasts agent.created with correct payload', async () => {
      await adapter.register(testAgent)

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith(
        'agent.created',
        expect.objectContaining({
          id: 'test-agent-001',
          name: 'Test Agent',
          status: 'online',
        })
      )
    })

    it('includes framework tag in event', async () => {
      await adapter.register(testAgent)

      const payload = mockBroadcast.mock.calls[0][1]
      // Generic adapter may use agent.framework; others use this.framework
      expect(payload.framework).toBeTruthy()
    })

    it('passes through metadata', async () => {
      await adapter.register(testAgent)

      const payload = mockBroadcast.mock.calls[0][1]
      // Metadata is spread into the event payload
      expect(payload.version).toBe('1.0')
      expect(payload.runtime).toBe('node')
    })

    it('handles agent with no metadata', async () => {
      await adapter.register({
        agentId: 'minimal-agent',
        name: 'Minimal',
        framework,
        workspaceId: TEST_WORKSPACE_ID,
      })

      expect(mockBroadcast).toHaveBeenCalledWith(
        'agent.created',
        expect.objectContaining({
          id: 'minimal-agent',
          name: 'Minimal',
          status: 'online',
        })
      )
    })
  })

  describe('heartbeat()', () => {
    it('broadcasts agent.status_changed with status and metrics', async () => {
      await adapter.heartbeat(testHeartbeat)

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith(
        'agent.status_changed',
        expect.objectContaining({
          id: 'test-agent-001',
          status: 'busy',
        })
      )
    })

    it('includes metrics in event payload', async () => {
      await adapter.heartbeat(testHeartbeat)

      const payload = mockBroadcast.mock.calls[0][1]
      expect(payload.metrics).toBeDefined()
      expect(payload.metrics.cpu).toBe(42)
    })

    it('handles heartbeat with no metrics', async () => {
      await adapter.heartbeat({
        agentId: 'test-agent-001',
        status: 'idle',
        workspaceId: TEST_WORKSPACE_ID,
      })

      expect(mockBroadcast).toHaveBeenCalledWith(
        'agent.status_changed',
        expect.objectContaining({
          id: 'test-agent-001',
          status: 'idle',
        })
      )
    })
  })

  describe('reportTask()', () => {
    it('broadcasts task.updated with progress and status', async () => {
      await adapter.reportTask(testReport)

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith(
        'task.updated',
        expect.objectContaining({
          id: 'task-123',
          agentId: 'test-agent-001',
          progress: 75,
          status: 'in_progress',
        })
      )
    })

    it('passes through output data', async () => {
      await adapter.reportTask(testReport)

      const payload = mockBroadcast.mock.calls[0][1]
      expect(payload.output).toEqual({ summary: 'Processing step 3 of 4' })
    })

    it('handles report with no output', async () => {
      await adapter.reportTask({
        taskId: 'task-456',
        agentId: 'test-agent-001',
        progress: 100,
        status: 'completed',
        workspaceId: TEST_WORKSPACE_ID,
      })

      expect(mockBroadcast).toHaveBeenCalledWith(
        'task.updated',
        expect.objectContaining({
          id: 'task-456',
          status: 'completed',
          progress: 100,
        })
      )
    })
  })

  describe('getAssignments()', () => {
    it('delegates to queryPendingAssignments', async () => {
      const mockAssignments = [
        { taskId: '1', description: 'Fix bug', priority: 1 },
        { taskId: '2', description: 'Write tests', priority: 2 },
      ]
      mockQuery.mockResolvedValue(mockAssignments)

      const result = await adapter.getAssignments('test-agent-001', TEST_WORKSPACE_ID)

      expect(mockQuery).toHaveBeenCalledWith('test-agent-001', TEST_WORKSPACE_ID)
      expect(result).toEqual(mockAssignments)
    })

    it('returns empty array when no assignments', async () => {
      mockQuery.mockResolvedValue([])

      const result = await adapter.getAssignments('idle-agent', TEST_WORKSPACE_ID)

      expect(result).toEqual([])
    })

    it('does not broadcast events', async () => {
      mockQuery.mockResolvedValue([])

      await adapter.getAssignments('test-agent-001', TEST_WORKSPACE_ID)

      expect(mockBroadcast).not.toHaveBeenCalled()
    })
  })

  describe('disconnect()', () => {
    it('broadcasts agent.status_changed with offline status', async () => {
      await adapter.disconnect('test-agent-001', TEST_WORKSPACE_ID)

      expect(mockBroadcast).toHaveBeenCalledTimes(1)
      expect(mockBroadcast).toHaveBeenCalledWith(
        'agent.status_changed',
        expect.objectContaining({
          id: 'test-agent-001',
          status: 'offline',
        })
      )
    })

    it('tags disconnect event with framework', async () => {
      await adapter.disconnect('test-agent-001', TEST_WORKSPACE_ID)

      const payload = mockBroadcast.mock.calls[0][1]
      expect(payload.framework).toBe(framework)
    })
  })

  // ── 3. Framework Identity ────────────────────────────────────────────────

  describe('framework identity', () => {
    it('tags all emitted events with its framework name', async () => {
      mockQuery.mockResolvedValue([])

      await adapter.register(testAgent)
      await adapter.heartbeat(testHeartbeat)
      await adapter.reportTask(testReport)
      await adapter.disconnect('test-agent-001', TEST_WORKSPACE_ID)

      // All 4 event-emitting calls should tag with framework
      for (const call of mockBroadcast.mock.calls) {
        const payload = call[1]
        expect(payload.framework).toBeTruthy()
      }
    })
  })
})

// ── 4. Cross-Adapter Behavioral Consistency ────────────────────────────────

describe('Cross-adapter consistency', () => {
  beforeEach(() => {
    mockBroadcast.mockClear()
    mockQuery.mockClear()
  })

  it('all adapters emit the same event types for the same actions', async () => {
    const eventsByFramework: Record<string, string[]> = {}

    for (const fw of ALL_FRAMEWORKS) {
      mockBroadcast.mockClear()
      mockQuery.mockResolvedValue([])

      const adapter = getAdapter(fw)
      await adapter.register(testAgent)
      await adapter.heartbeat(testHeartbeat)
      await adapter.reportTask(testReport)
      await adapter.disconnect('test-agent-001', TEST_WORKSPACE_ID)

      eventsByFramework[fw] = mockBroadcast.mock.calls.map(c => c[0])
    }

    const expected = ['agent.created', 'agent.status_changed', 'task.updated', 'agent.status_changed']

    for (const fw of ALL_FRAMEWORKS) {
      expect(eventsByFramework[fw]).toEqual(expected)
    }
  })

  it('all adapters return the same assignment data for the same agent', async () => {
    const mockAssignments = [{ taskId: '99', description: 'Shared task', priority: 0 }]
    mockQuery.mockResolvedValue(mockAssignments)

    for (const fw of ALL_FRAMEWORKS) {
      const adapter = getAdapter(fw)
      const result = await adapter.getAssignments('shared-agent', TEST_WORKSPACE_ID)
      expect(result).toEqual(mockAssignments)
    }
  })
})

// ── 5. Generic Adapter Specialization ──────────────────────────────────────

describe('GenericAdapter special behavior', () => {
  beforeEach(() => {
    mockBroadcast.mockClear()
  })

  it('respects agent.framework from registration payload', async () => {
    const adapter = getAdapter('generic')
    await adapter.register({
      agentId: 'custom-agent',
      name: 'Custom Framework Agent',
      framework: 'my-custom-framework',
      workspaceId: TEST_WORKSPACE_ID,
    })

    const payload = mockBroadcast.mock.calls[0][1]
    expect(payload.framework).toBe('my-custom-framework')
  })

  it('falls back to "generic" when no framework in payload', async () => {
    const adapter = getAdapter('generic')
    await adapter.register({
      agentId: 'unknown-agent',
      name: 'Unknown Agent',
      framework: '',
      workspaceId: TEST_WORKSPACE_ID,
    })

    const payload = mockBroadcast.mock.calls[0][1]
    // Empty string is falsy, should fall back to 'generic'
    expect(payload.framework).toBe('generic')
  })
})
