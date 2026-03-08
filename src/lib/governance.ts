/**
 * Governance Engine for Mission Control
 *
 * Enforces:
 * - Mandatory fields before assignment
 * - Strict status transitions
 * - Evidence-before-done validation
 * - SLA timers (ack_by, first_artifact_by, stale_at)
 * - WIP limits per agent
 * - Retry caps
 * - Blocked reason categorisation
 */

import type { Task } from './db'

// ---------------------------------------------------------------------------
// Priority Tier SLA Definitions (seconds)
// ---------------------------------------------------------------------------

export type PriorityTier = 'P0' | 'P1' | 'P2' | 'P3'
export type SlaStatus = 'on_track' | 'at_risk' | 'breached'
export type BlockedType = 'dependency' | 'decision' | 'inactivity'
export type TaskStatus = Task['status']

export interface SlaTiming {
  ackSeconds: number
  firstArtifactSeconds: number
  staleSeconds: number
  /** Fraction of deadline at which task becomes "at_risk" (e.g. 0.75 = 75%) */
  atRiskThreshold: number
}

const SLA_TIMINGS: Record<PriorityTier, SlaTiming> = {
  P0: { ackSeconds: 15 * 60, firstArtifactSeconds: 60 * 60, staleSeconds: 4 * 3600, atRiskThreshold: 0.75 },
  P1: { ackSeconds: 2 * 3600, firstArtifactSeconds: 8 * 3600, staleSeconds: 24 * 3600, atRiskThreshold: 0.75 },
  P2: { ackSeconds: 8 * 3600, firstArtifactSeconds: 24 * 3600, staleSeconds: 3 * 86400, atRiskThreshold: 0.75 },
  P3: { ackSeconds: 24 * 3600, firstArtifactSeconds: 72 * 3600, staleSeconds: 14 * 86400, atRiskThreshold: 0.75 },
}

export function getSlaTiming(tier: PriorityTier): SlaTiming {
  return SLA_TIMINGS[tier]
}

export function isValidPriorityTier(value: string | undefined | null): value is PriorityTier {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3'
}

// ---------------------------------------------------------------------------
// SLA Deadline Computation
// ---------------------------------------------------------------------------

export interface SlaDeadlines {
  ack_by: number
  first_artifact_by: number
  stale_at: number
}

/**
 * Compute SLA deadlines from assignment timestamp and priority tier.
 */
export function computeSlaDeadlines(assignedAtEpoch: number, tier: PriorityTier): SlaDeadlines {
  const timing = SLA_TIMINGS[tier]
  return {
    ack_by: assignedAtEpoch + timing.ackSeconds,
    first_artifact_by: assignedAtEpoch + timing.firstArtifactSeconds,
    stale_at: assignedAtEpoch + timing.staleSeconds,
  }
}

/**
 * Evaluate current SLA status based on deadlines and current time.
 */
export function evaluateSlaStatus(
  now: number,
  tier: PriorityTier,
  deadlines: { ack_by?: number | null; first_artifact_by?: number | null; stale_at?: number | null },
  ackAt?: number | null,
  firstArtifactAt?: number | null
): SlaStatus {
  const timing = SLA_TIMINGS[tier]

  // Check for breaches
  if (deadlines.ack_by && !ackAt && now > deadlines.ack_by) return 'breached'
  if (deadlines.first_artifact_by && !firstArtifactAt && now > deadlines.first_artifact_by) return 'breached'
  if (deadlines.stale_at && now > deadlines.stale_at) return 'breached'

  // Check for at-risk (approaching breach)
  const threshold = timing.atRiskThreshold
  if (deadlines.ack_by && !ackAt) {
    const window = deadlines.ack_by - (deadlines.ack_by - timing.ackSeconds)
    if (now > deadlines.ack_by - window * (1 - threshold)) return 'at_risk'
  }
  if (deadlines.first_artifact_by && !firstArtifactAt) {
    const window = timing.firstArtifactSeconds
    const assignedAt = deadlines.first_artifact_by - window
    if (now > assignedAt + window * threshold) return 'at_risk'
  }

  return 'on_track'
}

// ---------------------------------------------------------------------------
// Status Transition Enforcement
// ---------------------------------------------------------------------------

/**
 * Valid transitions for the governance-enforced status flow.
 * inbox -> assigned (via assignment)
 * assigned -> in_progress | inbox (un-assignment)
 * in_progress -> review | assigned (revert)
 * review -> done | in_progress (rejection)
 * quality_review -> done | review (rejection)
 * done is terminal (no backward from done via API)
 *
 * Blocked is orthogonal — tracked via blocked_reason/blocked_type fields,
 * not as a separate status column value.
 */
const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  inbox: ['assigned'],
  assigned: ['in_progress', 'inbox'],
  in_progress: ['review', 'assigned'],
  review: ['done', 'quality_review', 'in_progress'],
  quality_review: ['done', 'review'],
  done: [], // terminal
}

export interface TransitionResult {
  allowed: boolean
  reason?: string
}

export function validateStatusTransition(from: TaskStatus, to: TaskStatus): TransitionResult {
  if (from === to) return { allowed: true }
  const allowed = ALLOWED_TRANSITIONS[from] ?? []
  if (allowed.includes(to)) return { allowed: true }
  return {
    allowed: false,
    reason: `Invalid status transition: ${from} → ${to}. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
  }
}

// ---------------------------------------------------------------------------
// Mandatory Fields for Assignment
// ---------------------------------------------------------------------------

export interface MandatoryFieldCheck {
  valid: boolean
  missing: string[]
}

/**
 * Validates that a task has all mandatory fields before it can leave inbox.
 * Required for status >= assigned: owner, deadline, context_note, definition_of_done, priority_tier
 */
export function validateMandatoryFieldsForAssignment(task: {
  assigned_to?: string | null
  due_date?: number | null
  context_note?: string | null
  definition_of_done?: string | null
  priority_tier?: string | null
}): MandatoryFieldCheck {
  const missing: string[] = []
  if (!task.assigned_to?.trim()) missing.push('assigned_to (owner)')
  if (!task.due_date) missing.push('due_date (deadline)')
  if (!task.context_note?.trim()) missing.push('context_note')
  if (!task.definition_of_done?.trim()) missing.push('definition_of_done')
  if (!isValidPriorityTier(task.priority_tier)) missing.push('priority_tier (P0/P1/P2/P3)')
  return { valid: missing.length === 0, missing }
}

// ---------------------------------------------------------------------------
// Evidence-Before-Done Validation
// ---------------------------------------------------------------------------

/**
 * Check that at least one comment or artifact exists on the task before
 * allowing transition to done.
 */
export function validateEvidenceForDone(commentCount: number): { valid: boolean; reason?: string } {
  if (commentCount > 0) return { valid: true }
  return {
    valid: false,
    reason: 'At least one comment or artifact is required before marking a task as done.',
  }
}

// ---------------------------------------------------------------------------
// WIP Limit Check
// ---------------------------------------------------------------------------

const DEFAULT_WIP_LIMIT = 3

export function getWipLimit(agentConfig?: { wip_limit?: number }): number {
  return agentConfig?.wip_limit ?? DEFAULT_WIP_LIMIT
}

export interface WipCheckResult {
  allowed: boolean
  current: number
  limit: number
  reason?: string
}

export function checkWipLimit(
  activeTaskCount: number,
  limit: number = DEFAULT_WIP_LIMIT
): WipCheckResult {
  if (activeTaskCount < limit) {
    return { allowed: true, current: activeTaskCount, limit }
  }
  return {
    allowed: false,
    current: activeTaskCount,
    limit,
    reason: `Agent WIP limit reached (${activeTaskCount}/${limit}). Complete or reassign existing tasks before taking new ones.`,
  }
}

// ---------------------------------------------------------------------------
// Retry Cap Check
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 5

export function checkRetryCap(
  retryCount: number,
  maxRetries: number = DEFAULT_MAX_RETRIES
): { allowed: boolean; reason?: string } {
  if (retryCount < maxRetries) return { allowed: true }
  return {
    allowed: false,
    reason: `Retry cap reached (${retryCount}/${maxRetries}). Requires human review before further retries.`,
  }
}

// ---------------------------------------------------------------------------
// Blocked Reason Validation
// ---------------------------------------------------------------------------

export function isValidBlockedType(value: string | undefined | null): value is BlockedType {
  return value === 'dependency' || value === 'decision' || value === 'inactivity'
}

// ---------------------------------------------------------------------------
// Agent Progress Update Helper
// ---------------------------------------------------------------------------

export interface ProgressAction {
  action: 'update' | 'blocked' | 'unblocked' | 'complete'
  agent: string
  message: string
  blocked_type?: BlockedType
  blocked_reason?: string
  artifacts?: string[]
}

/**
 * Compute task field updates from an agent progress report.
 * Pure function — no DB access — for easy testing.
 */
export function computeProgressUpdates(
  task: Pick<Task, 'status' | 'retry_count'> & { max_retries?: number; ack_at?: number; first_artifact_at?: number },
  progress: ProgressAction,
  now: number = Math.floor(Date.now() / 1000),
): { fields: Record<string, any>; error?: string } {
  const fields: Record<string, any> = { updated_at: now }

  switch (progress.action) {
    case 'update':
      if (task.status === 'assigned') fields.status = 'in_progress'
      if (!task.ack_at) fields.ack_at = now
      if (!task.first_artifact_at && progress.artifacts?.length) fields.first_artifact_at = now
      break
    case 'blocked':
      // Becoming blocked is not a retry — just record the block reason
      fields.blocked_type = progress.blocked_type || 'dependency'
      fields.blocked_reason = progress.blocked_reason || progress.message
      break
    case 'unblocked':
      fields.blocked_type = null
      fields.blocked_reason = null
      // Unblocking counts as a retry attempt (agent is re-attempting work)
      fields.retry_count = (task.retry_count || 0) + 1
      if (task.status === 'assigned') fields.status = 'in_progress'
      break
    case 'complete':
      // Successful completion should always be allowed regardless of retry count.
      // Retry cap only gates new assignment/retry attempts, not successful completion.
      fields.status = 'review'
      fields.blocked_type = null
      fields.blocked_reason = null
      if (!task.first_artifact_at) fields.first_artifact_at = now
      break
  }

  return { fields }
}
