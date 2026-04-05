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

// ---------------------------------------------------------------------------
// Council Deliberation Events
// ---------------------------------------------------------------------------

export function emitDeliberationStarted(deliberationId: number, topic: string, workspaceId: number): void {
  eventBus.broadcast('council.deliberation_started', { deliberationId, topic, workspaceId, timestamp: Date.now() })
}

export function emitDeliberationCompleted(deliberationId: number, synthesis: string, workspaceId: number): void {
  logger.info({ deliberationId }, 'Council deliberation completed')
  eventBus.broadcast('council.deliberation_completed', { deliberationId, synthesis, workspaceId, timestamp: Date.now() })
}

export function emitVoteCast(deliberationId: number, agentId: string, round: number, stance: string): void {
  eventBus.broadcast('council.vote_cast', { deliberationId, agentId, round, stance, timestamp: Date.now() })
}

export function emitSynthesisReached(deliberationId: number, consensus: number): void {
  logger.info({ deliberationId, consensus }, 'Council synthesis reached')
  eventBus.broadcast('council.synthesis_reached', { deliberationId, consensus, timestamp: Date.now() })
}

// ---------------------------------------------------------------------------
// Browser Automation Events
// ---------------------------------------------------------------------------

export function emitBrowseStepCompleted(sessionId: number, step: string, elapsed: number): void {
  eventBus.broadcast('browse.step_completed', { sessionId, step, elapsed, timestamp: Date.now() })
}

export function emitBrowsePageCaptured(sessionId: number, url: string, hasScreenshot: boolean): void {
  eventBus.broadcast('browse.page_captured', { sessionId, url, hasScreenshot, timestamp: Date.now() })
}

export function emitBrowseSessionEnded(sessionId: number, status: string): void {
  eventBus.broadcast('browse.session_ended', { sessionId, status, timestamp: Date.now() })
}

// ---------------------------------------------------------------------------
// Governance Gate Events
// ---------------------------------------------------------------------------

export function emitGatePassed(taskId: number | null, gateType: string, score: number): void {
  logger.info({ taskId, gateType, score }, 'Governance gate passed')
  eventBus.broadcast('governance.gate_passed', { taskId, gateType, score, timestamp: Date.now() })
}

export function emitGateFailed(taskId: number | null, gateType: string, score: number, threshold: number): void {
  logger.warn({ taskId, gateType, score, threshold }, 'Governance gate failed')
  eventBus.broadcast('governance.gate_failed', { taskId, gateType, score, threshold, timestamp: Date.now() })
}

export function emitReviewRequired(taskId: number | null, gateType: string, reason: string): void {
  logger.warn({ taskId, gateType, reason }, 'Governance review required')
  eventBus.broadcast('governance.review_required', { taskId, gateType, reason, timestamp: Date.now() })
}
