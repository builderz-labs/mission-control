import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({ dir: '', tokenPath: '' }))
const requireRoleMock = vi.fn()
const rows: Array<Record<string, unknown>> = []

const fakeDb = {
  prepare: (sql: string) => {
    if (/INSERT INTO token_usage/.test(sql)) {
      return {
        run: (model: string, sessionId: string, input: number, output: number, createdAt: number, ws: number, taskId: number | null) => {
          rows.push({ id: rows.length + 1, model, session_id: sessionId, input_tokens: input, output_tokens: output, task_id: taskId, workspace_id: ws, created_at: createdAt })
        },
      }
    }
    return { all: () => [...rows], get: () => undefined }
  },
}

vi.mock('@/lib/auth', () => ({ requireRole: requireRoleMock }))
vi.mock('@/lib/workspace-isolation', () => ({ getWorkspaceIsolation: vi.fn(() => 'shared') }))
vi.mock('@/lib/sessions', () => ({ getAllGatewaySessions: vi.fn(() => []) }))
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn(() => fakeDb) }))
vi.mock('@/lib/config', () => ({
  config: { get tokensPath() { return state.tokenPath } },
  ensureDirExists: vi.fn(),
}))
vi.mock('@/lib/provider-subscriptions', () => ({
  getProviderSubscriptionFlags: vi.fn(() => ({})),
  getProviderFromModel: vi.fn(() => 'unknown'),
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

describe('POST /api/tokens then agent-costs', () => {
  beforeEach(() => {
    vi.resetModules()
    rows.length = 0
    state.dir = mkdtempSync(join(tmpdir(), 'mc-token-dedupe-'))
    state.tokenPath = join(state.dir, 'tokens.json')
    requireRoleMock.mockReturnValue({ user: { id: 1, username: 'u', role: 'operator', workspace_id: 1 } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    rmSync(state.dir, { recursive: true, force: true })
  })

  async function postThenQuery(body: Record<string, unknown>, nowSequence: number[]) {
    const { POST, GET } = await import('@/app/api/tokens/route')
    const real = Date.now
    let i = 0
    // Simulate the wall clock crossing a second boundary during the POST.
    vi.spyOn(Date, 'now').mockImplementation(() => (i < nowSequence.length ? nowSequence[i++] : nowSequence[nowSequence.length - 1]))
    const res = await POST(new NextRequest('http://localhost/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    expect(res.status).toBe(200)
    vi.spyOn(Date, 'now').mockImplementation(real)
    const get = await GET(new NextRequest('http://localhost/api/tokens?action=agent-costs&timeframe=all'))
    return get.json()
  }

  const base = { model: 'claude-sonnet-4', sessionId: 'agent-x:chat', inputTokens: 500, outputTokens: 200 }

  it('counts one POST once when the clock crosses a second boundary between the file and DB writes', async () => {
    const body = await postThenQuery(base, [1_700_000_000_999, 1_700_000_001_000])
    expect(body.agents['agent-x'].stats.totalTokens).toBe(700)
    expect(body.agents['agent-x'].stats.requestCount).toBe(1)
  })

  it('counts one POST once when a duration is supplied (DB has no duration column)', async () => {
    const body = await postThenQuery({ ...base, duration: 1234 }, [1_700_000_000_100])
    expect(body.agents['agent-x'].stats.requestCount).toBe(1)
  })
})
