import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { existsSync } from 'node:fs'

const requireRoleMock = vi.fn()
const getWorkspaceIsolationMock = vi.fn()
const getAllGatewaySessionsMock = vi.fn()
const prepareMock = vi.fn()
const state = vi.hoisted(() => ({
  tokenPath: `/tmp/mission-control-strict-token-isolation-${process.pid}.json`,
}))

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/workspace-isolation', () => ({ getWorkspaceIsolation: getWorkspaceIsolationMock }))
vi.mock('@/lib/sessions', () => ({ getAllGatewaySessions: getAllGatewaySessionsMock }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(() => ({ prepare: prepareMock })) }))
vi.mock('@/lib/config', () => ({
  config: { tokensPath: state.tokenPath },
  ensureDirExists: vi.fn(),
}))
vi.mock('@/lib/provider-subscriptions', () => ({
  getProviderSubscriptionFlags: vi.fn(() => ({})),
  getProviderFromModel: vi.fn(() => 'unknown'),
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const strictUser = {
  id: 9,
  username: 'strict-user',
  role: 'operator',
  workspace_id: 7,
  tenant_id: 2,
}

describe('strict token runtime isolation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    requireRoleMock.mockReturnValue({ user: strictUser })
    getWorkspaceIsolationMock.mockReturnValue('strict')
  })

  it('reads workspace-owned database usage without scanning global sessions or files', async () => {
    prepareMock.mockReturnValue({
      all: vi.fn(() => [{
        id: 1,
        model: 'test-model',
        session_id: 'agent-a:main',
        input_tokens: 10,
        output_tokens: 5,
        task_id: null,
        workspace_id: 7,
        created_at: 100,
      }]),
    })
    const { GET } = await import('@/app/api/tokens/route')

    const response = await GET(new NextRequest('http://localhost/api/tokens?action=list'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      usage: [expect.objectContaining({ workspaceId: 7, sessionId: 'agent-a:main' })],
    })
    expect(getAllGatewaySessionsMock).not.toHaveBeenCalled()
    expect(existsSync(state.tokenPath)).toBe(false)
  })

  it('persists strict usage to the scoped database without writing the global JSON file', async () => {
    const run = vi.fn()
    prepareMock.mockReturnValue({ run })
    const { POST } = await import('@/app/api/tokens/route')

    const response = await POST(new NextRequest('http://localhost/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'test-model',
        sessionId: 'agent-a:main',
        inputTokens: 10,
        outputTokens: 5,
      }),
    }))

    expect(response.status).toBe(200)
    expect(run).toHaveBeenCalledWith(
      'test-model',
      'agent-a:main',
      10,
      5,
      expect.any(Number),
      7,
      null,
      expect.any(Number),
      'agent-a',
    )
    expect(existsSync(state.tokenPath)).toBe(false)
  })

  it.each([
    { model: '', sessionId: 'agent-a:main', inputTokens: 10, outputTokens: 5 },
    { model: 'test-model', sessionId: {}, inputTokens: 10, outputTokens: 5 },
    { model: 'test-model', sessionId: 'agent-a:main', inputTokens: -1, outputTokens: 5 },
    { model: 'test-model', sessionId: 'agent-a:main', inputTokens: Number.POSITIVE_INFINITY, outputTokens: 5 },
    { model: 'test-model', sessionId: 'agent-a:main', inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 },
    { model: 'x'.repeat(201), sessionId: 'agent-a:main', inputTokens: 10, outputTokens: 5 },
  ])('rejects malformed token usage before persistence: %j', async (body) => {
    const { POST } = await import('@/app/api/tokens/route')

    const response = await POST(new NextRequest('http://localhost/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid token usage record' })
    expect(prepareMock).not.toHaveBeenCalled()
    expect(existsSync(state.tokenPath)).toBe(false)
  })
})
