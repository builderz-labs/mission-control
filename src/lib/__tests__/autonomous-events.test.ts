/**
 * Tests for src/lib/autonomous-events.ts
 * Verifies each event emitter calls eventBus.broadcast with the correct payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock before importing the module under test
vi.mock('../event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))
vi.mock('../logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}))

import { eventBus } from '../event-bus'
import { logger } from '../logger'
import {
  emitHealthCheckCompleted,
  emitCircuitTripped,
  emitCircuitRecovered,
  emitRecoveryAttempted,
  emitServiceDegraded,
  emitServiceRestored,
  emitPatternStored,
  emitPatternApplied,
  emitFeedbackReceived,
  emitRegressionDetected,
  emitSuggestionCreated,
  emitCostSpike,
} from '../autonomous-events'

const broadcast = vi.mocked(eventBus.broadcast)
const logWarn = vi.mocked(logger.warn)
const logInfo = vi.mocked(logger.info)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('emitHealthCheckCompleted', () => {
  it('broadcasts health.check_completed with correct counts', () => {
    emitHealthCheckCompleted({ healthy: 5, degraded: 1, down: 0 })
    expect(broadcast).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledWith('health.check_completed', { healthy: 5, degraded: 1, down: 0 })
  })
})

describe('emitCircuitTripped', () => {
  it('warns and broadcasts health.circuit_tripped', () => {
    emitCircuitTripped('database', 3)
    expect(logWarn).toHaveBeenCalledWith({ service: 'database', failureCount: 3 }, 'Circuit breaker tripped')
    expect(broadcast).toHaveBeenCalledWith('health.circuit_tripped', expect.objectContaining({
      service: 'database',
      failureCount: 3,
    }))
  })

  it('includes a timestamp', () => {
    const before = Date.now()
    emitCircuitTripped('redis', 5)
    const [, payload] = broadcast.mock.calls[0] as [string, { timestamp: number }]
    expect(payload.timestamp).toBeGreaterThanOrEqual(before)
  })
})

describe('emitCircuitRecovered', () => {
  it('logs info and broadcasts health.circuit_recovered', () => {
    emitCircuitRecovered('database')
    expect(logInfo).toHaveBeenCalledWith({ service: 'database' }, 'Circuit breaker recovered')
    expect(broadcast).toHaveBeenCalledWith('health.circuit_recovered', expect.objectContaining({ service: 'database' }))
  })
})

describe('emitRecoveryAttempted', () => {
  it('broadcasts health.recovery_attempted with service, result, action', () => {
    emitRecoveryAttempted('auth', 'success', 'restart')
    expect(broadcast).toHaveBeenCalledWith('health.recovery_attempted', expect.objectContaining({
      service: 'auth',
      result: 'success',
      action: 'restart',
    }))
  })
})

describe('emitServiceDegraded', () => {
  it('warns and broadcasts health.service_degraded', () => {
    emitServiceDegraded('llm', 'high latency')
    expect(logWarn).toHaveBeenCalledWith({ service: 'llm', reason: 'high latency' }, 'Service degraded')
    expect(broadcast).toHaveBeenCalledWith('health.service_degraded', expect.objectContaining({
      service: 'llm',
      reason: 'high latency',
    }))
  })
})

describe('emitServiceRestored', () => {
  it('logs info and broadcasts health.service_restored', () => {
    emitServiceRestored('llm')
    expect(logInfo).toHaveBeenCalledWith({ service: 'llm' }, 'Service restored')
    expect(broadcast).toHaveBeenCalledWith('health.service_restored', expect.objectContaining({ service: 'llm' }))
  })
})

describe('emitPatternStored', () => {
  it('broadcasts learning.pattern_stored', () => {
    emitPatternStored(42, 'success', 0.95)
    expect(broadcast).toHaveBeenCalledWith('learning.pattern_stored', { patternId: 42, patternType: 'success', confidence: 0.95 })
  })
})

describe('emitPatternApplied', () => {
  it('broadcasts learning.pattern_applied with taskId', () => {
    emitPatternApplied(7, 100, 0.8)
    expect(broadcast).toHaveBeenCalledWith('learning.pattern_applied', { patternId: 7, taskId: 100, relevance: 0.8 })
  })

  it('broadcasts learning.pattern_applied when taskId is null', () => {
    emitPatternApplied(7, null, 0.5)
    expect(broadcast).toHaveBeenCalledWith('learning.pattern_applied', { patternId: 7, taskId: null, relevance: 0.5 })
  })
})

describe('emitFeedbackReceived', () => {
  it('broadcasts learning.feedback_received', () => {
    emitFeedbackReceived(10, 5, 42)
    expect(broadcast).toHaveBeenCalledWith('learning.feedback_received', { feedbackId: 10, rating: 5, patternId: 42 })
  })

  it('broadcasts with null patternId', () => {
    emitFeedbackReceived(11, 3, null)
    expect(broadcast).toHaveBeenCalledWith('learning.feedback_received', { feedbackId: 11, rating: 3, patternId: null })
  })
})

describe('emitRegressionDetected', () => {
  it('warns and broadcasts improving.regression_detected', () => {
    emitRegressionDetected('taskCreate', 200, 800)
    expect(logWarn).toHaveBeenCalledWith(
      { operation: 'taskCreate', baselineMs: 200, currentMs: 800 },
      'Performance regression detected',
    )
    expect(broadcast).toHaveBeenCalledWith('improving.regression_detected', {
      operation: 'taskCreate',
      baselineMs: 200,
      currentMs: 800,
    })
  })
})

describe('emitSuggestionCreated', () => {
  it('broadcasts improving.suggestion_created', () => {
    emitSuggestionCreated('performance', 'high', 'Optimize slow query')
    expect(broadcast).toHaveBeenCalledWith('improving.suggestion_created', {
      category: 'performance',
      severity: 'high',
      title: 'Optimize slow query',
    })
  })
})

describe('emitCostSpike', () => {
  it('warns and broadcasts improving.cost_spike', () => {
    emitCostSpike('agent-001', 0.15, 0.10)
    expect(logWarn).toHaveBeenCalledWith(
      { agentId: 'agent-001', costUsd: 0.15, threshold: 0.10 },
      'Cost spike detected',
    )
    expect(broadcast).toHaveBeenCalledWith('improving.cost_spike', {
      agentId: 'agent-001',
      costUsd: 0.15,
      threshold: 0.10,
    })
  })
})
