import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import {
  callDirectly,
  insertDispatchTokenUsage,
  resolveDirectProvider,
  resolveTaskDispatchModelOverride,
} from '@/lib/task-dispatch'

const originalAtlasCloudApiKey = process.env.ATLASCLOUD_API_KEY

afterEach(() => {
  vi.unstubAllGlobals()
  if (originalAtlasCloudApiKey === undefined) delete process.env.ATLASCLOUD_API_KEY
  else process.env.ATLASCLOUD_API_KEY = originalAtlasCloudApiKey
})

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

describe('resolveDirectProvider', () => {
  it('routes Atlas Cloud catalog names and aliases to its direct API path', () => {
    expect(resolveDirectProvider('atlascloud/deepseek-ai/deepseek-v4-pro')).toBe('atlascloud')
    expect(resolveDirectProvider('atlas-deepseek')).toBe('atlascloud')
  })

  it('dispatches Atlas Cloud models through its OpenAI-compatible endpoint', async () => {
    process.env.ATLASCLOUD_API_KEY = 'atlas-test-key'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'done' } }],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await callDirectly({
      id: 42,
      title: 'Atlas test',
      description: null,
      status: 'assigned',
      priority: 'medium',
      assigned_to: 'atlas-agent',
      workspace_id: 1,
      agent_name: 'atlas-agent',
      agent_id: 1,
      agent_config: JSON.stringify({
        dispatchModel: 'atlascloud/deepseek-ai/deepseek-v4-pro',
      }),
      ticket_prefix: null,
      project_ticket_no: null,
      project_id: null,
    }, 'Complete this task')

    expect(response.text).toBe('done')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.atlascloud.ai/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer atlas-test-key' })
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'deepseek-ai/deepseek-v4-pro',
      max_tokens: 4096,
    })
  })
})
