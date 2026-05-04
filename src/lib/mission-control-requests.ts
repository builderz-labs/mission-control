/**
 * Mission Control Requests v1
 *
 * Draft-only change request lifecycle helpers.
 * No persistence, no execution, no shell access, no code mutation.
 */

export type MissionControlRequestStatus =
  | 'DRAFT'
  | 'REVIEW_READY'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'

export type MissionControlRiskLevel = 0 | 1 | 2 | 3

export interface MissionControlRequest {
  id: string
  title: string
  description: string
  status: MissionControlRequestStatus
  risk_level: MissionControlRiskLevel
  created_at: string
  updated_at: string
  requested_by: string
  target_area: string
  proposed_prompt: string
  validation_plan: string
  notes: string
}

export interface MissionControlRequestInput {
  title: string
  description: string
  risk_level: MissionControlRiskLevel
  requested_by: string
  target_area: string
  proposed_prompt: string
  validation_plan: string
  notes?: string
  status?: MissionControlRequestStatus
}

export interface RequestValidationResult {
  valid: boolean
  errors: string[]
}

const ALLOWED_STATUSES: MissionControlRequestStatus[] = [
  'DRAFT',
  'REVIEW_READY',
  'APPROVED',
  'REJECTED',
  'EXECUTED',
]

function nowIso(): string {
  return new Date().toISOString()
}

function generateRequestId(): string {
  return `mcr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRiskLevel(value: unknown): value is MissionControlRiskLevel {
  return value === 0 || value === 1 || value === 2 || value === 3
}

function normalizeNotes(notes?: string): string {
  return typeof notes === 'string' ? notes.trim() : ''
}

function appendNote(existingNotes: string, nextNote: string): string {
  const current = existingNotes.trim()
  return current ? `${current}\n${nextNote}` : nextNote
}

function withUpdatedRequest(
  request: MissionControlRequest,
  updates: Partial<MissionControlRequest>,
): MissionControlRequest {
  return {
    ...request,
    ...updates,
    updated_at: nowIso(),
  }
}

function assertStatus(
  request: MissionControlRequest,
  allowed: MissionControlRequestStatus[],
  action: string,
): void {
  if (!allowed.includes(request.status)) {
    throw new Error(`Cannot ${action} from status ${request.status}.`)
  }
}

export function validateRequest(input: MissionControlRequestInput): RequestValidationResult {
  const errors: string[] = []

  if (!isNonEmptyString(input.title)) {
    errors.push('Title is required.')
  }
  if (!isNonEmptyString(input.description)) {
    errors.push('Description is required.')
  }
  if (!isNonEmptyString(input.requested_by)) {
    errors.push('Requested by is required.')
  }
  if (!isNonEmptyString(input.target_area)) {
    errors.push('Target area is required.')
  }
  if (!isNonEmptyString(input.proposed_prompt)) {
    errors.push('Proposed prompt is required.')
  }
  if (!isNonEmptyString(input.validation_plan)) {
    errors.push('Validation plan is required.')
  }
  if (!isRiskLevel(input.risk_level)) {
    errors.push('Risk level must be 0, 1, 2, or 3.')
  }
  if (input.status && !ALLOWED_STATUSES.includes(input.status)) {
    errors.push('Status is invalid.')
  }
  if (input.status === 'EXECUTED') {
    errors.push('Direct execution is not supported in request drafting v1.')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function createDraftRequest(input: MissionControlRequestInput): MissionControlRequest {
  const validation = validateRequest({ ...input, status: 'DRAFT' })
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '))
  }

  const timestamp = nowIso()

  return {
    id: generateRequestId(),
    title: input.title.trim(),
    description: input.description.trim(),
    status: 'DRAFT',
    risk_level: input.risk_level,
    created_at: timestamp,
    updated_at: timestamp,
    requested_by: input.requested_by.trim(),
    target_area: input.target_area.trim(),
    proposed_prompt: input.proposed_prompt.trim(),
    validation_plan: input.validation_plan.trim(),
    notes: normalizeNotes(input.notes),
  }
}

export function markReviewReady(request: MissionControlRequest): MissionControlRequest {
  assertStatus(request, ['DRAFT'], 'mark request as review ready')

  const validation = validateRequest(request)
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '))
  }

  return withUpdatedRequest(request, { status: 'REVIEW_READY' })
}

export function rejectRequest(
  request: MissionControlRequest,
  reason: string,
): MissionControlRequest {
  assertStatus(request, ['DRAFT', 'REVIEW_READY', 'APPROVED'], 'reject request')

  if (!isNonEmptyString(reason)) {
    throw new Error('Rejection reason is required.')
  }

  return withUpdatedRequest(request, {
    status: 'REJECTED',
    notes: appendNote(request.notes, `Rejected: ${reason.trim()}`),
  })
}

export function approveRequest(request: MissionControlRequest): MissionControlRequest {
  assertStatus(request, ['REVIEW_READY'], 'approve request')
  return withUpdatedRequest(request, { status: 'APPROVED' })
}
