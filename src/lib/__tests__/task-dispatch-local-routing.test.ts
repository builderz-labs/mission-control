import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ dispatchModel: 'local/aiverse' }))

vi.mock('../db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      all: () => sql.includes('FROM tasks t') ? [{
        id: 42, title: 'Synthetic routing check', description: null,
        status: 'assigned', priority: 'medium', assigned_to: 'synthetic-agent',
        workspace_id: 7, agent_name: 'synthetic-agent', agent_id: 3,
        agent_config: JSON.stringify({ dispatchModel: state.dispatchModel }),
        ticket_prefix: null, project_ticket_no: null, project_id: null,
      }] : [],
      get: () => sql.includes('FROM gateways') ? { c: 0 } : undefined,
      run: () => ({ changes: 1 }),
    }),
  }),
  db_helpers: { logActivity: vi.fn() },
}))
vi.mock('../claude-code-sessions', () => ({}))
vi.mock('../openclaw-gateway', () => ({ callOpenClawGateway: vi.fn() }))
vi.mock('../event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../config', () => ({ config: { workspaceRoot: '' } }))
vi.mock('../sessions', () => ({ getAllGatewaySessions: vi.fn() }))
vi.mock('../transcript-parser', () => ({}))
vi.mock('../github-sync-engine', () => ({ syncTaskOutbound: vi.fn() }))
vi.mock('node:fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: () => false,
}))

import { dispatchAssignedTasks } from '../task-dispatch'

const childProcess = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process')

describe('direct dispatch provider prefixes', () => {
  beforeEach(() => {
    // Synthetic keys and mocked HTTP/process calls only. Never use host logins.
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-anthropic-key')
    vi.stubEnv('OPENAI_API_KEY', 'synthetic-openai-key')
    vi.stubEnv('LOCAL_LLM_ENDPOINT', 'http://127.0.0.1:18787/v1')
    vi.stubEnv('LOCAL_LLM_API_KEY', 'synthetic-local-key')
    vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 1 } as ReturnType<typeof childProcess.spawnSync>)
    vi.spyOn(childProcess, 'spawn').mockImplementation(() => { throw new Error('Unexpected CLI execution') })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'synthetic-result' } }],
        content: [{ type: 'text', text: 'synthetic-result' }],
      }),
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([
    ['local/aiverse', 'aiverse'],
    ['local/unlisted-model', 'unlisted-model'],
    ['ollama/deepseek-r1:14b', 'deepseek-r1:14b'],
    ['lmstudio/unlisted-model', 'unlisted-model'],
    ['litellm/vendor/model', 'vendor/model'],
    ['LOCAL/aiverse', 'aiverse'],
  ])('sends %s only to the configured local endpoint', async (selection, model) => {
    state.dispatchModel = selection
    expect(await dispatchAssignedTasks()).toEqual({ ok: true, message: 'Dispatched 1/1 tasks' })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:18787/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-local-key' }),
    }))
    const request = vi.mocked(fetch).mock.calls[0][1]!
    expect(JSON.parse(request.body as string).model).toBe(model)
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['openai/gpt-4o-mini', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini'],
    ['9router/cc/gpt-4o-mini', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini'],
    ['claude-sonnet-4-6', 'https://api.anthropic.com/v1/messages', 'claude-sonnet-4-6'],
    ['9router/cc/claude-sonnet-4-6', 'https://api.anthropic.com/v1/messages', 'claude-sonnet-4-6'],
  ])('preserves the existing %s route', async (selection, endpoint, model) => {
    state.dispatchModel = selection
    expect((await dispatchAssignedTasks()).ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, request] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(endpoint)
    expect(JSON.parse(request!.body as string).model).toBe(model)
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })

  it('reports a rejected local request without trying another provider', async () => {
    state.dispatchModel = 'local/aiverse'
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401, text: async () => 'synthetic unauthorized' } as Response)
    const result = await dispatchAssignedTasks()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('local API 401')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://127.0.0.1:18787/v1/chat/completions')
    expect(childProcess.spawn).not.toHaveBeenCalled()
  })
})
