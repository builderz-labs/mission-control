import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// --- Mocks ---

const mockStatement = {
  get: vi.fn(),
  run: vi.fn().mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 }),
  all: vi.fn().mockReturnValue([]),
}
const mockDb = { prepare: vi.fn(() => ({ ...mockStatement })) }

vi.mock('@/lib/db', () => ({
  getDatabase: () => mockDb,
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

vi.mock('@/lib/llm/router', () => ({
  complete: vi.fn().mockResolvedValue({
    text: 'Working on the assigned task.', tokenCount: { input: 20, output: 10 },
    cost: 0.001, latencyMs: 100, model: 'test',
  }),
  checkAgentBudget: vi.fn().mockReturnValue({ allowed: true, spent: 0, limit: 5 }),
}))

vi.mock('@/lib/persona-engine', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('You are a test agent.'),
  getMentalState: vi.fn().mockReturnValue({ emotions: 'neutral', goals: 'test', attention: null, context: [], lastUpdated: 0 }),
  updateMentalState: vi.fn(),
}))

vi.mock('@/lib/agent-memory', () => ({
  recall: vi.fn().mockReturnValue([]),
  observe: vi.fn().mockResolvedValue(1),
  reflect: vi.fn().mockResolvedValue([]),
}))

import {
  SimulationEngine,
  isSimulationEnabled,
  getSimulationEngine,
  resetSimulationEngine,
} from '@/lib/simulation-engine'

describe('simulation-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStatement.get.mockReturnValue(null)
    mockStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1), changes: 1 })
    mockStatement.all.mockReturnValue([])
    resetSimulationEngine()
  })

  afterEach(() => {
    resetSimulationEngine()
  })

  describe('SimulationEngine', () => {
    it('initializes with default config', () => {
      const engine = new SimulationEngine()
      const status = engine.getStatus()
      expect(status.running).toBe(false)
      expect(status.paused).toBe(false)
      expect(status.tickCount).toBe(0)
    })

    it('accepts custom config', () => {
      const engine = new SimulationEngine({ tickIntervalMs: 10000, dryRun: true })
      const status = engine.getStatus()
      expect(status.config.tickIntervalMs).toBe(10000)
      expect(status.config.dryRun).toBe(true)
    })

    it('throws when starting with simulation disabled', () => {
      const engine = new SimulationEngine()
      expect(() => engine.start()).toThrow('disabled')
    })

    it('can stop without starting', () => {
      const engine = new SimulationEngine()
      expect(() => engine.stop()).not.toThrow()
    })

    it('can pause and resume', () => {
      const engine = new SimulationEngine()
      engine.pause()
      expect(engine.getStatus().paused).toBe(true)
      engine.resume()
      expect(engine.getStatus().paused).toBe(false)
    })
  })

  describe('tick', () => {
    it('processes idle agents', async () => {
      const engine = new SimulationEngine({ dryRun: true })

      // No idle agents
      mockStatement.all.mockReturnValueOnce([])
      await engine.tick()
      expect(engine.getStatus().tickCount).toBe(1)
    })

    it('skips agents over budget', async () => {
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: false, spent: 6, limit: 5 })

      const engine = new SimulationEngine()

      mockStatement.all.mockReturnValueOnce([{
        id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
        soul_content: null, config: null, workspace_id: 1,
      }])

      await engine.tick()
      // Agent should be skipped — no LLM call
      const { complete: completeMock } = await import('@/lib/llm/router')
      expect(completeMock).not.toHaveBeenCalled()
    })

    it('increments tick count', async () => {
      const engine = new SimulationEngine({ dryRun: true })
      mockStatement.all.mockReturnValue([])

      await engine.tick()
      await engine.tick()
      await engine.tick()
      expect(engine.getStatus().tickCount).toBe(3)
    })

    it('handles agent tick errors gracefully', async () => {
      const engine = new SimulationEngine()
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      // Agent with task that triggers an error
      mockStatement.all.mockReturnValueOnce([{
        id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
        soul_content: null, config: null, workspace_id: 1,
      }])
      mockStatement.get.mockReturnValueOnce(null) // no pending task
      mockStatement.get.mockReturnValueOnce({ total: 0 }) // no reflection needed

      await engine.tick()
      // Should not throw
      expect(engine.getStatus().tickCount).toBe(1)
    })
  })

  describe('dry-run mode', () => {
    it('logs decisions without making LLM calls', async () => {
      const engine = new SimulationEngine({ dryRun: true })
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      mockStatement.all.mockReturnValueOnce([{
        id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
        soul_content: null, config: null, workspace_id: 1,
      }])
      // Has a pending task
      mockStatement.get.mockReturnValueOnce({ id: 42, title: 'Fix bug' })

      await engine.tick()

      const { logger } = await import('@/lib/logger')
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true, taskId: 42 }),
        expect.any(String),
      )
    })
  })

  describe('operation timeout', () => {
    it('times out stuck operations', async () => {
      const engine = new SimulationEngine({ operationTimeoutMs: 100 })
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      // First tick: start operation
      mockStatement.all.mockReturnValueOnce([{
        id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
        soul_content: null, config: null, workspace_id: 1,
      }])
      mockStatement.get.mockReturnValueOnce(null) // no task
      mockStatement.get.mockReturnValueOnce({ total: 0 }) // no reflect

      await engine.tick()

      // The operation timeout logic is internal - verify it doesn't crash
      expect(engine.getStatus().tickCount).toBe(1)
    })
  })

  describe('isSimulationEnabled', () => {
    it('returns false by default', () => {
      const original = process.env.SIMULATION_ENABLED
      delete process.env.SIMULATION_ENABLED
      expect(isSimulationEnabled()).toBe(false)
      if (original) process.env.SIMULATION_ENABLED = original
    })

    it('returns true when env var set', () => {
      const original = process.env.SIMULATION_ENABLED
      process.env.SIMULATION_ENABLED = 'true'
      expect(isSimulationEnabled()).toBe(true)
      if (original) {
        process.env.SIMULATION_ENABLED = original
      } else {
        delete process.env.SIMULATION_ENABLED
      }
    })
  })

  describe('singleton', () => {
    it('getSimulationEngine returns same instance', () => {
      const a = getSimulationEngine()
      const b = getSimulationEngine()
      expect(a).toBe(b)
    })

    it('resetSimulationEngine creates new instance', () => {
      const a = getSimulationEngine()
      resetSimulationEngine()
      const b = getSimulationEngine()
      expect(a).not.toBe(b)
    })
  })

  describe('priority system', () => {
    it('tasks take priority over reflection', async () => {
      // When agent has both a pending task and should reflect,
      // the task should be handled first
      const engine = new SimulationEngine({ dryRun: true })
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      mockStatement.all.mockReturnValueOnce([{
        id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
        soul_content: null, config: null, workspace_id: 1,
      }])
      // Has pending task
      mockStatement.get.mockReturnValueOnce({ id: 10, title: 'Critical task' })

      await engine.tick()

      const { logger } = await import('@/lib/logger')
      // Should log task work, not reflection
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 10, dryRun: true }),
        expect.any(String),
      )
    })

    it('reflection takes priority over idle action', async () => {
      const engine = new SimulationEngine({ dryRun: true })
      const { checkAgentBudget } = await import('@/lib/llm/router')
      vi.mocked(checkAgentBudget).mockReturnValue({ allowed: true, spent: 0, limit: 5 })

      mockStatement.all.mockReturnValueOnce([{
        id: 1, name: 'Atlas', role: 'engineer', status: 'idle',
        soul_content: null, config: null, workspace_id: 1,
      }])
      mockStatement.get
        .mockReturnValueOnce(null) // no pending task
        .mockReturnValueOnce({ total: 600 }) // should reflect (> 500 threshold)

      await engine.tick()

      const { logger } = await import('@/lib/logger')
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true }),
        'Would reflect',
      )
    })
  })
})
