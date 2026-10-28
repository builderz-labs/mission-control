import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { callDirectly, classifyDirectModel, insertDispatchTokenUsage, pickProvider, resolveTaskDispatchModelOverride } from '@/lib/task-dispatch'


describe('insertDispatchTokenUsage', () => {
  it('persists dispatch usage using the current token_usage schema', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE token_usage (
        model TEXT NOT NULL,
        session_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        workspace_id INTEGER NOT NULL,
        cost_usd REAL
      )
    `)

    insertDispatchTokenUsage(db, {
      model: 'test-model',
      sessionId: 'task-42',
      inputTokens: 120,
      outputTokens: 30,
      workspaceId: 7,
    }, 1_700_000_000)

    expect(db.prepare('SELECT * FROM token_usage').get()).toEqual({
      model: 'test-model',
      session_id: 'task-42',
      input_tokens: 120,
      output_tokens: 30,
      created_at: 1_700_000_000,
      workspace_id: 7,
      cost_usd: 0,
    })
    db.close()
  })
})

describe('resolveTaskDispatchModelOverride', () => {
  it('returns null when the agent has no explicit dispatch model override', () => {
    expect(resolveTaskDispatchModelOverride({ agent_config: null })).toBeNull()
    expect(resolveTaskDispatchModelOverride({ agent_config: '{"openclawId":"main"}' })).toBeNull()
  })

  it('returns the explicit dispatch model override when present', () => {
    expect(
      resolveTaskDispatchModelOverride({
        agent_config: '{"openclawId":"main","dispatchModel":"openai-codex/gpt-5.4"}',
      })
    ).toBe('openai-codex/gpt-5.4')
  })

  it('ignores malformed agent config payloads', () => {
    expect(resolveTaskDispatchModelOverride({ agent_config: '{not json' })).toBeNull()
  })
})

describe('MiniMax direct dispatch routing', () => {
  it('selects the dedicated provider for both current model IDs', () => {
    expect(pickProvider('MiniMax-M3')).toBe('minimax')
    expect(pickProvider('minimax/MiniMax-M2.7')).toBe('minimax')
  })
})

describe('Atlas Cloud direct dispatch routing', () => {
  it('routes Atlas Cloud catalog names and aliases to its direct API path', () => {
    expect(pickProvider('atlascloud/deepseek-ai/deepseek-v4-pro')).toBe('atlascloud')
    expect(pickProvider('atlas-deepseek')).toBe('atlascloud')
  })
})

describe('Atlas Cloud wire model id through the real dispatch path', () => {
  const baseTask = {
    id: 1, title: 't', description: null, status: 'assigned', priority: 'medium',
    assigned_to: 'a', workspace_id: 1, agent_name: 'a', agent_id: 1,
    ticket_prefix: null, project_ticket_no: null, project_id: null,
  }
  const taskWith = (dispatchModel: string) => ({ ...baseTask, agent_config: JSON.stringify({ dispatchModel }) })

  async function dispatchBody(dispatchModel: string) {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('ATLASCLOUD_API_KEY', 'test-key')
    try {
      const res = await callDirectly(taskWith(dispatchModel), 'hello')
      expect(res.text).toBe('ok')
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    return { url, body: JSON.parse(init.body as string) }
  }

  it.each([
    'atlas-deepseek',
    'atlascloud/deepseek-ai/deepseek-v4-pro',
    'deepseek-ai/deepseek-v4-pro',
  ])('sends the real model id for dispatchModel %s', async (dispatchModel) => {
    expect(pickProvider(classifyDirectModel(taskWith(dispatchModel)))).toBe('atlascloud')
    const { url, body } = await dispatchBody(dispatchModel)
    expect(url).toBe('https://api.atlascloud.ai/v1/chat/completions')
    expect(body.model).toBe('deepseek-ai/deepseek-v4-pro')
  })

  it('keeps nested ids for uncatalogued atlascloud/ models', async () => {
    const { body } = await dispatchBody('atlascloud/deepseek-ai/deepseek-v4-flash')
    expect(body.model).toBe('deepseek-ai/deepseek-v4-flash')
  })

  it('keeps existing gateway-prefix stripping for other overrides', () => {
    expect(classifyDirectModel(taskWith('9router/cc/claude-opus-4-6'))).toBe('claude-opus-4-6')
    expect(classifyDirectModel(taskWith('sonnet'))).toBe('claude-sonnet-4-6')
  })
})
