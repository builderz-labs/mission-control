/**
 * Adapter API Route Integration Tests
 *
 * Tests the POST /api/adapters dispatcher against all frameworks.
 * Simulates what an external agent would do to connect to Mission Control.
 *
 * This is the "Feynman test" — timing how long it takes a stranger's
 * agent to connect via the HTTP API.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAdapter, listAdapters } from '../index'

// These tests verify the API contract from the external agent's perspective.
// They don't hit the HTTP layer (that's E2E) but verify the adapter dispatch
// logic matches what the API route does.

const mockBroadcast = vi.fn()
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: (...args: unknown[]) => mockBroadcast(...args) },
}))

const mockQuery = vi.fn()
vi.mock('../adapter', async (importOriginal) => {
  const original = await importOriginal<typeof import('../adapter')>()
  return {
    ...original,
    queryPendingAssignments: (...args: unknown[]) => mockQuery(...args),
  }
})

// Simulate what POST /api/adapters does internally
async function simulateAdapterAction(
  framework: string,
  action: string,
  payload: Record<string, unknown>
): Promise<{ ok?: boolean; assignments?: unknown[]; error?: string }> {
  const workspaceId = 7
  let adapter
  try {
    adapter = getAdapter(framework)
  } catch {
    return { error: `Unknown framework: ${framework}` }
  }

  switch (action) {
    case 'register': {
      const { agentId, name, metadata } = payload
      if (!agentId || !name) return { error: 'payload.agentId and payload.name required' }
      await adapter.register({
        agentId: agentId as string,
        name: name as string,
        framework,
        metadata: metadata as Record<string, unknown>,
        workspaceId,
      })
      return { ok: true }
    }
    case 'heartbeat': {
      const { agentId, status, metrics } = payload
      if (!agentId) return { error: 'payload.agentId required' }
      await adapter.heartbeat({
        agentId: agentId as string,
        status: (status as string) || 'online',
        metrics: metrics as Record<string, unknown>,
        workspaceId,
      })
      return { ok: true }
    }
    case 'report': {
      const { taskId, agentId, progress, status, output } = payload
      if (!taskId || !agentId) return { error: 'payload.taskId and payload.agentId required' }
      await adapter.reportTask({
        taskId: taskId as string,
        agentId: agentId as string,
        progress: (progress as number) ?? 0,
        status: (status as string) || 'in_progress',
        output,
        workspaceId,
      })
      return { ok: true }
    }
    case 'assignments': {
      const { agentId } = payload
      if (!agentId) return { error: 'payload.agentId required' }
      const assignments = await adapter.getAssignments(agentId as string, workspaceId)
      return { assignments }
    }
    case 'disconnect': {
      const { agentId } = payload
      if (!agentId) return { error: 'payload.agentId required' }
      await adapter.disconnect(agentId as string, workspaceId)
      return { ok: true }
    }
    default:
      return { error: `Unknown action: ${action}` }
  }
}

describe('Adapter API dispatch', () => {
  beforeEach(() => {
    mockBroadcast.mockClear()
    mockQuery.mockClear()
  })

  // Full lifecycle for every framework
  describe.each(listAdapters())('Full agent lifecycle: %s', (framework) => {
    it('register → heartbeat → report → assignments → disconnect', async () => {
      mockQuery.mockResolvedValue([{ taskId: '1', description: 'Do stuff', priority: 1 }])

      // 1. Register
      const reg = await simulateAdapterAction(framework, 'register', {
        agentId: `${framework}-agent-1`,
        name: `${framework} Test Agent`,
        metadata: { version: '2.0' },
      })
      expect(reg.ok).toBe(true)

      // 2. Heartbeat
      const hb = await simulateAdapterAction(framework, 'heartbeat', {
        agentId: `${framework}-agent-1`,
        status: 'busy',
        metrics: { tasksInProgress: 1 },
      })
      expect(hb.ok).toBe(true)

      // 3. Report task progress
      const rpt = await simulateAdapterAction(framework, 'report', {
        taskId: 'task-abc',
        agentId: `${framework}-agent-1`,
        progress: 50,
        status: 'in_progress',
        output: { log: 'halfway done' },
      })
      expect(rpt.ok).toBe(true)

      // 4. Get assignments
      const asgn = await simulateAdapterAction(framework, 'assignments', {
        agentId: `${framework}-agent-1`,
      })
      expect(asgn.assignments).toHaveLength(1)

      // 5. Disconnect
      const disc = await simulateAdapterAction(framework, 'disconnect', {
        agentId: `${framework}-agent-1`,
      })
      expect(disc.ok).toBe(true)

      // Verify event sequence
      const eventTypes = mockBroadcast.mock.calls.map(c => c[0])
      expect(eventTypes).toEqual([
        'agent.created',
        'agent.status_changed',
        'task.updated',
        'agent.status_changed',
      ])
    })
  })

  // Validation checks
  describe('input validation', () => {
    it('rejects unknown framework', async () => {
      const result = await simulateAdapterAction('totally-fake', 'register', {
        agentId: 'x', name: 'X',
      })
      expect(result.error).toContain('Unknown framework')
    })

    it('rejects unknown action', async () => {
      const result = await simulateAdapterAction('generic', 'explode', {})
      expect(result.error).toContain('Unknown action')
    })

    it('rejects register without agentId', async () => {
      const result = await simulateAdapterAction('generic', 'register', { name: 'No ID' })
      expect(result.error).toContain('agentId')
    })

    it('rejects register without name', async () => {
      const result = await simulateAdapterAction('generic', 'register', { agentId: 'no-name' })
      expect(result.error).toContain('name')
    })

    it('rejects heartbeat without agentId', async () => {
      const result = await simulateAdapterAction('generic', 'heartbeat', {})
      expect(result.error).toContain('agentId')
    })

    it('rejects report without taskId', async () => {
      const result = await simulateAdapterAction('generic', 'report', { agentId: 'x' })
      expect(result.error).toContain('taskId')
    })

    it('rejects assignments without agentId', async () => {
      const result = await simulateAdapterAction('generic', 'assignments', {})
      expect(result.error).toContain('agentId')
    })

    it('rejects disconnect without agentId', async () => {
      const result = await simulateAdapterAction('generic', 'disconnect', {})
      expect(result.error).toContain('agentId')
    })
  })
})
