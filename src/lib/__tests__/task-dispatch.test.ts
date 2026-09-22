import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { insertDispatchTokenUsage, normalizeDispatchModel, pickProvider, resolveTaskDispatchModelOverride } from '@/lib/task-dispatch'

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

describe('normalizeDispatchModel', () => {
  it('drops gateway prefixes down to the bare model ID', () => {
    expect(normalizeDispatchModel('9router/cc/claude-opus-4-6')).toBe('claude-opus-4-6')
    expect(normalizeDispatchModel('openai-codex/gpt-5.4')).toBe('gpt-5.4')
    expect(normalizeDispatchModel('sonnet')).toBe('sonnet')
  })

  it('keeps a direct-provider prefix so the local rail stays routable', () => {
    // An OpenAI-compatible LOCAL_LLM_ENDPOINT (OpenRouter, liteLLM, Ollama) needs the
    // vendor-qualified ID on the wire; before the fix this collapsed to "deepseek-chat"
    // and pickProvider sent it to Anthropic.
    const model = normalizeDispatchModel('local/deepseek/deepseek-chat')
    expect(model).toBe('local/deepseek/deepseek-chat')
    expect(pickProvider(model)).toBe('local')
    expect(pickProvider(normalizeDispatchModel('local/anthropic/claude-sonnet-4-6'))).toBe('local')
  })

  it('leaves catalog routing untouched', () => {
    expect(pickProvider(normalizeDispatchModel('anthropic/claude-sonnet-4-6'))).toBe('anthropic')
    expect(pickProvider(normalizeDispatchModel('openai/gpt-4.1'))).toBe('openai')
    expect(pickProvider(normalizeDispatchModel('minimax/MiniMax-M3'))).toBe('minimax')
    expect(pickProvider(normalizeDispatchModel('ollama/deepseek-r1:14b'))).toBe('local')
  })
})
