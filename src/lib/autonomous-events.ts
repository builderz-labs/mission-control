/**
 * Autonomous Engine Event Integration
 *
 * Wires self-healing, self-learning, and self-improving engines
 * to the SSE event bus so the dashboard receives real-time updates.
 */

import { eventBus } from './event-bus'
import { logger } from './logger'

// ---------------------------------------------------------------------------
// Self-Healing Events
// ---------------------------------------------------------------------------

export function emitHealthCheckCompleted(results: {
  readonly healthy: number
  readonly degraded: number
  readonly down: number
}): void {
  eventBus.broadcast('health.check_completed', results)
}

export function emitCircuitTripped(service: string, failureCount: number): void {
  logger.warn({ service, failureCount }, 'Circuit breaker tripped')
  eventBus.broadcast('health.circuit_tripped', { service, failureCount, timestamp: Date.now() })
}

export function emitCircuitRecovered(service: string): void {
  logger.info({ service }, 'Circuit breaker recovered')
  eventBus.broadcast('health.circuit_recovered', { service, timestamp: Date.now() })
}

export function emitRecoveryAttempted(service: string, result: string, action: string): void {
  eventBus.broadcast('health.recovery_attempted', { service, result, action, timestamp: Date.now() })
}

export function emitServiceDegraded(service: string, reason: string): void {
  logger.warn({ service, reason }, 'Service degraded')
  eventBus.broadcast('health.service_degraded', { service, reason, timestamp: Date.now() })
}

export function emitServiceRestored(service: string): void {
  logger.info({ service }, 'Service restored')
  eventBus.broadcast('health.service_restored', { service, timestamp: Date.now() })
}

// ---------------------------------------------------------------------------
// Self-Learning Events
// ---------------------------------------------------------------------------

export function emitPatternStored(patternId: number, patternType: string, confidence: number): void {
  eventBus.broadcast('learning.pattern_stored', { patternId, patternType, confidence })
}

export function emitPatternApplied(patternId: number, taskId: number | null, relevance: number): void {
  eventBus.broadcast('learning.pattern_applied', { patternId, taskId, relevance })
}

export function emitFeedbackReceived(feedbackId: number, rating: number, patternId: number | null): void {
  eventBus.broadcast('learning.feedback_received', { feedbackId, rating, patternId })
}

// ---------------------------------------------------------------------------
// Self-Improving Events
// ---------------------------------------------------------------------------

export function emitRegressionDetected(operation: string, baselineMs: number, currentMs: number): void {
  logger.warn({ operation, baselineMs, currentMs }, 'Performance regression detected')
  eventBus.broadcast('improving.regression_detected', { operation, baselineMs, currentMs })
}

export function emitSuggestionCreated(
  category: string,
  severity: string,
  title: string
): void {
  eventBus.broadcast('improving.suggestion_created', { category, severity, title })
}

export function emitCostSpike(agentId: string, costUsd: number, threshold: number): void {
  logger.warn({ agentId, costUsd, threshold }, 'Cost spike detected')
  eventBus.broadcast('improving.cost_spike', { agentId, costUsd, threshold })
}
