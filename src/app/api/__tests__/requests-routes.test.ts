import { describe, expect, it } from 'vitest'
import { POST as createRoute } from '@/app/api/requests/route'
import { POST as reviewRoute } from '@/app/api/requests/[id]/review/route'
import { POST as approveRoute } from '@/app/api/requests/[id]/approve/route'
import { POST as rejectRoute } from '@/app/api/requests/[id]/reject/route'

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Route-bound request lifecycle',
    description: 'Use API routes as the only allowed control surface.',
    risk_level: 1,
    requested_by: 'nikma',
    target_area: 'mission-control',
    proposed_prompt: 'Route all request transitions through the gateway.',
    validation_plan: 'pnpm typecheck && pnpm test && pnpm build',
    notes: 'API-only draft object flow.',
    ...overrides,
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('requests API routes', () => {
  it('supports create -> review -> approve happy path', async () => {
    const createResponse = await createRoute(
      jsonRequest('http://localhost/api/requests', makeInput()) as any,
    )
    expect(createResponse.status).toBe(200)

    const createdBody = await createResponse.json()
    const created = createdBody.request

    const reviewResponse = await reviewRoute(
      jsonRequest(`http://localhost/api/requests/${created.id}/review`, { request: created }) as any,
      { params: Promise.resolve({ id: created.id }) },
    )
    expect(reviewResponse.status).toBe(200)

    const reviewBody = await reviewResponse.json()
    expect(reviewBody.request.status).toBe('REVIEW_READY')

    const approveResponse = await approveRoute(
      jsonRequest(`http://localhost/api/requests/${created.id}/approve`, { request: reviewBody.request }) as any,
      { params: Promise.resolve({ id: created.id }) },
    )
    expect(approveResponse.status).toBe(200)

    const approveBody = await approveResponse.json()
    expect(approveBody.request.status).toBe('APPROVED')
  })

  it('returns 400 for invalid transitions', async () => {
    const createResponse = await createRoute(
      jsonRequest('http://localhost/api/requests', makeInput()) as any,
    )
    const created = (await createResponse.json()).request

    const approveResponse = await approveRoute(
      jsonRequest(`http://localhost/api/requests/${created.id}/approve`, { request: created }) as any,
      { params: Promise.resolve({ id: created.id }) },
    )

    expect(approveResponse.status).toBe(400)
    expect(await approveResponse.json()).toEqual({
      error: 'Cannot approve request from status DRAFT.',
    })
  })

  it('reject works from allowed states', async () => {
    const draftCreate = await createRoute(
      jsonRequest('http://localhost/api/requests', makeInput({ title: 'Draft rejection path' })) as any,
    )
    const draft = (await draftCreate.json()).request

    const rejectedDraft = await rejectRoute(
      jsonRequest(`http://localhost/api/requests/${draft.id}/reject`, {
        request: draft,
        reason: 'Need stronger scope.',
      }) as any,
      { params: Promise.resolve({ id: draft.id }) },
    )
    expect(rejectedDraft.status).toBe(200)
    expect((await rejectedDraft.json()).request.status).toBe('REJECTED')

    const reviewCreate = await createRoute(
      jsonRequest('http://localhost/api/requests', makeInput({ title: 'Review rejection path' })) as any,
    )
    const reviewDraft = (await reviewCreate.json()).request
    const reviewReady = await reviewRoute(
      jsonRequest(`http://localhost/api/requests/${reviewDraft.id}/review`, { request: reviewDraft }) as any,
      { params: Promise.resolve({ id: reviewDraft.id }) },
    )
    const reviewRequest = (await reviewReady.json()).request

    const rejectedReview = await rejectRoute(
      jsonRequest(`http://localhost/api/requests/${reviewDraft.id}/reject`, {
        request: reviewRequest,
        reason: 'Needs revision.',
      }) as any,
      { params: Promise.resolve({ id: reviewDraft.id }) },
    )
    expect(rejectedReview.status).toBe(200)
    expect((await rejectedReview.json()).request.status).toBe('REJECTED')

    const approveCreate = await createRoute(
      jsonRequest('http://localhost/api/requests', makeInput({ title: 'Approved rejection path' })) as any,
    )
    const approveDraft = (await approveCreate.json()).request
    const approveReady = await reviewRoute(
      jsonRequest(`http://localhost/api/requests/${approveDraft.id}/review`, { request: approveDraft }) as any,
      { params: Promise.resolve({ id: approveDraft.id }) },
    )
    const approved = await approveRoute(
      jsonRequest(`http://localhost/api/requests/${approveDraft.id}/approve`, {
        request: (await approveReady.json()).request,
      }) as any,
      { params: Promise.resolve({ id: approveDraft.id }) },
    )
    const approvedRequest = (await approved.json()).request

    const rejectedApproved = await rejectRoute(
      jsonRequest(`http://localhost/api/requests/${approveDraft.id}/reject`, {
        request: approvedRequest,
        reason: 'Approval withdrawn.',
      }) as any,
      { params: Promise.resolve({ id: approveDraft.id }) },
    )
    expect(rejectedApproved.status).toBe(200)
    expect((await rejectedApproved.json()).request.status).toBe('REJECTED')
  })
})
