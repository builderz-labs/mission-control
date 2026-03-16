import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  getScalingMetrics,
  evaluateScaling,
  executeScaleUp,
  executeScaleDown,
  getGlobalAgentCap,
} from '@/lib/scaling-engine'
import { eventBus } from '@/lib/event-bus'

function createMockDb() {
  const calls: Array<{ sql: string; stmt: Record<string, unknown> }> = []

  const db = {
    prepare: vi.fn((sql: string) => {
      const entry = calls.find(c => sql.includes(c.sql))
      if (entry) return entry.stmt
      // Default: return a no-op statement
      return { get: vi.fn(), run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }), all: vi.fn().mockReturnValue([]) }
    }),
    _when: (sqlFragment: string, stmt: Record<string, unknown>) => {
      calls.push({ sql: sqlFragment, stmt })
    },
  }
  return db
}

describe('scaling-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.MC_GLOBAL_AGENT_CAP
  })

  describe('getGlobalAgentCap', () => {
    it('returns default 20 when no env var', () => {
      expect(getGlobalAgentCap()).toBe(20)
    })

    it('returns env var value when set', () => {
      process.env.MC_GLOBAL_AGENT_CAP = '50'
      expect(getGlobalAgentCap()).toBe(50)
    })

    it('returns default for invalid env var', () => {
      process.env.MC_GLOBAL_AGENT_CAP = 'abc'
      expect(getGlobalAgentCap()).toBe(20)
    })
  })

  describe('getScalingMetrics', () => {
    it('computes metrics from DB state', () => {
      const db = createMockDb()
      db._when('FROM tasks', { get: vi.fn().mockReturnValue({ count: 8 }) })
      db._when('FROM agents', { all: vi.fn().mockReturnValue([
        { status: 'idle', count: 3 },
        { status: 'busy', count: 5 },
        { status: 'offline', count: 2 },
      ]) })

      const metrics = getScalingMetrics(db as never, 1)
      expect(metrics.queueDepth).toBe(8)
      expect(metrics.activeAgents).toBe(8)
      expect(metrics.idleAgents).toBe(3)
      expect(metrics.busyAgents).toBe(5)
      expect(metrics.busyRatio).toBeCloseTo(0.625)
    })

    it('handles zero agents gracefully', () => {
      const db = createMockDb()
      db._when('FROM tasks', { get: vi.fn().mockReturnValue({ count: 0 }) })
      db._when('FROM agents', { all: vi.fn().mockReturnValue([]) })

      const metrics = getScalingMetrics(db as never, 1)
      expect(metrics.busyRatio).toBe(0)
    })
  })

  describe('evaluateScaling', () => {
    it('returns null for disabled policy', () => {
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue({ id: 1, enabled: 0 }) })

      expect(evaluateScaling(db as never, 1, 1)).toBeNull()
    })

    it('returns null for nonexistent policy', () => {
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue(undefined) })

      expect(evaluateScaling(db as never, 1, 1)).toBeNull()
    })

    it('returns null when in cooldown', () => {
      const now = Math.floor(Date.now() / 1000)
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue({
        id: 1, name: 'test', min_agents: 1, max_agents: 10,
        scale_up_threshold: 5, cooldown_seconds: 60, idle_timeout_seconds: 300,
        enabled: 1, workspace_id: 1,
      }) })
      db._when('scaling_events', { get: vi.fn().mockReturnValue({ resolved_at: now - 30 }) })

      expect(evaluateScaling(db as never, 1, 1)).toBeNull()
    })

    it('triggers scale-up when queue exceeds threshold', () => {
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue({
        id: 1, name: 'test', min_agents: 1, max_agents: 10,
        scale_up_threshold: 5, scale_down_threshold: 0,
        cooldown_seconds: 60, idle_timeout_seconds: 300,
        auto_approve: 0, agent_template: null, enabled: 1, workspace_id: 1,
      }) })
      // No recent events (cooldown clear)
      db._when('resolved_at', { get: vi.fn().mockReturnValue(undefined) })
      // Queue depth above threshold
      db._when('FROM tasks', { get: vi.fn().mockReturnValue({ count: 10 }) })
      // Agent statuses
      db._when('GROUP BY status', { all: vi.fn().mockReturnValue([
        { status: 'idle', count: 2 }, { status: 'busy', count: 3 },
      ]) })
      // Total agents under cap
      db._when('COUNT(*) as count FROM agents', { get: vi.fn().mockReturnValue({ count: 5 }) })
      // INSERT event
      db._when('INSERT INTO scaling_events', { run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }) })

      const event = evaluateScaling(db as never, 1, 1)
      expect(event).not.toBeNull()
      expect(event!.event_type).toBe('scale_up')
      expect(event!.status).toBe('pending')
      expect(event!.reason).toContain('Queue depth 10')
    })

    it('blocks scale-up when at max_agents', () => {
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue({
        id: 1, name: 'test', min_agents: 1, max_agents: 10,
        scale_up_threshold: 5, scale_down_threshold: 0,
        cooldown_seconds: 60, idle_timeout_seconds: 300,
        enabled: 1, workspace_id: 1,
      }) })
      db._when('resolved_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('FROM tasks', { get: vi.fn().mockReturnValue({ count: 10 }) })
      db._when('GROUP BY status', { all: vi.fn().mockReturnValue([{ status: 'busy', count: 10 }]) })
      db._when('COUNT(*) as count FROM agents', { get: vi.fn().mockReturnValue({ count: 10 }) })

      expect(evaluateScaling(db as never, 1, 1)).toBeNull()
    })

    it('blocks scale-up when at global cap', () => {
      process.env.MC_GLOBAL_AGENT_CAP = '5'
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue({
        id: 1, name: 'test', min_agents: 1, max_agents: 10,
        scale_up_threshold: 5, scale_down_threshold: 0,
        cooldown_seconds: 60, idle_timeout_seconds: 300,
        enabled: 1, workspace_id: 1,
      }) })
      db._when('resolved_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('FROM tasks', { get: vi.fn().mockReturnValue({ count: 10 }) })
      db._when('GROUP BY status', { all: vi.fn().mockReturnValue([{ status: 'busy', count: 3 }]) })
      db._when('COUNT(*) as count FROM agents', { get: vi.fn().mockReturnValue({ count: 5 }) })

      expect(evaluateScaling(db as never, 1, 1)).toBeNull()
    })

    it('broadcasts evaluation triggered event', () => {
      const db = createMockDb()
      db._when('scaling_policies', { get: vi.fn().mockReturnValue({
        id: 1, name: 'test', min_agents: 1, max_agents: 10,
        scale_up_threshold: 5, scale_down_threshold: 0,
        cooldown_seconds: 60, idle_timeout_seconds: 300,
        enabled: 1, workspace_id: 1,
      }) })
      db._when('resolved_at', { get: vi.fn().mockReturnValue(undefined) })
      db._when('FROM tasks', { get: vi.fn().mockReturnValue({ count: 2 }) })
      db._when('GROUP BY status', { all: vi.fn().mockReturnValue([]) })
      db._when('COUNT(*) as count FROM agents', { get: vi.fn().mockReturnValue({ count: 3 }) })

      evaluateScaling(db as never, 1, 1)
      expect(eventBus.broadcast).toHaveBeenCalledWith('scaling.evaluation.triggered', expect.objectContaining({
        queueDepth: 2,
      }))
    })
  })

  describe('executeScaleUp', () => {
    it('creates agent and updates event', () => {
      const db = createMockDb()
      db._when('scaling_events WHERE id', { get: vi.fn().mockReturnValue({
        id: 1, policy_id: 1, event_type: 'scale_up', status: 'pending', workspace_id: 1,
      }) })
      db._when('agent_template', { get: vi.fn().mockReturnValue({ agent_template: 'engineer' }) })
      db._when('INSERT INTO agents', { run: vi.fn().mockReturnValue({ lastInsertRowid: 99 }) })
      db._when('UPDATE scaling_events', { run: vi.fn() })

      const agentId = executeScaleUp(db as never, 1, 1)
      expect(agentId).toBe(99)
      expect(eventBus.broadcast).toHaveBeenCalledWith('scaling.hire.approved', expect.objectContaining({
        agentId: 99,
        templateName: 'engineer',
      }))
    })

    it('throws for non-pending event', () => {
      const db = createMockDb()
      db._when('scaling_events WHERE id', { get: vi.fn().mockReturnValue({ id: 1, status: 'completed' }) })

      expect(() => executeScaleUp(db as never, 1, 1)).toThrow('not pending')
    })

    it('throws for nonexistent event', () => {
      const db = createMockDb()
      db._when('scaling_events WHERE id', { get: vi.fn().mockReturnValue(undefined) })

      expect(() => executeScaleUp(db as never, 999, 1)).toThrow('not found')
    })
  })

  describe('executeScaleDown', () => {
    it('retires agent and updates event', () => {
      const updateAgentRun = vi.fn()
      const updateEventRun = vi.fn()
      const db = createMockDb()
      db._when('UPDATE agents', { run: updateAgentRun })
      db._when('UPDATE scaling_events', { run: updateEventRun })

      executeScaleDown(db as never, 1, 42, 1)
      expect(updateAgentRun).toHaveBeenCalled()
      expect(updateEventRun).toHaveBeenCalled()
      expect(eventBus.broadcast).toHaveBeenCalledWith('scaling.retire.initiated', expect.objectContaining({
        agentId: 42,
      }))
    })
  })
})
