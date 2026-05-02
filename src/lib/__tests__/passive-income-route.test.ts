import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the bot wrapper before importing the route
vi.mock('@/lib/server/passive-income-bot-wrapper', () => ({
  runBot: vi.fn(),
}))

import { POST } from '../../app/api/bots/passive-income/route'
import { runBot } from '@/lib/server/passive-income-bot-wrapper'

const MOCK_RESULT = {
  status: 'DRAFT_CREATED',
  risk_level: 1,
  label: 'DRAFT — NOT APPROVED',
  brief: {
    product_idea: 'Minimalist desk mat',
    buyer: 'Remote workers',
    pain_point: 'Cluttered desks',
    evidence_summary: 'Heuristic only',
    evidence_basis: 'heuristic_only',
    evidence_signals_used: null,
    scores: {
      demand: 0.8, buyer_pain: 0.7, competition_weakness: 0.6,
      differentiation: 0.75, ease_of_production: 0.65,
      visual_sales_potential: 0.85, evergreen_value: 0.7,
      price_potential: 0.6, maintenance_burden: 0.3,
    },
    recommendation: 'DRAFT_CREATED',
    next_action: 'Validate demand via research',
  },
  evidence_entry_id: null,
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/bots/passive-income', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/bots/passive-income', () => {
  beforeEach(() => {
    vi.mocked(runBot).mockReturnValue(MOCK_RESULT)
  })

  it('returns 200 with valid niche', async () => {
    const res = await POST(makeRequest({ niche: 'minimalist desk mats' }))
    expect(res.status).toBe(200)
  })

  it('response body matches bot output shape', async () => {
    const res = await POST(makeRequest({ niche: 'minimalist desk mats' }))
    const body = await res.json()
    expect(body.status).toBe('DRAFT_CREATED')
    expect(body.label).toBe('DRAFT — NOT APPROVED')
    expect(body.brief.product_idea).toBeTruthy()
  })

  it('calls runBot with trimmed niche', async () => {
    await POST(makeRequest({ niche: '  notebook covers  ' }))
    expect(runBot).toHaveBeenCalledWith(
      expect.objectContaining({ niche: 'notebook covers' })
    )
  })

  it('returns 400 when niche is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when niche is empty string', async () => {
    const res = await POST(makeRequest({ niche: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when niche is whitespace only', async () => {
    const res = await POST(makeRequest({ niche: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when niche exceeds 500 chars', async () => {
    const res = await POST(makeRequest({ niche: 'x'.repeat(501) }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when bot returns an error object', async () => {
    vi.mocked(runBot).mockReturnValue({ error: 'Invalid niche', status: 400 } as any)
    const res = await POST(makeRequest({ niche: 'valid niche' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid niche')
  })

  it('returns 400 when niche is not a string', async () => {
    const res = await POST(makeRequest({ niche: 42 }))
    expect(res.status).toBe(400)
  })
})
