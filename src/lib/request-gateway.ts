/**
 * This is the ONLY allowed interface for request lifecycle transitions.
 */

import {
  approveRequest,
  createDraftRequest,
  markReviewReady,
  rejectRequest,
  validateRequest,
  type MissionControlRequest,
  type MissionControlRequestInput,
} from '@/lib/mission-control-requests'

function assertTransition(
  request: MissionControlRequest,
  allowedStatuses: MissionControlRequest['status'][],
  action: string,
): void {
  if (!allowedStatuses.includes(request.status)) {
    throw new Error(`Cannot ${action} from status ${request.status}.`)
  }
}

export function createRequest(input: MissionControlRequestInput): MissionControlRequest {
  const validation = validateRequest(input)
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '))
  }

  return createDraftRequest(input)
}

export function submitForReview(request: MissionControlRequest): MissionControlRequest {
  assertTransition(request, ['DRAFT'], 'submit request for review')
  return markReviewReady(request)
}

export function approve(request: MissionControlRequest): MissionControlRequest {
  assertTransition(request, ['REVIEW_READY'], 'approve request')
  return approveRequest(request)
}

export function reject(
  request: MissionControlRequest,
  reason: string,
): MissionControlRequest {
  assertTransition(request, ['DRAFT', 'REVIEW_READY', 'APPROVED'], 'reject request')
  return rejectRequest(request, reason)
}
