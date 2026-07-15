import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const requireRoleMock = vi.fn()
const execApprovalLimiterMock = vi.fn<(key: string) => NextResponse | null>(() => null)
const realFetch = global.fetch

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/rate-limit', () => ({ execApprovalLimiter: execApprovalLimiterMock }))
vi.mock('@/lib/config', () => ({
  config: {
    gatewayHost: '127.0.0.1',
    gatewayPort: 18789,
    openclawHome: '/tmp/openclaw-test',
  },
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

const operator = {
  user: { id: 7, username: 'operator', role: 'operator', workspace_id: 3 },
}

function request(method: 'POST' | 'PUT', body: unknown) {
  return new NextRequest('http://localhost/api/exec-approvals', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('exec approvals route security', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue(operator)
    execApprovalLimiterMock.mockReturnValue(null)
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = realFetch
  })

  it('fails authentication before rate limiting or contacting the gateway', async () => {
    requireRoleMock.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { POST } = await import('@/app/api/exec-approvals/route')

    const response = await POST(request('POST', { id: 'approval-1', action: 'approve' }))

    expect(response.status).toBe(401)
    expect(execApprovalLimiterMock).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it.each(['POST', 'PUT'] as const)('rate limits authenticated %s mutations before parsing side effects', async (method) => {
    execApprovalLimiterMock.mockReturnValue(
      NextResponse.json({ error: 'Too many execution approval changes' }, { status: 429 }),
    )
    const route = await import('@/app/api/exec-approvals/route')

    const response = await route[method](request(method, {}))

    expect(response.status).toBe(429)
    expect(execApprovalLimiterMock).toHaveBeenCalledWith('3:7')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed approval responses without contacting the gateway', async () => {
    const { POST } = await import('@/app/api/exec-approvals/route')

    const response = await POST(request('POST', {
      id: 'approval-1',
      action: 'approve',
      unexpected: true,
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid execution approval response' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed allowlist records instead of throwing', async () => {
    const { PUT } = await import('@/app/api/exec-approvals/route')

    const response = await PUT(request('PUT', {
      agents: { assistant: { pattern: 'git *' } },
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid execution allowlist request: agents is required or malformed',
    })
  })

  it('forwards a bounded normalized approval response to the configured gateway', async () => {
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const { POST } = await import('@/app/api/exec-approvals/route')

    const response = await POST(request('POST', {
      id: '  approval-1  ',
      action: 'deny',
      reason: '  not expected  ',
    }))

    expect(response.status).toBe(200)
    expect(execApprovalLimiterMock).toHaveBeenCalledWith('3:7')
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:18789/api/exec-approvals/respond',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 'approval-1', action: 'deny', reason: 'not expected' }),
      }),
    )
  })
})
