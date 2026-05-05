import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the bot wrapper before importing the route
vi.mock('@/lib/server/passive-income-bot-wrapper', () => ({
  runBot: vi.fn(),
}))

// Mock the execution gate so tests control allow/deny independently of registry state
vi.mock('@/lib/control-interface', () => ({
  evaluateControl: vi.fn(),
}))

import { POST, checkRateLimit, _limiter } from '../../app/api/bots/passive-income/route'
import { runBot, type PassiveIncomeBotResult } from '@/lib/server/passive-income-bot-wrapper'
import { evaluateControl } from '@/lib/control-interface'

const MOCK_GATE_ALLOWED = {
  allowed: true,
  reason: 'Agent is eligible for execution.',
  risk_level: 2 as const,
  effective_risk_level: 2 as const,
  decision_trace: {
    contract: 'PASS' as const,
    argument_guard: 'PASS' as const,
    coordination: 'ALLOW' as const,
    risk_composition: 'ESCALATE' as const,
    session: 'N/A' as const,
  },
}

const MOCK_RESULT: PassiveIncomeBotResult = {
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
    vi.mocked(evaluateControl).mockReturnValue(MOCK_GATE_ALLOWED)
    _limiter.clear()
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

// ── Execution gate enforcement ────────────────────────────────────────────────

describe('POST /api/bots/passive-income — execution gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(runBot).mockReturnValue(MOCK_RESULT)
    vi.mocked(evaluateControl).mockReturnValue(MOCK_GATE_ALLOWED)
    _limiter.clear()
  })

  it('returns 403 when gate denies execution', async () => {
    vi.mocked(evaluateControl).mockReturnValueOnce({
      ...MOCK_GATE_ALLOWED,
      allowed: false,
      reason: 'Agent requires explicit approval before execution.',
      decision_trace: {
        ...MOCK_GATE_ALLOWED.decision_trace,
        coordination: 'BLOCK' as const,
      },
    })
    const res = await POST(makeRequest({ niche: 'minimalist desk mats' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBeTruthy()
    expect(runBot).not.toHaveBeenCalled()
  })

  it('403 response body contains the gate reason', async () => {
    vi.mocked(evaluateControl).mockReturnValueOnce({
      ...MOCK_GATE_ALLOWED,
      allowed: false,
      reason: 'Blocked: effective_risk_level 3 exceeds maximum threshold.',
      decision_trace: {
        ...MOCK_GATE_ALLOWED.decision_trace,
        risk_composition: 'BLOCK' as const,
        coordination: 'BLOCK' as const,
      },
    })
    const res = await POST(makeRequest({ niche: 'some niche' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/Blocked/i)
  })

  it('proceeds to runBot when gate allows', async () => {
    const res = await POST(makeRequest({ niche: 'minimalist desk mats' }))
    expect(res.status).toBe(200)
    expect(runBot).toHaveBeenCalledOnce()
  })

  it('gate is called before runBot', async () => {
    const callOrder: string[] = []
    vi.mocked(evaluateControl).mockImplementationOnce((...args) => {
      callOrder.push('gate')
      return MOCK_GATE_ALLOWED
    })
    vi.mocked(runBot).mockImplementationOnce((...args) => {
      callOrder.push('bot')
      return MOCK_RESULT
    })
    await POST(makeRequest({ niche: 'minimalist desk mats' }))
    expect(callOrder).toEqual(['gate', 'bot'])
  })
})

// ── checkRateLimit unit tests ─────────────────────────────────────────────────

describe('checkRateLimit', () => {
  beforeEach(() => {
    _limiter.clear()
  })

  it('allows first request', () => {
    const { allowed } = checkRateLimit('1.2.3.4', 1000)
    expect(allowed).toBe(true)
  })

  it('allows up to MAX_CALLS (5) requests', () => {
    const ip = '10.0.0.1'
    const now = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, now).allowed).toBe(true)
    }
  })

  it('blocks the 6th request in the same window', () => {
    const ip = '10.0.0.2'
    const now = 2_000_000
    for (let i = 0; i < 5; i++) checkRateLimit(ip, now)
    const result = checkRateLimit(ip, now)
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('returns 429 from POST after 5 calls', async () => {
    const ip = '192.168.1.1'
    const now = 3_000_000
    // Exhaust the limit directly
    for (let i = 0; i < 5; i++) checkRateLimit(ip, now)
    _limiter.set(ip, { count: 5, windowStart: now })

    // Next real POST from that IP should be 429
    const req = new NextRequest('http://localhost/api/bots/passive-income', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ niche: 'test' }),
    })
    // Temporarily override Date.now to stay in the same window
    const origNow = Date.now
    Date.now = () => now + 1000  // still within 60s window
    try {
      const res = await POST(req)
      expect(res.status).toBe(429)
      const body = await res.json()
      expect(body.error).toBe('rate_limit_exceeded')
      expect(typeof body.retry_after).toBe('number')
      expect(body.retry_after).toBeGreaterThan(0)
    } finally {
      Date.now = origNow
    }
  })

  it('window resets after 60s', () => {
    const ip = '10.0.0.3'
    const t0 = 4_000_000
    // exhaust window
    for (let i = 0; i < 5; i++) checkRateLimit(ip, t0)
    expect(checkRateLimit(ip, t0).allowed).toBe(false)
    // advance 60s
    const t1 = t0 + 60_001
    expect(checkRateLimit(ip, t1).allowed).toBe(true)
  })

  it('retry_after is seconds remaining in window', () => {
    const ip = '10.0.0.4'
    const t0 = 5_000_000
    for (let i = 0; i < 5; i++) checkRateLimit(ip, t0)
    const { retryAfter } = checkRateLimit(ip, t0 + 30_000) // 30s into window
    expect(retryAfter).toBe(30) // 60 - 30 = 30s remaining
  })
})
